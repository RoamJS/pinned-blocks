const PIN_STRUCTURE_SELECTOR = [
  ".roam-block-container",
  ".rm-mentions",
  ".rm-reference-container",
  ".rm-ref-page-view",
  ".rm-reference-item",
  ".rm-sidebar-window",
  ".rm-title-display-container",
  ".rm-title-arrow-wrapper",
  ".roam-block",
  "textarea",
].join(", ");

const containsPinStructure = (node: Node): boolean =>
  node instanceof Element &&
  (node.matches(PIN_STRUCTURE_SELECTOR) ||
    Boolean(node.querySelector(PIN_STRUCTURE_SELECTOR)));

export const observePinStructure = ({
  root,
  onChange,
}: {
  root: HTMLElement;
  onChange: () => void;
}): MutationObserver => {
  const observer = new MutationObserver((mutations) => {
    const changed = mutations.some((mutation) =>
      mutation.type === "attributes"
        ? mutation.target instanceof Element &&
          (mutation.attributeName === "class"
            ? mutation.target.matches(
                ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper > .rm-caret",
              )
            : mutation.target.matches(PIN_STRUCTURE_SELECTOR))
        : (mutation.type === "characterData" ||
            mutation.type === "childList") &&
          (Boolean(
            (mutation.target instanceof Element
              ? mutation.target
              : mutation.target.parentElement
            )?.closest(".rm-ref-page-view-title"),
          ) ||
            (mutation.type === "childList" &&
              [...mutation.addedNodes, ...mutation.removedNodes].some(
                containsPinStructure,
              ))),
    );
    if (changed) onChange();
  });
  // Native source headings identify page-title references. Only those text edits
  // and structural changes affect pins; ordinary block typing stays ignored.
  observer.observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "class",
      "id",
      "data-block-uid",
      "data-page-title",
      "data-link-title",
      "data-page-uid",
      "data-page-links",
      "data-path-page-links",
    ],
  });
  return observer;
};
