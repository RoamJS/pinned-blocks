import addStyle from "roamjs-components/dom/addStyle";
import getParentUidByBlockUid from "roamjs-components/queries/getParentUidByBlockUid";
import getShallowTreeByParentUid from "roamjs-components/queries/getShallowTreeByParentUid";
import { render as renderToast } from "roamjs-components/components/Toast";
import type { OnloadArgs } from "roamjs-components/types";
import runExtension from "roamjs-components/util/runExtension";
import {
  STORAGE_KEY,
  addPinnedUid,
  getDesiredChildOrder,
  getPinnedParentUid,
  normalizePinnedBlocksSettings,
  ordersMatch,
  prunePinsForParent,
  removePinnedUid,
  shouldRemovePinnedIndicator,
  type PinnedBlocksByParent,
} from "~/utils/pins";

type ExtensionAPI = OnloadArgs["extensionAPI"];
type PullWatchCallback = Parameters<
  typeof window.roamAlphaAPI.data.addPullWatch
>[2];

const TOGGLE_PIN_COMMAND = "Pinned Blocks: Toggle Pin Focused Block";
const UNPIN_FOCUSED_COMMAND = "Pinned Blocks: Unpin Focused Block";
const PIN_CONTEXT_COMMAND = "Pinned Blocks: Pin block";
const UNPIN_CONTEXT_COMMAND = "Pinned Blocks: Unpin block";
const PULL_PATTERN = "[{:block/children [:block/uid :block/order]}]";
const WATCH_DEBOUNCE_MS = 120;
const INDICATOR_DEBOUNCE_MS = 80;
const STYLE_ID = "roamjs-pinned-blocks-style";
const PINNED_BLOCK_CLASS = "roamjs-pinned-blocks-block";
const PINNED_BLOCK_ACTIVE_CLASS = "roamjs-pinned-blocks-block-pinned";
const INDICATOR_CLASS = "roamjs-pinned-blocks-indicator";
const INDICATOR_ICON_CLASS = "roamjs-pinned-blocks-indicator-icon";
const BLUEPRINT_PIN_ICON_CLASS = "bp3-icon-pin";
const UID_SUFFIX_REGEX = /[A-Za-z0-9_-]{9}$/;

const getLocalStorageKey = (): string =>
  `${STORAGE_KEY}:${window.roamAlphaAPI.graph.name}`;

const isEmptySettings = (settings: PinnedBlocksByParent): boolean =>
  !Object.keys(settings).length;

const readLocalSettings = (): PinnedBlocksByParent => {
  try {
    return normalizePinnedBlocksSettings(
      window.localStorage.getItem(getLocalStorageKey()),
    );
  } catch {
    return {};
  }
};

const writeLocalSettings = (settingsJson: string): void => {
  try {
    window.localStorage.setItem(getLocalStorageKey(), settingsJson);
  } catch {
    // Roam settings remain the source of truth when browser storage is unavailable.
  }
};

const readSettings = ({
  extensionAPI,
}: {
  extensionAPI: ExtensionAPI;
}): PinnedBlocksByParent => {
  try {
    const extensionSettings = normalizePinnedBlocksSettings(
      extensionAPI.settings.get(STORAGE_KEY),
    );
    if (!isEmptySettings(extensionSettings)) return extensionSettings;

    return readLocalSettings();
  } catch {
    return readLocalSettings();
  }
};

const writeSettings = ({
  extensionAPI,
  settingsJson,
}: {
  extensionAPI: ExtensionAPI;
  settingsJson: string;
}): Promise<void> => extensionAPI.settings.set(STORAGE_KEY, settingsJson);

const toast = ({
  id,
  content,
  intent = "primary",
}: {
  id: string;
  content: string;
  intent?: "primary" | "success" | "warning" | "danger";
}): void => {
  renderToast({
    id,
    content,
    intent,
    timeout: 3000,
  });
};

const getDirectChildUids = (parentUid: string): string[] =>
  getShallowTreeByParentUid(parentUid).map((node) => node.uid);

const getPinnedUids = (settings: PinnedBlocksByParent): Set<string> =>
  new Set(Object.values(settings).flat());

const getUidFromElementId = (id?: string | null): string | null => {
  if (!id) return null;
  return id.match(UID_SUFFIX_REGEX)?.[0] || null;
};

const getUidFromBlockContainer = (container: HTMLElement): string | null => {
  const blockElement = container.querySelector<HTMLElement>(
    ":scope > .rm-block-main .roam-block[id], :scope > .rm-block-main textarea.rm-block-input[id]",
  );
  return getUidFromElementId(blockElement?.id);
};

const getRenderedBlockContainers = (uid: string): HTMLElement[] =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      `textarea.rm-block-input[id$="-${uid}"], .roam-block[id$="-${uid}"]`,
    ),
  )
    .filter((element) => getUidFromElementId(element.id) === uid)
    .map((element) => element.closest(".roam-block-container"))
    .filter(
      (container): container is HTMLElement => container instanceof HTMLElement,
    );

const removePinnedIndicator = (container: HTMLElement): void => {
  container.classList.remove(PINNED_BLOCK_CLASS, PINNED_BLOCK_ACTIVE_CLASS);
  delete container.dataset.roamjsPinnedBlocksUid;
  container
    .querySelector<HTMLElement>(`:scope > .${INDICATOR_CLASS}`)
    ?.remove();
};

const ensurePinnedIndicator = ({
  container,
  uid,
}: {
  container: HTMLElement;
  uid: string;
}): void => {
  container.classList.add(PINNED_BLOCK_CLASS, PINNED_BLOCK_ACTIVE_CLASS);
  container.dataset.roamjsPinnedBlocksUid = uid;

  if (container.querySelector(`:scope > .${INDICATOR_CLASS}`)) return;

  const indicator = document.createElement("span");
  indicator.className = INDICATOR_CLASS;
  indicator.dataset.roamjsPinnedBlocksIndicator = "true";
  indicator.title = "Pinned block";
  indicator.setAttribute("aria-label", "Pinned block");

  const icon = document.createElement("span");
  icon.className = `${INDICATOR_ICON_CLASS} bp3-icon ${BLUEPRINT_PIN_ICON_CLASS}`;
  icon.setAttribute("aria-hidden", "true");
  indicator.append(icon);

  container.insertBefore(indicator, container.firstChild);
};

export default runExtension(async ({ extensionAPI }) => {
  let currentSettings = readSettings({ extensionAPI });
  const watcherCleanups = new Map<string, () => void>();
  const enforceTimeouts = new Map<string, number>();
  let settingsWriteQueue: Promise<void> = Promise.resolve();
  let indicatorTimeout: number | null = null;
  let suppressPrunedToastUntil = 0;

  if (!isEmptySettings(currentSettings)) {
    const settingsJson = JSON.stringify(currentSettings);
    writeLocalSettings(settingsJson);
    settingsWriteQueue = writeSettings({ extensionAPI, settingsJson }).catch(
      (error) => {
        console.error("Pinned Blocks failed to restore saved settings", error);
      },
    );
  }

  const style = addStyle(
    `
      .${PINNED_BLOCK_CLASS} {
        position: relative;
      }

      .${INDICATOR_CLASS} {
        align-items: center;
        color: var(--roamjs-pinned-blocks-indicator-color, #5c7080);
        display: inline-flex;
        height: var(--roamjs-pinned-blocks-indicator-size, 13px);
        justify-content: center;
        left: var(--roamjs-pinned-blocks-indicator-left, -18px);
        opacity: var(--roamjs-pinned-blocks-indicator-opacity, 0.9);
        pointer-events: none;
        position: absolute;
        top: var(--roamjs-pinned-blocks-indicator-top, 5px);
        width: var(--roamjs-pinned-blocks-indicator-size, 13px);
        z-index: var(--roamjs-pinned-blocks-indicator-z-index, 1);
      }

      .${INDICATOR_CLASS}:hover {
        opacity: 1;
      }

      .${INDICATOR_ICON_CLASS} {
        color: currentColor;
        font-size: var(--roamjs-pinned-blocks-indicator-size, 13px);
        height: 100%;
        line-height: var(--roamjs-pinned-blocks-indicator-size, 13px);
        width: 100%;
      }
    `,
    STYLE_ID,
  );

  const persistSettings = (settings: PinnedBlocksByParent): void => {
    currentSettings = settings;
    scheduleIndicatorSync();

    const settingsJson = JSON.stringify(settings);
    writeLocalSettings(settingsJson);
    settingsWriteQueue = settingsWriteQueue
      .catch(() => undefined)
      .then(() => writeSettings({ extensionAPI, settingsJson }))
      .catch((error) => {
        console.error("Pinned Blocks failed to save settings", error);
        toast({
          id: "pinned-blocks-save-failed",
          content: "Pinned Blocks could not save its settings.",
          intent: "danger",
        });
      });
  };

  const syncPinnedIndicators = (): void => {
    indicatorTimeout = null;
    const pinnedUids = getPinnedUids(currentSettings);

    document
      .querySelectorAll<HTMLElement>(`.${PINNED_BLOCK_CLASS}`)
      .forEach((container) => {
        const renderedUid = getUidFromBlockContainer(container);
        if (
          shouldRemovePinnedIndicator({
            pinnedUids,
            renderedUid,
            storedUid: container.dataset.roamjsPinnedBlocksUid,
          })
        ) {
          removePinnedIndicator(container);
        }
      });

    pinnedUids.forEach((uid) => {
      getRenderedBlockContainers(uid).forEach((container) => {
        ensurePinnedIndicator({ container, uid });
      });
    });
  };

  function scheduleIndicatorSync(): void {
    if (indicatorTimeout !== null) window.clearTimeout(indicatorTimeout);
    indicatorTimeout = window.setTimeout(
      syncPinnedIndicators,
      INDICATOR_DEBOUNCE_MS,
    );
  }

  const scheduleEnforceParent = (parentUid: string): void => {
    const existingTimeout = enforceTimeouts.get(parentUid);
    if (existingTimeout) window.clearTimeout(existingTimeout);

    enforceTimeouts.set(
      parentUid,
      window.setTimeout(() => {
        void enforceParentOrder(parentUid);
      }, WATCH_DEBOUNCE_MS),
    );
  };

  const cleanupParentWatcher = (parentUid: string): void => {
    const cleanup = watcherCleanups.get(parentUid);
    if (!cleanup) return;
    cleanup();
    watcherCleanups.delete(parentUid);
  };

  const ensureParentWatcher = (parentUid: string): void => {
    if (watcherCleanups.has(parentUid)) return;

    const entityId = `[:block/uid "${parentUid}"]`;
    const watcher: PullWatchCallback = () => {
      scheduleEnforceParent(parentUid);
    };

    window.roamAlphaAPI.data.addPullWatch(PULL_PATTERN, entityId, watcher);
    watcherCleanups.set(parentUid, () => {
      window.roamAlphaAPI.data.removePullWatch(PULL_PATTERN, entityId, watcher);
    });
  };

  const syncWatchers = (): void => {
    const activeParentUids = new Set(Object.keys(currentSettings));
    activeParentUids.forEach(ensureParentWatcher);

    watcherCleanups.forEach((_, parentUid) => {
      if (!activeParentUids.has(parentUid)) cleanupParentWatcher(parentUid);
    });
  };

  const maybeToastPrunedPin = (removedCount: number): void => {
    if (!removedCount || Date.now() <= suppressPrunedToastUntil) return;

    suppressPrunedToastUntil = Date.now() + 5000;
    toast({
      id: "pinned-blocks-pin-removed",
      content:
        "Pinned Blocks unpinned a block because it is no longer a direct child of its pinned parent.",
      intent: "warning",
    });
  };

  async function enforceParentOrder(parentUid: string): Promise<void> {
    enforceTimeouts.delete(parentUid);

    const pinnedUids = currentSettings[parentUid] || [];
    if (!pinnedUids.length) return;

    const currentChildUids = getDirectChildUids(parentUid);
    if (!currentChildUids.length) {
      const pinnedParentUids = pinnedUids.map(getParentUidByBlockUid);
      if (pinnedParentUids.some((uid) => !uid || uid === parentUid)) return;
    }

    const pruned = prunePinsForParent({
      settings: currentSettings,
      parentUid,
      directChildUids: currentChildUids,
    });

    if (pruned.changed) {
      persistSettings(pruned.settings);
      syncWatchers();
      maybeToastPrunedPin(pruned.removedUids.length);
    }

    const activePinnedUids = pruned.settings[parentUid] || [];
    if (!activePinnedUids.length) return;

    const desiredChildOrder = getDesiredChildOrder({
      childUids: currentChildUids,
      pinnedUids: activePinnedUids,
    });
    if (ordersMatch(currentChildUids, desiredChildOrder)) return;

    try {
      await window.roamAlphaAPI.data.block.reorderBlocks({
        location: { "parent-uid": parentUid },
        blocks: desiredChildOrder,
      });
    } catch (error) {
      console.error("Pinned Blocks failed to reorder child blocks", error);
      toast({
        id: "pinned-blocks-reorder-failed",
        content: "Pinned Blocks could not reorder this parent's children.",
        intent: "danger",
      });
    }
  }

  const pinBlock = (uid?: string): void => {
    if (!uid) return;

    const parentUid = getParentUidByBlockUid(uid);
    if (!parentUid) {
      toast({
        id: "pinned-blocks-no-parent",
        content: "Pinned Blocks can only pin blocks that have a parent.",
        intent: "warning",
      });
      return;
    }

    if (getPinnedParentUid({ uid, settings: currentSettings }) === parentUid) {
      toast({
        id: "pinned-blocks-already-pinned",
        content: "That block is already pinned to its parent.",
      });
      return;
    }

    persistSettings(
      addPinnedUid({ settings: currentSettings, parentUid, uid }),
    );
    syncWatchers();
    scheduleEnforceParent(parentUid);
    toast({
      id: "pinned-blocks-pinned",
      content: "Pinned block to the top of its parent.",
      intent: "success",
    });
  };

  const unpinBlock = (uid?: string): void => {
    if (!uid) return;

    const parentUid = getPinnedParentUid({ uid, settings: currentSettings });
    if (!parentUid) {
      toast({
        id: "pinned-blocks-not-pinned",
        content: "That block is not pinned.",
      });
      return;
    }

    persistSettings(removePinnedUid({ settings: currentSettings, uid }));
    syncWatchers();
    toast({
      id: "pinned-blocks-unpinned",
      content: "Unpinned block.",
      intent: "success",
    });
  };

  const getFocusedUid = (): string | null =>
    window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"] || null;

  const mutationObserver = new MutationObserver(scheduleIndicatorSync);
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  window.roamAlphaAPI.ui.blockContextMenu.addCommand({
    label: PIN_CONTEXT_COMMAND,
    callback: (context) => pinBlock(context["block-uid"]),
  });
  window.roamAlphaAPI.ui.blockContextMenu.addCommand({
    label: UNPIN_CONTEXT_COMMAND,
    callback: (context) => unpinBlock(context["block-uid"]),
  });

  void extensionAPI.ui.commandPalette.addCommand({
    label: TOGGLE_PIN_COMMAND,
    callback: () => {
      const uid = getFocusedUid();
      if (!uid) return;

      if (getPinnedParentUid({ uid, settings: currentSettings })) {
        unpinBlock(uid);
      } else {
        pinBlock(uid);
      }
    },
  });
  void extensionAPI.ui.commandPalette.addCommand({
    label: UNPIN_FOCUSED_COMMAND,
    callback: () => unpinBlock(getFocusedUid() || undefined),
  });

  syncWatchers();
  Object.keys(currentSettings).forEach(scheduleEnforceParent);
  scheduleIndicatorSync();

  if (process.env.NODE_ENV === "development") {
    renderToast({
      id: "pinned-blocks-loaded",
      content: "Successfully loaded Pinned Blocks",
      intent: "success",
      timeout: 500,
    });
  }

  return {
    elements: [style],
    commands: [TOGGLE_PIN_COMMAND, UNPIN_FOCUSED_COMMAND],
    unload: () => {
      if (indicatorTimeout !== null) window.clearTimeout(indicatorTimeout);
      mutationObserver.disconnect();
      enforceTimeouts.forEach((timeout) => window.clearTimeout(timeout));
      enforceTimeouts.clear();
      watcherCleanups.forEach((cleanup) => cleanup());
      watcherCleanups.clear();
      document
        .querySelectorAll<HTMLElement>(`.${PINNED_BLOCK_CLASS}`)
        .forEach(removePinnedIndicator);
      window.roamAlphaAPI.ui.blockContextMenu.removeCommand({
        label: PIN_CONTEXT_COMMAND,
      });
      window.roamAlphaAPI.ui.blockContextMenu.removeCommand({
        label: UNPIN_CONTEXT_COMMAND,
      });
    },
  };
});
