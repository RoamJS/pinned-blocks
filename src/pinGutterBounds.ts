const SHIFT_PROPERTY = "--roamjs-pin-edge-shift";
const EDGE_ATTRIBUTE = "data-roamjs-pin-edge";

export const createPinGutterBounds = (): {
  refresh: () => void;
  cleanup: () => void;
} => {
  let frame: number | null = null;
  let inactive = false;
  let shiftedControls = new Set<HTMLElement>();
  const observed = new Set<Element>();
  const clear = (control: HTMLElement): void => {
    control.style.removeProperty(SHIFT_PROPERTY);
    control.removeAttribute(EDGE_ATTRIBUTE);
  };
  const update = (): void => {
    frame = null;
    if (inactive) return;
    const nextObserved = new Set<Element>();
    const shifts = new Map<HTMLElement, number>();
    classObserver.disconnect();
    document
      .querySelectorAll<HTMLElement>(".roam-body-main .roam-article")
      .forEach((article) => {
        if (article.closest("#right-sidebar, .roam-right-sidebar-content"))
          return;
        const pane = article.closest<HTMLElement>(".roam-body-main")!;
        const wrapper = article.closest<HTMLElement>(".rm-article-wrapper");
        nextObserved.add(pane);
        nextObserved.add(article);
        if (wrapper)
          classObserver.observe(wrapper, {
            attributes: true,
            attributeFilter: ["class"],
          });
        const visibleLeft = Math.max(
          0,
          pane.getBoundingClientRect().left,
          wrapper?.getBoundingClientRect().left || 0,
        );
        article
          .querySelectorAll<HTMLElement>(
            ".roamjs-outline-pin-control, .roamjs-reference-pin-near-bullet > .roamjs-reference-pin-control",
          )
          .forEach((control) => {
            const button = control.querySelector(":scope > button");
            if (!button?.getClientRects().length) return;
            const previous =
              Number.parseFloat(
                control.style.getPropertyValue(SHIFT_PROPERTY),
              ) || 0;
            const originalLeft = button.getBoundingClientRect().left - previous;
            const shift = Math.ceil(visibleLeft + 1 - originalLeft);
            if (shift > 0) shifts.set(control, shift);
          });
      });
    shiftedControls.forEach((control) => {
      if (!shifts.has(control)) clear(control);
    });
    shifts.forEach((shift, control) => {
      const value = `${shift}px`;
      if (control.style.getPropertyValue(SHIFT_PROPERTY) === value) return;
      control.style.setProperty(SHIFT_PROPERTY, value);
      control.setAttribute(EDGE_ATTRIBUTE, "");
    });
    shiftedControls = new Set(shifts.keys());
    observed.forEach((element) => {
      if (!nextObserved.has(element)) {
        resizeObserver.unobserve(element);
        observed.delete(element);
      }
    });
    nextObserved.forEach((element) => {
      if (!observed.has(element)) {
        resizeObserver.observe(element);
        observed.add(element);
      }
    });
  };
  const refresh = (): void => {
    if (!inactive && frame === null)
      frame = window.requestAnimationFrame(update);
  };
  const resizeObserver = new ResizeObserver(refresh);
  const classObserver = new MutationObserver(refresh);
  window.addEventListener("resize", refresh);
  return {
    refresh,
    cleanup: (): void => {
      inactive = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      classObserver.disconnect();
      window.removeEventListener("resize", refresh);
      shiftedControls.forEach(clear);
      shiftedControls.clear();
      observed.clear();
    },
  };
};
