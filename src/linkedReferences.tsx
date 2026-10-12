import React from "react";
import ReactDOM from "react-dom";
import { Button } from "@blueprintjs/core";
import {
  getReferencePinKey,
  getReferenceTargetUid,
  type ReferencePin,
} from "~/utils/referencePins";

export const LINKED_REFERENCE_STYLES = `
      .roamjs-reference-pin-list { display: flex; flex-direction: column; }
      .roamjs-reference-pin-group { display: contents; }
      .roamjs-reference-pin-row { display: grid; grid-template-columns: minmax(0, 1fr) 28px; align-items: start; }
      .roamjs-reference-pin-row > .rm-reference-item { grid-column: 1; grid-row: 2; width: auto; min-width: 0; }
      .roamjs-reference-pin-control { display: contents; }
      .roamjs-reference-pin-control > button { grid-column: 2; grid-row: 2; }
      .roamjs-reference-pin-source { grid-column: 1 / -1; grid-row: 1; padding: 4px 8px; font-size: 12px; color: var(--roamjs-reference-pin-source-color, inherit); opacity: 0.8; overflow-wrap: anywhere; }
      .roamjs-reference-pin-active { order: -1; }
      .roamjs-reference-pin-heading { order: -2; padding: 8px 16px; font-size: 12px; font-weight: 600; color: inherit; }
      .roamjs-reference-pin-list .rm-ref-page-view .roamjs-reference-pin-row { margin-inline-start: 8px; }
      .roamjs-reference-pin-list .rm-ref-page-view > .rm-title-arrow-wrapper { margin-inline-start: 4px; }
      .roamjs-reference-pin-empty-heading { display: none; }
`;

const CONTROL_CLASS = "roamjs-reference-pin-control";
const LIST_CLASS = "roamjs-reference-pin-list";
const FLATTEN_CLASS = "roamjs-reference-pin-group";
const ROW_CLASS = "roamjs-reference-pin-row";
const PINNED_CLASS = "roamjs-reference-pin-active";
const HEADER_CLASS = "roamjs-reference-pin-heading";
const EMPTY_HEADING_CLASS = "roamjs-reference-pin-empty-heading";
const LAYOUT_CLASSES = [
  LIST_CLASS,
  FLATTEN_CLASS,
  ROW_CLASS,
  PINNED_CLASS,
  EMPTY_HEADING_CLASS,
];

type MountedControl = { mount: HTMLSpanElement; signature: string };
type MountedHeader = { mount: HTMLDivElement; count: number };

const PinControl = ({
  pinned,
  pending,
  sourceTitle,
  onClick,
  onKeyDown,
}: {
  pinned: boolean;
  pending: boolean;
  sourceTitle: string;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}): React.ReactElement => (
  <>
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
    {pinned && sourceTitle && (
      <span className="roamjs-reference-pin-source">{sourceTitle}</span>
    )}
  </>
);

const PinnedHeading = ({ count }: { count: number }): React.ReactElement => (
  <div role="heading" aria-level={3}>
    Pinned references <span>({count})</span>
  </div>
);

export const createLinkedReferenceControls = ({
  togglePin,
}: {
  togglePin: (pin: ReferencePin) => Promise<void>;
}): { sync: (pins: ReferencePin[]) => void; cleanup: () => void } => {
  const controls = new Map<HTMLElement, MountedControl>();
  const headers = new Map<HTMLElement, MountedHeader>();
  const decorated = new Set<HTMLElement>();
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
    row.classList.remove(...LAYOUT_CLASSES);
    controls.delete(row);
  };
  const removeHeader = (list: HTMLElement, header: MountedHeader): void => {
    ReactDOM.unmountComponentAtNode(header.mount);
    header.mount.remove();
    headers.delete(list);
  };
  const navigateControls = ({
    event,
    row,
  }: {
    event: React.KeyboardEvent<HTMLElement>;
    row: HTMLElement;
  }): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const list = row.closest(".rm-mentions");
    const buttons = [...controls.entries()]
      .filter(([candidate]) => candidate.closest(".rm-mentions") === list)
      .map(([candidate, control]) => ({
        row: candidate,
        button: control.mount.querySelector<HTMLButtonElement>("button"),
      }))
      .filter(
        (entry): entry is { row: HTMLElement; button: HTMLButtonElement } =>
          Boolean(
            entry.button &&
            !entry.button.disabled &&
            entry.row.getClientRects().length,
          ),
      )
      .sort(
        (a, b) =>
          a.row.getBoundingClientRect().top - b.row.getBoundingClientRect().top,
      );
    const index = buttons.findIndex((entry) => entry.row === row);
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    next.button.focus();
  };
  const runToggle = async (pin: ReferencePin): Promise<void> => {
    const key = getReferencePinKey(pin);
    if (inactive || pendingKeys.has(key)) return;
    pendingKeys.add(key);
    sync(latestPins);
    try {
      await togglePin(pin);
    } catch (error) {
      console.error("Pinned Blocks failed to toggle a linked reference", error);
    } finally {
      pendingKeys.delete(key);
      if (!inactive) sync(latestPins);
    }
  };
  const sync = (pins: ReferencePin[]): void => {
    if (inactive) return;
    latestPins = pins;
    const pinnedKeys = new Set(pins.map(getReferencePinKey));
    const activeRows = new Set<HTMLElement>();
    const activeDecorations = new Set<HTMLElement>();
    const rowsByList = new Map<HTMLElement, HTMLElement[]>();
    document
      .querySelectorAll<HTMLElement>(".rm-reference-item")
      .forEach((item) => {
        const list = item.closest<HTMLElement>(".rm-mentions");
        // Unlinked references share the native result classes.
        if (
          !list?.parentElement
            ?.querySelector(":scope > .flex-h-box strong")
            ?.textContent?.match(/\bLinked References?\b/)
        )
          return;
        const block = item.querySelector<HTMLElement>(
          ".roam-block-container[data-block-uid]",
        );
        const input = block?.querySelector<HTMLElement>(
          ":scope > .rm-block-main .roam-block[id], :scope > .rm-block-main textarea[id]",
        );
        const targetUid = getReferenceTargetUid(input?.id || "");
        const blockUid = block?.dataset.blockUid;
        const row = item.parentElement;
        if (!targetUid || !blockUid || !row || row === list) return;
        const pin = { targetUid, blockUid };
        const key = getReferencePinKey(pin);
        const pinned = pinnedKeys.has(key);
        const pending = pendingKeys.has(key);
        const sourceTitle = block?.dataset.pageTitle || "";
        activeRows.add(row);
        rowsByList.set(list, [...(rowsByList.get(list) || []), row]);
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
          targetUid,
          blockUid,
          pinned,
          pending,
          sourceTitle,
        ]);
        if (control.signature !== signature) {
          control.signature = signature;
          ReactDOM.render(
            <PinControl
              pinned={pinned}
              pending={pending}
              sourceTitle={sourceTitle}
              onClick={(): void => {
                void runToggle(pin);
              }}
              onKeyDown={(event): void => navigateControls({ event, row })}
            />,
            control.mount,
          );
        }
        row.classList.toggle(PINNED_CLASS, pinned);
        decorate(row, ROW_CLASS, activeDecorations);
      });
    const activeLists = new Set<HTMLElement>();
    rowsByList.forEach((rows, list) => {
      const count = rows.filter((row) =>
        row.classList.contains(PINNED_CLASS),
      ).length;
      if (!count) return;
      activeLists.add(list);
      decorate(list, LIST_CLASS, activeDecorations);
      let header = headers.get(list);
      if (!header || !list.contains(header.mount)) {
        if (header) removeHeader(list, header);
        const mount = document.createElement("div");
        mount.className = HEADER_CLASS;
        list.prepend(mount);
        header = { mount, count: -1 };
        headers.set(list, header);
      }
      if (header.count !== count) {
        header.count = count;
        ReactDOM.render(<PinnedHeading count={count} />, header.mount);
      }
      const groups = new Set<HTMLElement>();
      rows.forEach((row) => {
        const group = row.closest<HTMLElement>(".rm-ref-page-view");
        if (group) groups.add(group);
        // The source rows remain Roam-owned; flatten their ancestors for display ordering only.
        for (
          let ancestor = row.parentElement;
          ancestor && ancestor !== list;
          ancestor = ancestor.parentElement
        ) {
          decorate(ancestor, FLATTEN_CLASS, activeDecorations);
        }
      });
      groups.forEach((group) => {
        const groupRows = rows.filter(
          (row) => row.closest(".rm-ref-page-view") === group,
        );
        const heading = group.querySelector<HTMLElement>(
          ":scope > .rm-title-arrow-wrapper",
        );
        if (
          heading &&
          groupRows.every((row) => row.classList.contains(PINNED_CLASS))
        )
          decorate(heading, EMPTY_HEADING_CLASS, activeDecorations);
      });
    });
    controls.forEach((control, row) => {
      if (!activeRows.has(row)) removeControl(row, control);
    });
    headers.forEach((header, list) => {
      if (!activeLists.has(list)) removeHeader(list, header);
    });
    decorated.forEach((element) => {
      if (!activeDecorations.has(element)) {
        element.classList.remove(...LAYOUT_CLASSES);
        decorated.delete(element);
      }
    });
  };
  return {
    sync,
    cleanup: (): void => {
      inactive = true;
      controls.forEach((control, row) => removeControl(row, control));
      headers.forEach((header, list) => removeHeader(list, header));
      decorated.forEach((element) =>
        element.classList.remove(...LAYOUT_CLASSES),
      );
      decorated.clear();
    },
  };
};
