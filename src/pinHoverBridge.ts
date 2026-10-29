export const createPinHoverBridge = (
  hostSelector: string,
): { clear: () => void; cleanup: () => void } => {
  let hovered: Element | null = null;
  const clear = (): void => {
    hovered?.removeAttribute("data-roamjs-pin-hover");
    hovered = null;
  };
  const onPointerMove = (event: PointerEvent): void => {
    const target = event.target;
    // Roam's outline guide overlays the row gutter without belonging to the row.
    const next =
      target instanceof Element && target.closest(".rm-multibar")
        ? document
            .elementsFromPoint(event.clientX, event.clientY)
            .find((element) => element.matches(hostSelector)) || null
        : null;
    if (next === hovered) return;
    clear();
    hovered = next;
    hovered?.setAttribute("data-roamjs-pin-hover", "true");
  };
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", clear);
  window.addEventListener("blur", clear);
  return {
    clear,
    cleanup: (): void => {
      clear();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", clear);
      window.removeEventListener("blur", clear);
    },
  };
};
