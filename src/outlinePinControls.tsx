import React from "react";
import ReactDOM from "react-dom";
import { Button } from "@blueprintjs/core";

const HOST_CLASS = "roamjs-outline-pin-host";
const CONTROL_CLASS = "roamjs-outline-pin-control";

export const OUTLINE_PIN_STYLES = `
  .${HOST_CLASS} { position: relative; }
  .${HOST_CLASS} > .${CONTROL_CLASS} { position: absolute; left: -24px; top: 0; z-index: 1; }
  #right-sidebar .${HOST_CLASS}, .roam-right-sidebar-content .${HOST_CLASS} { padding-left: 24px; }
  #right-sidebar .${HOST_CLASS} > .${CONTROL_CLASS}, .roam-right-sidebar-content .${HOST_CLASS} > .${CONTROL_CLASS} { left: 0; }
  .${CONTROL_CLASS} > button[aria-pressed="false"][aria-busy="false"] { opacity: 0; pointer-events: none; }
  .${HOST_CLASS}:hover > .${CONTROL_CLASS} > button,
  .${HOST_CLASS}:focus-within > .${CONTROL_CLASS} > button { opacity: 1; pointer-events: auto; }
  .roam-block-container:has(> .${HOST_CLASS})::before { display: none; }
`;

type Control = { mount: HTMLElement; uid: string; signature: string };

export const createOutlinePinControls = ({
  togglePin,
}: {
  togglePin: (uid: string) => Promise<void>;
}): {
  sync: (args: { enabled: boolean; pinnedUids: Set<string> }) => void;
  cleanup: () => void;
} => {
  const controls = new Map<HTMLElement, Control>();
  const pendingUids = new Set<string>();
  let latest = { enabled: false, pinnedUids: new Set<string>() };
  let inactive = false;
  const removeControl = (host: HTMLElement, control: Control): void => {
    ReactDOM.unmountComponentAtNode(control.mount);
    control.mount.remove();
    host.classList.remove(HOST_CLASS);
    controls.delete(host);
  };
  const runToggle = async (uid: string): Promise<void> => {
    if (inactive || pendingUids.has(uid)) return;
    pendingUids.add(uid);
    sync(latest);
    try {
      await togglePin(uid);
    } catch (error) {
      console.error("Pinned Blocks failed to toggle an outline pin", error);
    } finally {
      pendingUids.delete(uid);
      if (!inactive) sync(latest);
    }
  };
  const sync = (args: typeof latest): void => {
    latest = args;
    if (inactive) return;
    const active = new Set<HTMLElement>();
    if (args.enabled) {
      document
        .querySelectorAll<HTMLElement>(".roam-block-container")
        .forEach((container) => {
          // Reference controls pin to a target's results, rather than the source outline.
          if (
            container.closest(
              ".rm-reference-container, .rm-mentions, .rm-reference-item, .roamjs-reference-pin-panel",
            )
          )
            return;
          const host = container.querySelector<HTMLElement>(
            ":scope > .rm-block-main",
          );
          const input = host?.querySelector<HTMLElement>(
            ".roam-block[id], textarea.rm-block-input[id]",
          );
          const uid = input?.id.match(/[A-Za-z0-9_-]{9}$/)?.[0];
          if (!host || !uid) return;
          active.add(host);
          let control = controls.get(host);
          if (
            control &&
            (control.uid !== uid || control.mount.parentElement !== host)
          ) {
            removeControl(host, control);
            control = undefined;
          }
          if (!control) {
            const mount = document.createElement("span");
            mount.className = CONTROL_CLASS;
            host.prepend(mount);
            host.classList.add(HOST_CLASS);
            control = { mount, uid, signature: "" };
            controls.set(host, control);
          }
          const pinned = args.pinnedUids.has(uid);
          const pending = pendingUids.has(uid);
          const signature = JSON.stringify([pinned, pending]);
          if (control.signature === signature) return;
          control.signature = signature;
          ReactDOM.render(
            <Button
              minimal
              small
              icon="pin"
              active={pinned}
              loading={pending}
              disabled={pending}
              aria-pressed={pinned}
              aria-busy={pending}
              aria-label={pinned ? "Unpin block" : "Pin block"}
              title={
                pinned ? "Unpin block" : "Pin block to the top of its parent"
              }
              onMouseDown={(event): void => event.preventDefault()}
              onClick={(event): void => {
                event.stopPropagation();
                void runToggle(uid);
              }}
            />,
            control.mount,
          );
        });
    }
    controls.forEach((control, host) => {
      if (!active.has(host)) removeControl(host, control);
    });
  };
  return {
    sync,
    cleanup: (): void => {
      inactive = true;
      controls.forEach((control, host) => removeControl(host, control));
    },
  };
};
