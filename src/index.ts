import { render as renderToast } from "roamjs-components/components/Toast";
import addStyle from "roamjs-components/dom/addStyle";
import getPageUidByPageTitle from "roamjs-components/queries/getPageUidByPageTitle";
import getParentUidByBlockUid from "roamjs-components/queries/getParentUidByBlockUid";
import getShallowTreeByParentUid from "roamjs-components/queries/getShallowTreeByParentUid";
import type { OnloadArgs, PullBlock } from "roamjs-components/types";
import {
  CONFIG_PAGE_TITLE,
  LEGACY_STORAGE_KEY,
  NOTICE_TEXT,
  buildPinnedBlocksByParent,
  blockPropsRequireRewrite,
  createNoticeRecordProps,
  createPinRecordProps,
  getPinnedBlocksRecordProps,
  mergePinnedBlocksRecordProps,
  normalizeBlockProps,
  summarizeConfigRecords,
  type BlockProps,
  type ConfigChild,
  type ConfigRecordSummary,
} from "~/utils/pinRecords";
import {
  getDesiredChildOrder,
  getLegacyPinnedUidsToMigrate,
  getPinnedParentUid,
  ordersMatch,
  reconcilePinsForParent,
  shouldRemovePinnedIndicator,
  type PinnedBlocksByParent,
} from "~/utils/pins";

type ExtensionAPI = OnloadArgs["extensionAPI"];
type PullWatchCallback = Parameters<
  typeof window.roamAlphaAPI.data.addPullWatch
>[2];
type ConfigPullChild = {
  ":block/order"?: number;
  ":block/props"?: BlockProps;
  ":block/string"?: string;
  ":block/uid"?: string;
};

const TOGGLE_PIN_COMMAND = "Pinned Blocks: Toggle Pin Focused Block";
const PIN_FOCUSED_COMMAND = "Pinned Blocks: Pin Focused Block";
const UNPIN_FOCUSED_COMMAND = "Pinned Blocks: Unpin Focused Block";
const MIGRATE_LEGACY_COMMAND =
  "Pinned Blocks: Migrate Legacy Pins to Shared Storage";
const PIN_CONTEXT_COMMAND = "Pinned Blocks: Pin block";
const UNPIN_CONTEXT_COMMAND = "Pinned Blocks: Unpin block";
const PARENT_PULL_PATTERN = "[{:block/children [:block/uid :block/order]}]";
const CONFIG_PULL_PATTERN =
  "[{:block/children [:block/uid :block/string :block/order :block/props]}]";
const WATCH_DEBOUNCE_MS = 120;
const STYLE_ID = "roamjs-pinned-blocks-style";
const PINNED_BLOCK_CLASS = "roamjs-pinned-blocks-block";
const PINNED_BLOCK_ACTIVE_CLASS = "roamjs-pinned-blocks-block-pinned";
const INDICATOR_CLASS = "roamjs-pinned-blocks-indicator";
const UID_SUFFIX_REGEX = /[A-Za-z0-9_-]{9}$/;

const createRoamPage = async (title: string): Promise<string> => {
  const uid = window.roamAlphaAPI.util.generateUID();
  await window.roamAlphaAPI.data.page.create({ page: { title, uid } });
  return uid;
};

const createRoamBlock = async ({
  parentUid,
  order,
  text,
  props,
}: {
  parentUid: string;
  order: number | "last";
  text: string;
  props: BlockProps;
}): Promise<string> => {
  const uid = window.roamAlphaAPI.util.generateUID();
  await window.roamAlphaAPI.data.block.create({
    location: { "parent-uid": parentUid, order },
    block: { uid, string: text, props },
  });
  return uid;
};

const deleteRoamBlock = (uid: string): Promise<void> =>
  window.roamAlphaAPI.data.block.delete({ block: { uid } });

const updateRoamBlock = ({
  uid,
  text,
  props,
}: {
  uid: string;
  text?: string;
  props?: BlockProps;
}): Promise<void> =>
  window.roamAlphaAPI.data.block.update({
    block: {
      uid,
      ...(text === undefined ? {} : { string: text }),
      ...(props === undefined ? {} : { props }),
    },
  });

const toast = ({
  id,
  content,
  intent = "primary",
}: {
  id: string;
  content: string;
  intent?: "primary" | "success" | "warning" | "danger";
}): void => {
  renderToast({ id, content, intent, timeout: 3000 });
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
  container
    .querySelector<HTMLElement>(`:scope > .${INDICATOR_CLASS}`)
    ?.remove();
};

const readConfigChildren = (pageUid: string): ConfigChild[] =>
  (
    window.roamAlphaAPI.data.fast.q(
      `[:find (pull ?c [:block/uid :block/string :block/order :block/props]) :where [?p :block/uid "${pageUid}"] [?p :block/children ?c]]`,
    ) as Array<[ConfigPullChild]>
  )
    .map(([child]) => {
      const rawProps = child[":block/props"];
      return {
        order: child[":block/order"] || 0,
        props: normalizeBlockProps(rawProps),
        propsRequireRewrite: blockPropsRequireRewrite(rawProps),
        text: child[":block/string"] || "",
        uid: child[":block/uid"] || "",
      };
    })
    .filter((child) => child.uid)
    .sort((a, b) => a.order - b.order);

const readLatestBlockProps = (uid: string): BlockProps => {
  const block = window.roamAlphaAPI.data.pull("[:block/props]", [
    ":block/uid",
    uid,
  ]) as PullBlock | null;
  return normalizeBlockProps(block?.[":block/props"]);
};

const getPinRecordText = (uid: string): string => `Pinned block data: ${uid}`;

const initializeExtension = async ({
  extensionAPI,
}: OnloadArgs): Promise<() => void> => {
  let currentSettings: PinnedBlocksByParent = {};
  let configWatcherCleanup: (() => void) | null = null;
  let configWatcherPageUid = "";
  const parentWatcherCleanups = new Map<string, () => void>();
  const enforceTimeouts = new Map<string, number>();
  let mutationQueue: Promise<void> = Promise.resolve();
  let configSyncTimeout: number | null = null;
  let indicatorFrame: number | null = null;
  let suppressRemovedToastUntil = 0;
  let isUnloading = false;
  let hasCleanedUp = false;
  let mutationObserver: MutationObserver | null = null;
  let pinContextCommandRegistered = false;
  let unpinContextCommandRegistered = false;
  let migrationInProgress = false;
  const paletteCommandsRegistered = new Set<string>();

  const style = addStyle(
    `
      .${PINNED_BLOCK_CLASS} {
        position: relative;
      }

      .${PINNED_BLOCK_ACTIVE_CLASS}::before {
        align-items: center;
        color: var(--roamjs-pinned-blocks-indicator-color, #5c7080);
        content: "\\e646";
        display: inline-flex;
        font-family: "Icons16", sans-serif;
        font-size: var(--roamjs-pinned-blocks-indicator-size, 13px);
        font-style: normal;
        font-weight: 400;
        height: var(--roamjs-pinned-blocks-indicator-size, 13px);
        justify-content: center;
        left: var(--roamjs-pinned-blocks-indicator-left, -18px);
        line-height: var(--roamjs-pinned-blocks-indicator-size, 13px);
        -moz-osx-font-smoothing: grayscale;
        opacity: var(--roamjs-pinned-blocks-indicator-opacity, 0.9);
        pointer-events: none;
        position: absolute;
        top: var(--roamjs-pinned-blocks-indicator-top, 5px);
        -webkit-font-smoothing: antialiased;
        width: var(--roamjs-pinned-blocks-indicator-size, 13px);
        z-index: var(--roamjs-pinned-blocks-indicator-z-index, 1);
      }

      #right-sidebar .${PINNED_BLOCK_ACTIVE_CLASS}::before,
      .roam-right-sidebar-content .${PINNED_BLOCK_ACTIVE_CLASS}::before {
        left: var(--roamjs-pinned-blocks-sidebar-indicator-left, 5px);
      }
    `,
    STYLE_ID,
  );

  const enqueueMutation = <T>(mutation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.catch(() => undefined).then(mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const ensureConfigPage = async (): Promise<string> => {
    const existingUid = getPageUidByPageTitle(CONFIG_PAGE_TITLE);
    if (existingUid) return existingUid;

    try {
      return await createRoamPage(CONFIG_PAGE_TITLE);
    } catch (error) {
      const concurrentlyCreatedUid = getPageUidByPageTitle(CONFIG_PAGE_TITLE);
      if (concurrentlyCreatedUid) return concurrentlyCreatedUid;
      throw error;
    }
  };

  const deleteBlockIfPresent = async (uid: string): Promise<void> => {
    try {
      await deleteRoamBlock(uid);
    } catch (error) {
      if (getParentUidByBlockUid(uid)) throw error;
    }
  };

  const ensureNotice = async (pageUid: string): Promise<void> => {
    let children = readConfigChildren(pageUid);
    let summary = summarizeConfigRecords(children);

    if (!summary.canonicalNoticeUid) {
      const existingTextBlock = children.find(
        (child) => child.text === NOTICE_TEXT,
      );
      if (existingTextBlock) {
        await updateRoamBlock({
          uid: existingTextBlock.uid,
          props: mergePinnedBlocksRecordProps({
            props: readLatestBlockProps(existingTextBlock.uid),
            record: { type: "notice", version: 1 },
          }),
        });
      } else {
        await createRoamBlock({
          parentUid: pageUid,
          order: 0,
          text: NOTICE_TEXT,
          props: createNoticeRecordProps(),
        });
      }

      children = readConfigChildren(pageUid);
      summary = summarizeConfigRecords(children);
    }

    if (summary.canonicalNoticeUid) {
      const notice = children.find(
        (child) => child.uid === summary.canonicalNoticeUid,
      );
      if (
        notice &&
        (notice.text !== NOTICE_TEXT || notice.propsRequireRewrite)
      ) {
        await updateRoamBlock({
          uid: notice.uid,
          ...(notice.text === NOTICE_TEXT ? {} : { text: NOTICE_TEXT }),
          ...(notice.propsRequireRewrite
            ? {
                props: mergePinnedBlocksRecordProps({
                  props: notice.props,
                  record: { type: "notice", version: 1 },
                }),
              }
            : {}),
        });
      }
    }

    await Promise.all(
      summary.duplicateRecordUids
        .filter((uid) =>
          children.some(
            (child) =>
              child.uid === uid &&
              getPinnedBlocksRecordProps(child.props)?.type === "notice",
          ),
        )
        .map(deleteBlockIfPresent),
    );
  };

  const reconcileConfigRecords = async (): Promise<{
    pageUid: string;
    summary: ConfigRecordSummary;
  }> => {
    const pageUid = await ensureConfigPage();
    await ensureNotice(pageUid);

    let children = readConfigChildren(pageUid);
    let summary = summarizeConfigRecords(children);
    if (summary.duplicateRecordUids.length) {
      await Promise.all(summary.duplicateRecordUids.map(deleteBlockIfPresent));
      children = readConfigChildren(pageUid);
      summary = summarizeConfigRecords(children);
    }

    const recordsToRepair = children.filter(
      (child) =>
        child.propsRequireRewrite &&
        getPinnedBlocksRecordProps(child.props)?.type === "pin",
    );
    if (recordsToRepair.length) {
      await Promise.all(
        recordsToRepair.map((child) =>
          updateRoamBlock({ uid: child.uid, props: child.props }),
        ),
      );
      children = readConfigChildren(pageUid);
      summary = summarizeConfigRecords(children);
    }

    return { pageUid, summary };
  };

  const removePinRecords = async (pinnedUids: string[]): Promise<number> => {
    const { summary } = await reconcileConfigRecords();
    const recordUids = pinnedUids.flatMap(
      (uid) => summary.pinRecordUidsByPinnedUid.get(uid) || [],
    );
    await Promise.all(recordUids.map(deleteBlockIfPresent));
    return recordUids.length;
  };

  const syncPinnedIndicators = (): void => {
    indicatorFrame = null;
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
    if (indicatorFrame !== null) window.cancelAnimationFrame(indicatorFrame);
    indicatorFrame = window.requestAnimationFrame(syncPinnedIndicators);
  }

  const cleanupParentWatcher = (parentUid: string): void => {
    const cleanup = parentWatcherCleanups.get(parentUid);
    if (!cleanup) return;
    cleanup();
    parentWatcherCleanups.delete(parentUid);
  };

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

  const ensureParentWatcher = (parentUid: string): void => {
    if (parentWatcherCleanups.has(parentUid)) return;

    const entityId = `[:block/uid "${parentUid}"]`;
    const watcher: PullWatchCallback = () => scheduleEnforceParent(parentUid);
    window.roamAlphaAPI.data.addPullWatch(
      PARENT_PULL_PATTERN,
      entityId,
      watcher,
    );
    parentWatcherCleanups.set(parentUid, () => {
      window.roamAlphaAPI.data.removePullWatch(
        PARENT_PULL_PATTERN,
        entityId,
        watcher,
      );
    });
  };

  const syncParentWatchers = (): void => {
    const activeParentUids = new Set(Object.keys(currentSettings));
    activeParentUids.forEach(ensureParentWatcher);
    parentWatcherCleanups.forEach((_, parentUid) => {
      if (!activeParentUids.has(parentUid)) cleanupParentWatcher(parentUid);
    });
  };

  const applyCurrentSettings = (settings: PinnedBlocksByParent): void => {
    currentSettings = settings;
    syncParentWatchers();
    scheduleIndicatorSync();
  };

  const maybeToastRemovedPin = (removedCount: number): void => {
    if (!removedCount || Date.now() <= suppressRemovedToastUntil) return;
    suppressRemovedToastUntil = Date.now() + 5000;
    toast({
      id: "pinned-blocks-stale-pin-removed",
      content:
        "Pinned Blocks removed a stale pin because the block was not found.",
      intent: "warning",
    });
  };

  async function enforceParentOrder(parentUid: string): Promise<void> {
    enforceTimeouts.delete(parentUid);
    if (isUnloading) return;

    const currentChildUids = getDirectChildUids(parentUid);
    const reconciled = reconcilePinsForParent({
      settings: currentSettings,
      parentUid,
      directChildUids: currentChildUids,
      getParentUidByBlockUid,
    });

    if (reconciled.changed) {
      applyCurrentSettings(reconciled.settings);
      reconciled.affectedParentUids.forEach(scheduleEnforceParent);

      if (reconciled.removedUids.length) {
        try {
          const removedCount = await enqueueMutation(() =>
            removePinRecords(reconciled.removedUids),
          );
          maybeToastRemovedPin(removedCount);
        } catch (error) {
          console.error(
            "Pinned Blocks failed to remove stale pin records",
            error,
          );
        }
      }
    }

    const activePinnedUids = currentSettings[parentUid] || [];
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

  const ensureConfigWatcher = (pageUid: string): void => {
    if (configWatcherPageUid === pageUid && configWatcherCleanup) return;
    configWatcherCleanup?.();

    const entityId = `[:block/uid "${pageUid}"]`;
    const watcher: PullWatchCallback = () => scheduleConfigSync();
    window.roamAlphaAPI.data.addPullWatch(
      CONFIG_PULL_PATTERN,
      entityId,
      watcher,
    );
    configWatcherPageUid = pageUid;
    configWatcherCleanup = () => {
      window.roamAlphaAPI.data.removePullWatch(
        CONFIG_PULL_PATTERN,
        entityId,
        watcher,
      );
    };
  };

  const synchronizeSharedState = async (): Promise<void> => {
    if (isUnloading) return;

    const { pageUid, summary } = await enqueueMutation(reconcileConfigRecords);
    if (isUnloading) return;
    ensureConfigWatcher(pageUid);

    const { settings, staleUids } = buildPinnedBlocksByParent({
      pinnedUids: summary.pinnedUids,
      getParentUidByBlockUid,
      getDirectChildUids,
    });
    applyCurrentSettings(settings);

    if (staleUids.length) {
      try {
        const removedCount = await enqueueMutation(() =>
          removePinRecords(staleUids),
        );
        maybeToastRemovedPin(removedCount);
      } catch (error) {
        console.error("Pinned Blocks failed to clean stale pin records", error);
      }
    }

    Object.keys(settings).forEach(scheduleEnforceParent);
  };

  function scheduleConfigSync(): void {
    if (configSyncTimeout !== null) {
      window.clearTimeout(configSyncTimeout);
    }
    configSyncTimeout = window.setTimeout(() => {
      configSyncTimeout = null;
      void synchronizeSharedState().catch((error) => {
        console.error("Pinned Blocks failed to synchronize shared pins", error);
        toast({
          id: "pinned-blocks-sync-failed",
          content: "Pinned Blocks could not synchronize shared pin data.",
          intent: "danger",
        });
      });
    }, WATCH_DEBOUNCE_MS);
  }

  const migrateLegacySettings = async (): Promise<number> => {
    const rawSettings = extensionAPI.settings.get(LEGACY_STORAGE_KEY);
    if (
      rawSettings === undefined ||
      rawSettings === null ||
      rawSettings === ""
    ) {
      return 0;
    }

    let migratedCount = 0;

    await enqueueMutation(async () => {
      const { pageUid, summary } = await reconcileConfigRecords();
      const existingPinnedUids = new Set(summary.pinnedUids);
      const legacyPinnedUids = getLegacyPinnedUidsToMigrate({
        rawSettings,
        existingPinnedUids,
        getParentUidByBlockUid,
      });

      for (const uid of legacyPinnedUids) {
        await createRoamBlock({
          parentUid: pageUid,
          order: "last",
          text: getPinRecordText(uid),
          props: createPinRecordProps(uid),
        });
        existingPinnedUids.add(uid);
        migratedCount += 1;
      }
    });

    await synchronizeSharedState();
    await extensionAPI.settings.set(LEGACY_STORAGE_KEY, "");
    return migratedCount;
  };

  const runLegacyMigration = async (): Promise<void> => {
    if (migrationInProgress) return;
    migrationInProgress = true;

    try {
      const migratedCount = await migrateLegacySettings();
      toast({
        id: "pinned-blocks-migrated",
        content: migratedCount
          ? `Pinned Blocks migrated ${migratedCount} saved pin${migratedCount === 1 ? "" : "s"} to shared graph storage.`
          : "Pinned Blocks found no legacy pins that still needed migration.",
        intent: "success",
      });
    } catch (error) {
      console.error("Pinned Blocks failed to migrate legacy settings", error);
      toast({
        id: "pinned-blocks-migration-failed",
        content:
          "Pinned Blocks could not migrate saved pins. Run the migration command to retry.",
        intent: "danger",
      });
    } finally {
      migrationInProgress = false;
    }
  };

  const pinBlock = async (uid?: string): Promise<void> => {
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

    try {
      const created = await enqueueMutation(async () => {
        const { pageUid, summary } = await reconcileConfigRecords();
        if (summary.pinRecordUidsByPinnedUid.has(uid)) return false;
        await createRoamBlock({
          parentUid: pageUid,
          order: "last",
          text: getPinRecordText(uid),
          props: createPinRecordProps(uid),
        });
        return true;
      });

      if (!created) {
        toast({
          id: "pinned-blocks-already-pinned",
          content: "That block is already pinned to its parent.",
        });
        return;
      }

      await synchronizeSharedState();
      scheduleEnforceParent(parentUid);
      toast({
        id: "pinned-blocks-pinned",
        content: "Pinned block to the top of its parent.",
        intent: "success",
      });
    } catch (error) {
      console.error(
        "Pinned Blocks failed to create a shared pin record",
        error,
      );
      toast({
        id: "pinned-blocks-pin-failed",
        content: "Pinned Blocks could not pin this block.",
        intent: "danger",
      });
    }
  };

  const unpinBlock = async (uid?: string): Promise<void> => {
    if (!uid) return;

    try {
      const removedCount = await enqueueMutation(() => removePinRecords([uid]));
      if (!removedCount) {
        toast({
          id: "pinned-blocks-not-pinned",
          content: "That block is not pinned.",
        });
        return;
      }

      await synchronizeSharedState();
      toast({
        id: "pinned-blocks-unpinned",
        content: "Unpinned block.",
        intent: "success",
      });
    } catch (error) {
      console.error(
        "Pinned Blocks failed to remove a shared pin record",
        error,
      );
      toast({
        id: "pinned-blocks-unpin-failed",
        content: "Pinned Blocks could not unpin this block.",
        intent: "danger",
      });
    }
  };

  const getFocusedUid = (): string | null =>
    window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"] || null;

  const cleanup = (): void => {
    if (hasCleanedUp) return;
    hasCleanedUp = true;
    isUnloading = true;
    if (indicatorFrame !== null) window.cancelAnimationFrame(indicatorFrame);
    if (configSyncTimeout !== null) window.clearTimeout(configSyncTimeout);
    mutationObserver?.disconnect();
    enforceTimeouts.forEach((timeout) => window.clearTimeout(timeout));
    enforceTimeouts.clear();
    parentWatcherCleanups.forEach((cleanup) => cleanup());
    parentWatcherCleanups.clear();
    configWatcherCleanup?.();
    configWatcherCleanup = null;
    document
      .querySelectorAll<HTMLElement>(`.${PINNED_BLOCK_CLASS}`)
      .forEach(removePinnedIndicator);
    if (pinContextCommandRegistered) {
      window.roamAlphaAPI.ui.blockContextMenu.removeCommand({
        label: PIN_CONTEXT_COMMAND,
      });
    }
    if (unpinContextCommandRegistered) {
      window.roamAlphaAPI.ui.blockContextMenu.removeCommand({
        label: UNPIN_CONTEXT_COMMAND,
      });
    }
    paletteCommandsRegistered.forEach((label) => {
      void extensionAPI.ui.commandPalette.removeCommand({ label });
    });
    paletteCommandsRegistered.clear();
    style.remove();
  };

  try {
    await enqueueMutation(reconcileConfigRecords);
    await synchronizeSharedState();

    mutationObserver = new MutationObserver(scheduleIndicatorSync);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.roamAlphaAPI.ui.blockContextMenu.addCommand({
      label: PIN_CONTEXT_COMMAND,
      callback: (context) => void pinBlock(context["block-uid"]),
    });
    pinContextCommandRegistered = true;
    window.roamAlphaAPI.ui.blockContextMenu.addCommand({
      label: UNPIN_CONTEXT_COMMAND,
      callback: (context) => void unpinBlock(context["block-uid"]),
    });
    unpinContextCommandRegistered = true;

    await extensionAPI.ui.commandPalette.addCommand({
      label: TOGGLE_PIN_COMMAND,
      callback: () => {
        const uid = getFocusedUid();
        if (!uid) return;
        if (getPinnedParentUid({ uid, settings: currentSettings })) {
          void unpinBlock(uid);
        } else {
          void pinBlock(uid);
        }
      },
    });
    paletteCommandsRegistered.add(TOGGLE_PIN_COMMAND);
    await extensionAPI.ui.commandPalette.addCommand({
      label: PIN_FOCUSED_COMMAND,
      callback: () => void pinBlock(getFocusedUid() || undefined),
    });
    paletteCommandsRegistered.add(PIN_FOCUSED_COMMAND);
    await extensionAPI.ui.commandPalette.addCommand({
      label: UNPIN_FOCUSED_COMMAND,
      callback: () => void unpinBlock(getFocusedUid() || undefined),
    });
    paletteCommandsRegistered.add(UNPIN_FOCUSED_COMMAND);

    await extensionAPI.ui.commandPalette.addCommand({
      label: MIGRATE_LEGACY_COMMAND,
      callback: () => void runLegacyMigration(),
    });
    paletteCommandsRegistered.add(MIGRATE_LEGACY_COMMAND);

    if (process.env.NODE_ENV === "development") {
      renderToast({
        id: "pinned-blocks-loaded",
        content: "Successfully loaded Pinned Blocks",
        intent: "success",
        timeout: 500,
      });
    }

    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
};

let unloadExtension: (() => void) | null = null;

export default {
  onload: async (args: OnloadArgs): Promise<void> => {
    try {
      unloadExtension = await initializeExtension(args);
    } catch (error) {
      console.error("Pinned Blocks failed to load", error);
      toast({
        id: "pinned-blocks-load-failed",
        content: "Pinned Blocks failed to load.",
        intent: "danger",
      });
    }
  },
  onunload: (): void => {
    unloadExtension?.();
    unloadExtension = null;
  },
};
