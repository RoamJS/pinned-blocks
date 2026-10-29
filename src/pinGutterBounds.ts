const SHIFT_PROPERTY = "--roamjs-pin-edge-shift";
const EDGE_ATTRIBUTE = "data-roamjs-pin-edge";

export const createPinGutterBounds = (): {
  refresh: () => void;
  cleanup: () => void;
} => {
  let frame: number | null = null;
  let inactive = false;
  const articles = new Set<HTMLElement>();
  const observed = new Set<Element>();
  const clear = (article: HTMLElement): void => {
    article.style.removeProperty(SHIFT_PROPERTY);
    article.removeAttribute(EDGE_ATTRIBUTE);
  };
  const update = (): void => {
    frame = null;
    if (inactive) return;
    const nextObserved = new Set<Element>();
    const active = new Set<HTMLElement>();
    classObserver.disconnect();
    document
      .querySelectorAll<HTMLElement>(".roam-body-main .roam-article")
      .forEach((article) => {
        if (article.closest("#right-sidebar, .roam-right-sidebar-content"))
          return;
        active.add(article);
        articles.add(article);
        const pane = article.closest<HTMLElement>(".roam-body-main")!;
        const wrapper = article.closest<HTMLElement>(".rm-article-wrapper");
        nextObserved.add(pane);
        nextObserved.add(article);
        if (wrapper)
          classObserver.observe(wrapper, {
            attributes: true,
            attributeFilter: ["class"],
          });
        const buttons = Array.from(
          article.querySelectorAll<HTMLElement>(
            ".roamjs-outline-pin-control > button, .roamjs-reference-pin-near-bullet > .roamjs-reference-pin-control > button",
          ),
        ).filter((button) => button.getClientRects().length);
        if (!buttons.length) {
          clear(article);
          return;
        }
        const previous =
          Number.parseFloat(article.style.getPropertyValue(SHIFT_PROPERTY)) ||
          0;
        const originalLeft =
          Math.min(
            ...buttons.map((button) => button.getBoundingClientRect().left),
          ) - previous;
        const visibleLeft = Math.max(
          0,
          pane.getBoundingClientRect().left,
          wrapper?.getBoundingClientRect().left || 0,
        );
        const shift = Math.max(0, Math.ceil(visibleLeft + 1 - originalLeft));
        if (shift) {
          article.setAttribute(EDGE_ATTRIBUTE, "");
          article.style.setProperty(SHIFT_PROPERTY, `${shift}px`);
        } else clear(article);
      });
    articles.forEach((article) => {
      if (!active.has(article)) {
        clear(article);
        articles.delete(article);
      }
    });
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
      articles.forEach(clear);
      articles.clear();
      observed.clear();
    },
  };
};
