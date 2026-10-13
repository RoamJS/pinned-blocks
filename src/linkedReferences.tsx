import React from "react";
import ReactDOM from "react-dom";
import { Button } from "@blueprintjs/core";
import {
  getReferencePinKey,
  getReferenceTargetUid,
  type ReferencePin,
} from "~/utils/referencePins";
import {
  matchesReferenceFilters,
  readReferenceDetails,
  type ReferenceDetails,
  type ReferenceFilters,
} from "~/utils/referenceDetails";

export const LINKED_REFERENCE_STYLES = `
  .roamjs-reference-pin-row { display: grid; grid-template-columns: minmax(0, 1fr) 28px; align-items: start; }
  .roamjs-reference-pin-row > .rm-reference-item { grid-column: 1; width: auto; min-width: 0; }
  .roamjs-reference-pin-control { display: contents; }
  .roamjs-reference-pin-control > button { grid-column: 2; }
  .roamjs-reference-pin-control > button[aria-pressed="false"][aria-busy="false"] { opacity: 0; pointer-events: none; }
  .roamjs-reference-pin-row:hover > .roamjs-reference-pin-control > button,
  .roamjs-reference-pin-row:focus-within > .roamjs-reference-pin-control > button { opacity: 1; pointer-events: auto; }
  .roamjs-reference-pin-source { padding: 4px 8px; font-size: 12px; opacity: 0.8; overflow-wrap: anywhere; }
  .roamjs-reference-pin-heading { padding: 8px 12px; font-size: 12px; font-weight: 600; }
  .roamjs-reference-pin-active { margin: 0 4px 8px 12px; }
  .roamjs-reference-pin-active > .rm-reference-item { background: var(--roamjs-reference-pin-background, rgba(137, 160, 179, 0.08)); }
  .roamjs-reference-pin-duplicate, .roamjs-reference-pin-empty-heading { display: none !important; }
`;
const CONTROL_CLASS = "roamjs-reference-pin-control";
const ROW_CLASS = "roamjs-reference-pin-row";
const DUPLICATE_CLASS = "roamjs-reference-pin-duplicate";
const EMPTY_HEADING_CLASS = "roamjs-reference-pin-empty-heading";
const PANEL_CLASS = "roamjs-reference-pin-panel";
type MountedControl = { mount: HTMLSpanElement; signature: string };
type MountedPanel = { mount: HTMLDivElement; signature: string };
type RenderBlock = (args: {
  uid: string;
  el: HTMLElement;
  "zoom-path?": boolean;
}) => Promise<unknown>;
type UnmountBlock = (args: { el: HTMLElement }) => Promise<unknown>;
type PinnedEntry = ReferencePin & ReferenceDetails;

const PinButton = ({
  pinned,
  pending,
  onClick,
  onKeyDown,
}: {
  pinned: boolean;
  pending: boolean;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}): React.ReactElement => (
  <Button
    minimal
    small
    icon="pin"
    active={pinned}
    loading={pending}
    disabled={pending}
    aria-pressed={pinned}
    aria-busy={pending}
    aria-label={pinned ? "Unpin linked reference" : "Pin linked reference"}
    aria-description="Use the Up and Down arrow keys to move between reference pin controls."
    title={
      pinned ? "Unpin linked reference" : "Pin linked reference to the top"
    }
    onClick={(event): void => {
      event.stopPropagation();
      onClick();
    }}
    onKeyDown={onKeyDown}
  />
);

const NativeBlock = ({
  uid,
  renderBlock,
  unmountBlock,
}: {
  uid: string;
  renderBlock: RenderBlock;
  unmountBlock: UnmountBlock;
}): React.ReactElement => {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    void renderBlock({ uid, el, "zoom-path?": true })
      .then(() => {
        if (disposed) void unmountBlock({ el });
      })
      .catch((error: unknown) => {
        if (!disposed)
          console.error("Pinned Blocks failed to render a reference", error);
      });
    return (): void => {
      disposed = true;
      void unmountBlock({ el });
    };
  }, [uid, renderBlock, unmountBlock]);
  return <div ref={ref} />;
};

export const createLinkedReferenceControls = ({
  togglePin,
  readReference = readReferenceDetails,
  renderBlock = (args): Promise<unknown> =>
    window.roamAlphaAPI.ui.components.renderBlock(args),
  unmountBlock = (args): Promise<unknown> =>
    window.roamAlphaAPI.ui.components.unmountNode(args),
}: {
  togglePin: (pin: ReferencePin) => Promise<void>;
  readReference?: (pin: ReferencePin) => ReferenceDetails | null;
  renderBlock?: RenderBlock;
  unmountBlock?: UnmountBlock;
}): { sync: (pins: ReferencePin[]) => void; cleanup: () => void } => {
  const controls = new Map<HTMLElement, MountedControl>();
  const panels = new Map<HTMLElement, MountedPanel>();
  const decorated = new Set<HTMLElement>();
  const targets = new WeakMap<HTMLElement, string>();
  const resolvingTargets = new WeakSet<HTMLElement>();
  const pendingKeys = new Set<string>();
  let latestPins: ReferencePin[] = [];
  let inactive = false;
  const decorate = (
    element: HTMLElement,
    className: string,
    active: Set<HTMLElement>,
  ): void => {
    element.classList.add(className);
    decorated.add(element);
    active.add(element);
  };
  const removeControl = (row: HTMLElement, control: MountedControl): void => {
    ReactDOM.unmountComponentAtNode(control.mount);
    control.mount.remove();
    controls.delete(row);
  };
  const removePanel = (list: HTMLElement, panel: MountedPanel): void => {
    ReactDOM.unmountComponentAtNode(panel.mount);
    panel.mount.remove();
    panels.delete(list);
  };
  const navigateControls = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const button = event.currentTarget;
    const list = button.closest(".rm-mentions");
    const buttons = Array.from(
      list?.querySelectorAll<HTMLButtonElement>(`.${CONTROL_CLASS} > button`) ||
        [],
    )
      .filter(
        (candidate) =>
          !candidate.disabled && Boolean(candidate.getClientRects().length),
      )
      .sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
      );
    const index = buttons.indexOf(button as HTMLButtonElement);
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    next.focus();
  };
  const runToggle = async (pin: ReferencePin): Promise<void> => {
    const key = getReferencePinKey(pin);
    if (inactive || pendingKeys.has(key)) return;
    pendingKeys.add(key);
    sync(latestPins);
    try {
      await togglePin({ targetUid: pin.targetUid, blockUid: pin.blockUid });
    } catch (error) {
      console.error("Pinned Blocks failed to toggle a linked reference", error);
    } finally {
      pendingKeys.delete(key);
      if (!inactive) sync(latestPins);
    }
  };
  const getSidebarWindow = (
    list: HTMLElement,
  ):
    | {
        type: string;
        "page-uid"?: string;
        "block-uid"?: string;
      }
    | undefined => {
    const sidebar = list.closest(".rm-sidebar-window");
    return window.roamAlphaAPI?.ui.rightSidebar
      ?.getWindows()
      .find(
        (entry) => sidebar?.id === `sidebar-window-${entry["window-id"]}`,
      ) as
      | { type: string; "page-uid"?: string; "block-uid"?: string }
      | undefined;
  };
  const getFilters = (
    list: HTMLElement,
    targetUid: string,
  ): ReferenceFilters[] => {
    const api = window.roamAlphaAPI?.ui.filters;
    if (!api) return [];
    // The installed Roam types use page-uid here; the filters API expects block-uid.
    const getSidebarFilters = api.getSidebarWindowFilters as unknown as (args: {
      window: { type: string; "block-uid": string };
    }) => ReferenceFilters;
    const sidebarType = getSidebarWindow(list)?.type || "mentions";
    const local = list.closest("#right-sidebar, .roam-right-sidebar-content")
      ? getSidebarFilters({
          window: { "block-uid": targetUid, type: sidebarType },
        })
      : api.getPageLinkedRefsFilters({ page: { uid: targetUid } });
    return [api.getGlobalFilters(), local];
  };
  const sync = (pins: ReferencePin[]): void => {
    if (inactive) return;
    latestPins = pins;
    const activeRows = new Set<HTMLElement>();
    const activePanels = new Set<HTMLElement>();
    const activeDecorations = new Set<HTMLElement>();
    document.querySelectorAll<HTMLElement>(".rm-mentions").forEach((list) => {
      if (
        !list.parentElement
          ?.querySelector(":scope > .flex-h-box strong")
          ?.textContent?.match(/\bLinked References?\b/)
      )
        return;
      const rows = Array.from(
        list.querySelectorAll<HTMLElement>(".rm-reference-item"),
      )
        .filter((item) => !item.closest(`.${PANEL_CLASS}`))
        .map((item) => {
          const block = item.querySelector<HTMLElement>(
            ".roam-block-container[data-block-uid]",
          );
          const input = block?.querySelector<HTMLElement>(
            ":scope > .rm-block-main .roam-block[id], :scope > .rm-block-main textarea[id]",
          );
          const targetUid = getReferenceTargetUid(input?.id || "");
          const blockUid = block?.dataset.blockUid;
          const row = item.parentElement;
          return targetUid && blockUid && row && row !== list
            ? { row, pin: { targetUid, blockUid } }
            : null;
        })
        .filter((entry): entry is { row: HTMLElement; pin: ReferencePin } =>
          Boolean(entry),
        );
      const sidebarWindow = getSidebarWindow(list);
      const targetUid =
        rows[0]?.pin.targetUid ||
        sidebarWindow?.["page-uid"] ||
        sidebarWindow?.["block-uid"] ||
        targets.get(list);
      if (!targetUid) {
        const getMainTarget =
          window.roamAlphaAPI?.ui.mainWindow?.getOpenPageOrBlockUid;
        if (
          list.closest(".roam-article") &&
          !list.closest("#right-sidebar, .roam-right-sidebar-content") &&
          getMainTarget &&
          !resolvingTargets.has(list)
        ) {
          resolvingTargets.add(list);
          const url = window.location.href;
          void getMainTarget()
            .then((uid) => {
              if (
                inactive ||
                !list.isConnected ||
                window.location.href !== url ||
                !uid
              )
                return;
              targets.set(list, uid);
              sync(latestPins);
            })
            .catch((error: unknown) => {
              if (!inactive)
                console.error(
                  "Pinned Blocks failed to resolve a reference target",
                  error,
                );
            })
            .finally(() => resolvingTargets.delete(list));
        }
        return;
      }
      targets.set(list, targetUid);
      const filters = getFilters(list, targetUid);
      const entries: PinnedEntry[] = pins
        .filter((pin) => pin.targetUid === targetUid)
        .flatMap((pin) => {
          const detail = readReference(pin);
          return detail &&
            matchesReferenceFilters({ titles: detail.titles, filters })
            ? [{ ...pin, ...detail }]
            : [];
        });
      const shownKeys = new Set(entries.map(getReferencePinKey));
      if (entries.length) {
        activePanels.add(list);
        let panel = panels.get(list);
        if (!panel || !list.contains(panel.mount)) {
          if (panel) removePanel(list, panel);
          const mount = document.createElement("div");
          mount.className = PANEL_CLASS;
          list.prepend(mount);
          panel = { mount, signature: "" };
          panels.set(list, panel);
        }
        const signature = JSON.stringify(
          entries.map((entry) => [
            entry,
            pendingKeys.has(getReferencePinKey(entry)),
          ]),
        );
        if (panel.signature !== signature) {
          panel.signature = signature;
          ReactDOM.render(
            <>
              <div
                className="roamjs-reference-pin-heading"
                role="heading"
                aria-level={3}
              >
                Pinned references ({entries.length})
              </div>
              {entries.map((pin) => (
                <React.Fragment key={getReferencePinKey(pin)}>
                  <div className="roamjs-reference-pin-source">
                    {pin.sourceTitle}
                  </div>
                  <div
                    className={`${ROW_CLASS} roamjs-reference-pin-active`}
                    data-reference-pin-uid={pin.blockUid}
                  >
                    <div className="rm-reference-item">
                      <NativeBlock
                        uid={pin.blockUid}
                        renderBlock={renderBlock}
                        unmountBlock={unmountBlock}
                      />
                    </div>
                    <span className={CONTROL_CLASS}>
                      <PinButton
                        pinned
                        pending={pendingKeys.has(getReferencePinKey(pin))}
                        onClick={(): void => {
                          void runToggle(pin);
                        }}
                        onKeyDown={navigateControls}
                      />
                    </span>
                  </div>
                </React.Fragment>
              ))}
            </>,
            panel.mount,
          );
        }
      }
      rows.forEach(({ row, pin }) => {
        activeRows.add(row);
        decorate(row, ROW_CLASS, activeDecorations);
        row.classList.toggle(
          DUPLICATE_CLASS,
          shownKeys.has(getReferencePinKey(pin)),
        );
        let control = controls.get(row);
        if (!control || !row.contains(control.mount)) {
          if (control) removeControl(row, control);
          const mount = document.createElement("span");
          mount.className = CONTROL_CLASS;
          row.appendChild(mount);
          control = { mount, signature: "" };
          controls.set(row, control);
        }
        const signature = JSON.stringify([
          pin,
          pendingKeys.has(getReferencePinKey(pin)),
        ]);
        if (control.signature !== signature) {
          control.signature = signature;
          ReactDOM.render(
            <PinButton
              pinned={false}
              pending={pendingKeys.has(getReferencePinKey(pin))}
              onClick={(): void => {
                void runToggle(pin);
              }}
              onKeyDown={navigateControls}
            />,
            control.mount,
          );
        }
      });
      const groups = new Set(
        rows.map(({ row }) => row.closest<HTMLElement>(".rm-ref-page-view")),
      );
      groups.forEach((group) => {
        if (!group) return;
        const groupRows = rows.filter(
          ({ row }) => row.closest(".rm-ref-page-view") === group,
        );
        const heading = group.querySelector<HTMLElement>(
          ":scope > .rm-title-arrow-wrapper",
        );
        if (
          heading &&
          groupRows.every(({ pin }) => shownKeys.has(getReferencePinKey(pin)))
        )
          decorate(heading, EMPTY_HEADING_CLASS, activeDecorations);
      });
    });
    controls.forEach((control, row) => {
      if (!activeRows.has(row)) removeControl(row, control);
    });
    panels.forEach((panel, list) => {
      if (!activePanels.has(list)) removePanel(list, panel);
    });
    decorated.forEach((element) => {
      if (!activeDecorations.has(element)) {
        element.classList.remove(
          ROW_CLASS,
          DUPLICATE_CLASS,
          EMPTY_HEADING_CLASS,
        );
        decorated.delete(element);
      }
    });
  };
  let filterSnapshot = "";
  // Roam can change filters without changing any currently loaded result rows.
  const filterPoll = window.setInterval(() => {
    if (inactive || !latestPins.length) return;
    const snapshot = JSON.stringify(
      Array.from(
        document.querySelectorAll<HTMLElement>(".rm-mentions"),
      ).flatMap((list) => {
        const targetUid = targets.get(list);
        return targetUid ? [[targetUid, getFilters(list, targetUid)]] : [];
      }),
    );
    if (snapshot === filterSnapshot) return;
    filterSnapshot = snapshot;
    sync(latestPins);
  }, 500);
  return {
    sync,
    cleanup: (): void => {
      inactive = true;
      window.clearInterval(filterPoll);
      controls.forEach((control, row) => removeControl(row, control));
      panels.forEach((panel, list) => removePanel(list, panel));
      decorated.forEach((element) =>
        element.classList.remove(
          ROW_CLASS,
          DUPLICATE_CLASS,
          EMPTY_HEADING_CLASS,
        ),
      );
      decorated.clear();
    },
  };
};
