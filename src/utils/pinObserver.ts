const PIN_STRUCTURE_SELECTOR = [
  ".roam-block-container",
  ".rm-mentions",
  ".rm-reference-container",
  ".rm-ref-page-view",
  ".rm-reference-item",
  ".rm-sidebar-window",
  ".rm-title-display-container",
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
          mutation.target.matches(PIN_STRUCTURE_SELECTOR)
        : mutation.type === "childList" &&
          [...mutation.addedNodes, ...mutation.removedNodes].some(
            containsPinStructure,
          ),
    );
    if (changed) onChange();
  });
  // Text edits cannot change pin identity. React may replace text nodes rather
  // than mutate them, so child-list notifications also need structural filtering.
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "id",
      "data-block-uid",
      "data-page-title",
      "data-page-uid",
      "data-page-links",
      "data-path-page-links",
    ],
  });
  return observer;
};
