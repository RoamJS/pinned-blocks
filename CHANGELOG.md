# Changelog

## 1.0.0

- Added Pinned Blocks for child blocks under any parent block or page.
- Added clearer package description and search keywords for Roam Depot discovery.
- Added command palette and block context menu actions for pinning and unpinning.
- Added a separate command palette action for pinning the focused block.
- Added parent watchers that keep pinned children at the top with Roam's native reorder API, including same-parent order changes.
- Added a visible Blueprint 3 pin indicator with CSS classes and variables for custom styling.
- Matched the default pin indicator color to Roam's native icon color.
- Adjusted the default pin indicator size to better align with Roam's native icons.
- Changed moved pinned blocks to stay pinned under their new parent.
- Changed pinned block order to follow drag-and-drop order within each pinned group.
- Changed pin storage to shared graph records under `roam/js/pinned-blocks` so extension users in multiplayer graphs use the same pins.
- Added an extension-managed notice and one namespaced child record per pinned block.
- Removed browser local-storage persistence and fallback behavior.
- Fixed pinned indicators flickering when Roam refreshes block hover controls.
- Fixed pins under daily note pages disappearing after reloading the extension.
- Fixed rapid pin and unpin actions so shared graph mutations run in order.
- Fixed in-flight shared-state synchronization so it cannot restore watchers after the extension unloads.
- Fixed extension resources being registered when asynchronous startup finishes after the extension unloads.
- Fixed stale pin indicators that could remain when Roam reuses rendered block containers.
- Fixed pin indicators being clipped when pinned pages are viewed in the right sidebar.
- Fixed graph record props to use Roam's normalized key format and repair records written with duplicate namespace prefixes.
- Documented that collaborators without the extension can see reorders without seeing pin indicators.
