import React from "react";
import ReactDOM from "react-dom";
import { Button, Icon } from "@blueprintjs/core";
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
  .roamjs-reference-pin-row:focus-within > .roamjs-reference-pin-control > button,
  .roamjs-reference-pin-title-row:hover > .roamjs-reference-pin-control > button,
  .roamjs-reference-pin-title-row:focus-within > .roamjs-reference-pin-control > button { opacity: 1; pointer-events: auto; }
  .roamjs-reference-pin-page .rm-ref-page-view-title { min-width: 0; overflow-wrap: anywhere; }
  .roamjs-reference-pin-page .rm-caret { cursor: pointer; flex-shrink: 0; }
  .roamjs-reference-pin-title-row { display: flex; align-items: center; }
  .roamjs-reference-pin-title-row > .roamjs-reference-pin-control { display: inline-flex; margin-left: auto; }
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
type MountedPanel = {
  mount: HTMLDivElement;
  signature: string;
  renderedKeys: Set<string>;
  onRendered: (key: string) => void;
  pageHeadings: Map<string, HTMLElement>;
};
type RenderBlock = (args: {
  uid: string;
  el: HTMLElement;
  "zoom-path?": boolean;
}) => Promise<unknown>;
type UnmountBlock = (args: { el: HTMLElement }) => Promise<unknown>;
type PinnedEntry = ReferencePin &
  ReferenceDetails & { pageExpanded?: boolean; pageExpandable?: boolean };
const getSourcePageHref = (uid: string): string => {
  const url = new URL(window.location.href);
  const graphRoot = url.hash.match(/^#\/(?:app|offline)\/[^/?#]+/)?.[0];
  if (!graphRoot) return url.href;
  url.hash = `${graphRoot}/page/${encodeURIComponent(uid)}`;
  return url.href;
};

const SourcePageLink = ({
  title,
  uid,
}: {
  title: string;
  uid?: string;
}): React.ReactElement =>
  uid ? (
    <a
      className="rm-page-ref"
      href={getSourcePageHref(uid)}
      onClick={(event): void => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.button !== 0
        )
          return;
        event.preventDefault();
        if (event.shiftKey) {
          // Installed types use page-uid, but Roam requires block-uid for all window types.
          const addWindow = window.roamAlphaAPI.ui.rightSidebar
            .addWindow as unknown as (args: {
            window: { type: "outline"; "block-uid": string };
          }) => Promise<void>;
          void addWindow({ window: { type: "outline", "block-uid": uid } });
        } else {
          void window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid } });
        }
      }}
    >
      {title}
    </a>
  ) : (
    <>{title}</>
  );

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

const PinnedBlockGroup = ({
  title,
  uid,
  children,
}: {
  title: string;
  uid?: string;
  children: React.ReactNode;
}): React.ReactElement => {
  const [expanded, setExpanded] = React.useState(true);
  return (
    <div className="rm-ref-page-view roamjs-reference-pin-page">
      <div className="rm-title-arrow-wrapper roamjs-reference-pin-title-row">
        <Icon
          icon="caret-down"
          className={`rm-caret ${expanded ? "rm-caret-open" : "rm-caret-closed"} rm-caret-showing`}
          role="button"
          tabIndex={0}
          title={
            expanded ? "Collapse pinned reference" : "Expand pinned reference"
          }
          aria-label={
            expanded ? "Collapse pinned reference" : "Expand pinned reference"
          }
          aria-expanded={expanded}
          onClick={(): void => setExpanded((previous) => !previous)}
          onKeyDown={(event): void => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        />
        <div className="rm-ref-page-view-title roamjs-reference-pin-source">
          <SourcePageLink title={title} uid={uid} />
        </div>
      </div>
      <div hidden={!expanded}>{children}</div>
    </div>
  );
};

const NativeBlock = ({
  uid,
  pinKey,
  renderBlock,
  unmountBlock,
  onRendered,
}: {
  uid: string;
  pinKey: string;
  renderBlock: RenderBlock;
  unmountBlock: UnmountBlock;
  onRendered: (key: string) => void;
}): React.ReactElement => {
  const ref = React.useRef<HTMLDivElement>(null);
  const unmounting = React.useRef<Promise<unknown>>(Promise.resolve());
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    void unmounting.current
      .then(() => {
        if (!disposed) return renderBlock({ uid, el, "zoom-path?": false });
      })
      .then(() => {
        if (disposed) {
          void unmountBlock({ el });
          return;
        }
        onRendered(pinKey);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setFailed(true);
          console.error("Pinned Blocks failed to render a reference", error);
        }
      });
    return (): void => {
      disposed = true;
      unmounting.current = unmountBlock({ el });
    };
  }, [uid, pinKey, renderBlock, unmountBlock, onRendered, attempt]);
  return (
    <>
      <div ref={ref} />
      {failed && (
        <div role="status">
          Couldn’t load this pinned reference.
          <Button
            minimal
            small
            text="Retry"
            onClick={(): void => {
              setFailed(false);
              setAttempt((previous) => previous + 1);
            }}
          />
        </div>
      )}
    </>
  );
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
  const mainTargets = new WeakMap<
    HTMLElement,
    { url: string; uid: string | null }
  >();
  const resolvingTargets = new WeakMap<HTMLElement, { url: string }>();
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
        "mentions-uid"?: string;
      }
    | undefined => {
    const sidebar = list.closest(".rm-sidebar-window");
    return window.roamAlphaAPI?.ui.rightSidebar
      ?.getWindows()
      .find(
        (entry) => sidebar?.id === `sidebar-window-${entry["window-id"]}`,
      ) as
      | {
          type: string;
          "page-uid"?: string;
          "block-uid"?: string;
          "mentions-uid"?: string;
        }
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
      const nativeRows = Array.from(
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
      const isMainList =
        Boolean(list.closest(".roam-article")) &&
        !list.closest("#right-sidebar, .roam-right-sidebar-content");
      const url = window.location.href;
      const getMainTarget =
        window.roamAlphaAPI?.ui.mainWindow?.getOpenPageOrBlockUid;
      const hasMainTargetGetter = Boolean(getMainTarget);
      const mainTarget = mainTargets.get(list);
      const dailyTarget = isMainList
        ? list
            .closest(".roam-log-page")
            ?.querySelector<HTMLElement>(
              ".rm-title-display-container[data-page-uid]",
            )?.dataset.pageUid
        : undefined;
      const needsMainTarget =
        isMainList && hasMainTargetGetter && mainTarget?.url !== url;
      const targetUid = needsMainTarget
        ? undefined
        : isMainList && hasMainTargetGetter
          ? mainTarget?.uid || dailyTarget || nativeRows[0]?.pin.targetUid
          : sidebarWindow?.["page-uid"] ||
            sidebarWindow?.["block-uid"] ||
            sidebarWindow?.["mentions-uid"] ||
            nativeRows[0]?.pin.targetUid ||
            targets.get(list);
      if (!targetUid) {
        if (
          needsMainTarget &&
          hasMainTargetGetter &&
          resolvingTargets.get(list)?.url !== url
        ) {
          const request = { url };
          resolvingTargets.set(list, request);
          void getMainTarget()
            .then((uid) => {
              if (inactive || !list.isConnected || window.location.href !== url)
                return;
              mainTargets.set(list, { url, uid });
              sync(latestPins);
            })
            .catch((error: unknown) => {
              if (!inactive)
                console.error(
                  "Pinned Blocks failed to resolve a reference target",
                  error,
                );
            })
            .finally(() => {
              if (resolvingTargets.get(list) === request)
                resolvingTargets.delete(list);
            });
        }
        return;
      }
      targets.set(list, targetUid);
      const rows = nativeRows.filter(({ pin }) => pin.targetUid === targetUid);
      const hiddenBlockUidsByHeading = new Map<HTMLElement, string[]>();
      const pageHeadings = new Map<string, HTMLElement>();
      const filters = getFilters(list, targetUid);
      // A page title can itself reference the target, even when it has no block rows.
      list
        .querySelectorAll<HTMLElement>(".rm-ref-page-view")
        .forEach((group) => {
          if (group.closest(`.${PANEL_CLASS}`)) return;
          const heading = group.querySelector<HTMLElement>(
            ":scope > .rm-title-arrow-wrapper",
          );
          const title = heading
            ?.querySelector<HTMLElement>(".rm-ref-page-view-title")
            ?.textContent?.trim();
          if (!heading || !title) return;
          const source = window.roamAlphaAPI.data.fast.q(
            "[:find ?uid :in $ ?title :where [?p :node/title ?title] [?p :block/uid ?uid]]",
            title,
          )[0]?.[0] as string | undefined;
          if (!source) return;
          pageHeadings.set(source, heading);
          const pin = { targetUid, blockUid: source };
          const detail = readReference(pin);
          if (
            !detail?.isPage ||
            !matchesReferenceFilters({ titles: detail.titles, filters })
          )
            return;
          rows.push({ row: heading, pin });
          if (heading.querySelector(".rm-caret-closed")) {
            const hiddenBlockUids = window.roamAlphaAPI.data.fast
              .q(
                "[:find ?uid :in $ ?source ?target :where [?p :block/uid ?source] [?b :block/page ?p] [?b :block/uid ?uid] [?b :block/refs ?ref] [?ref :block/uid ?target]]",
                source,
                targetUid,
              )
              .map(([uid]) => uid as string);
            if (hiddenBlockUids.length)
              hiddenBlockUidsByHeading.set(heading, hiddenBlockUids);
          }
        });
      const entries: PinnedEntry[] = pins
        .filter((pin) => pin.targetUid === targetUid)
        .flatMap((pin) => {
          const detail = readReference(pin);
          return detail &&
            matchesReferenceFilters({ titles: detail.titles, filters })
            ? [
                {
                  ...pin,
                  ...detail,
                  ...(detail.isPage
                    ? {
                        pageExpandable: Boolean(
                          pageHeadings
                            .get(pin.blockUid)
                            ?.querySelector(".rm-caret"),
                        ),
                        pageExpanded: !pageHeadings
                          .get(pin.blockUid)
                          ?.querySelector(".rm-caret-closed"),
                      }
                    : {}),
                },
              ]
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
          const mountedPanel: MountedPanel = {
            mount,
            signature: "",
            renderedKeys: new Set(),
            pageHeadings,
            onRendered: (key): void => {
              if (inactive || panels.get(list) !== mountedPanel) return;
              mountedPanel.renderedKeys.add(key);
              sync(latestPins);
            },
          };
          panel = mountedPanel;
          panels.set(list, panel);
        }
        panel.pageHeadings = pageHeadings;
        panel.renderedKeys.forEach((key) => {
          if (!shownKeys.has(key)) panel.renderedKeys.delete(key);
        });
        const signature = JSON.stringify([
          entries.map((entry) => [
            entry,
            pendingKeys.has(getReferencePinKey(entry)),
          ]),
        ]);
        if (panel.signature !== signature) {
          panel.signature = signature;
          ReactDOM.render(
            <>
              <div className="roamjs-reference-pin-content">
                {entries.map((pin) =>
                  pin.isPage ? (
                    <div
                      key={getReferencePinKey(pin)}
                      className="rm-ref-page-view roamjs-reference-pin-page"
                      data-reference-pin-uid={pin.blockUid}
                    >
                      <div className="rm-title-arrow-wrapper roamjs-reference-pin-title-row">
                        <Icon
                          icon="caret-down"
                          className={`rm-caret ${pin.pageExpanded ? "rm-caret-open" : "rm-caret-closed"} rm-caret-showing`}
                          role="button"
                          tabIndex={pin.pageExpandable ? 0 : -1}
                          aria-disabled={!pin.pageExpandable}
                          title={
                            pin.pageExpanded
                              ? "Collapse source references"
                              : "Expand source references"
                          }
                          aria-label={
                            pin.pageExpanded
                              ? "Collapse source references"
                              : "Expand source references"
                          }
                          aria-expanded={pin.pageExpanded}
                          onClick={(): void => {
                            panel.pageHeadings
                              .get(pin.blockUid)
                              ?.querySelector<HTMLElement>(".rm-caret")
                              ?.click();
                            sync(latestPins);
                          }}
                          onKeyDown={(event): void => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.currentTarget.click();
                            }
                          }}
                        />
                        <div className="rm-ref-page-view-title">
                          <SourcePageLink
                            title={pin.sourceTitle}
                            uid={pin.sourceUid}
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
                    </div>
                  ) : (
                    <PinnedBlockGroup
                      key={getReferencePinKey(pin)}
                      title={pin.sourceTitle}
                      uid={pin.sourceUid}
                    >
                      <div
                        className={`${ROW_CLASS} roamjs-reference-pin-active`}
                        data-reference-pin-uid={pin.blockUid}
                      >
                        <div className="rm-reference-item">
                          <NativeBlock
                            uid={pin.blockUid}
                            pinKey={getReferencePinKey(pin)}
                            onRendered={panel.onRendered}
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
                    </PinnedBlockGroup>
                  ),
                )}
              </div>
            </>,
            panel.mount,
          );
        }
      }
      const renderedKeys = panels.get(list)?.renderedKeys;
      const hasRenderedCopy = (pin: ReferencePin): boolean => {
        const key = getReferencePinKey(pin);
        return (
          shownKeys.has(key) &&
          (Boolean(renderedKeys?.has(key)) ||
            Boolean(
              entries.find((entry) => getReferencePinKey(entry) === key)
                ?.isPage,
            ))
        );
      };
      const hasActiveFilters = filters.some(({ includes, removes }) =>
        Boolean(includes?.length || removes?.length),
      );
      const hasUnpinnedHiddenBlocks = (heading: HTMLElement): boolean =>
        (hiddenBlockUidsByHeading.get(heading) || []).some((blockUid) => {
          const pin = { targetUid, blockUid };
          if (hasRenderedCopy(pin)) return false;
          if (!hasActiveFilters) return true;
          const detail = readReference(pin);
          return (
            !detail ||
            matchesReferenceFilters({ titles: detail.titles, filters })
          );
        });
      rows.forEach(({ row, pin }) => {
        activeRows.add(row);
        const isTitle = row.classList.contains("rm-title-arrow-wrapper");
        decorate(
          row,
          isTitle ? "roamjs-reference-pin-title-row" : ROW_CLASS,
          activeDecorations,
        );
        // Keep a source heading when unpinned block results still need its context.
        const group = row.closest(".rm-ref-page-view");
        const hasUnpinnedBlocks =
          isTitle &&
          (hasUnpinnedHiddenBlocks(row) ||
            rows.some(
              (entry) =>
                entry.row !== row &&
                entry.row.closest(".rm-ref-page-view") === group &&
                !hasRenderedCopy(entry.pin),
            ));
        row.classList.toggle(
          DUPLICATE_CLASS,
          hasRenderedCopy(pin) && !hasUnpinnedBlocks,
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
          shownKeys.has(getReferencePinKey(pin)),
          pendingKeys.has(getReferencePinKey(pin)),
        ]);
        if (control.signature !== signature) {
          control.signature = signature;
          ReactDOM.render(
            <PinButton
              pinned={shownKeys.has(getReferencePinKey(pin))}
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
          !hasUnpinnedHiddenBlocks(heading) &&
          groupRows.every(({ pin }) => hasRenderedCopy(pin))
        )
          decorate(heading, EMPTY_HEADING_CLASS, activeDecorations);
        else heading?.classList.remove(EMPTY_HEADING_CLASS);
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
          "roamjs-reference-pin-title-row",
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
    if (inactive) return;
    const snapshot = JSON.stringify([
      window.location.href,
      Array.from(
        document.querySelectorAll<HTMLElement>(".rm-mentions"),
      ).flatMap((list) => {
        const targetUid = targets.get(list);
        return targetUid ? [[targetUid, getFilters(list, targetUid)]] : [];
      }),
    ]);
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
          "roamjs-reference-pin-title-row",
          DUPLICATE_CLASS,
          EMPTY_HEADING_CLASS,
        ),
      );
      decorated.clear();
    },
  };
};
