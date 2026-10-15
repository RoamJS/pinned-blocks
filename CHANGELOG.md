# Changelog

## 1.0.0

- Fixed pinned source-page links opened in a new tab or copied while the main window is on Search or another non-page route.

- Added native-style source-page carets to collapse and expand individual pinned block references.

- Removed duplicate source breadcrumbs from pinned blocks and matched pinned pages to native page-reference rows.

- Matched pinned source-page links to the size and opacity of regular linked-reference source titles.

- Removed the pinned-reference heading and group collapse control so pinned references always stay visible.

- Hid pin controls for filtered-out title references without removing their saved pins.

- Fixed Shift-click on pinned source labels opening pages in the sidebar.

- Avoided reading entire source-page outlines while displaying title reference pins.

- Made pinned source page titles clickable, including Shift-click to open the sidebar.
- Added pins for linked references that come from page titles.

- Fixed unnecessary pin refreshes during ordinary typing; reference rows, navigation, and reference-tag changes still refresh pins.

- Fixed sidebar navigation retaining the previous target’s pins and unpin controls while old reference rows remain visible.

- Fixed saved reference pins loading in Daily Notes articles whose source groups are initially collapsed.

- Fixed pins from the previous page appearing during navigation to collapsed reference groups, including when Roam briefly retains old rows after the URL changes.
- Kept original reference rows available until pinned copies finish rendering, with a retry action if rendering fails.

- Hid inactive linked reference pin buttons until hover or keyboard focus, while keeping active pins visible.
- Fixed saved pins appearing when the main linked reference groups are initially collapsed.

- Fixed pinned reference copies respecting independent right-sidebar filters.

- Rendered saved linked reference pins immediately before Roam lazy-loads their normal rows, hiding duplicate rows until unpinned.

- Kept linked reference widths and alignment stable while pinning, with full source titles, a pinned heading, and pending button states.
- Added linked reference pins for daily note pages and arrow-key navigation between pin controls.

- Added pin buttons for keeping selected linked references at the top of a page's results, with shared pins saved separately for each target.

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
