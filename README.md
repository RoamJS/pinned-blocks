# Pinned Blocks

<a href="https://roamjs.com/">
    <img src="https://avatars.githubusercontent.com/u/138642184" alt="RoamJS Logo" title="RoamJS" align="right" height="60" />
</a>

**Keep selected child blocks pinned to the top of their current parent, even as blocks move and siblings are reorganized.**

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/RoamJS/pinned-blocks)
[![Slack](https://img.shields.io/badge/Slack-%23roam--js-purple)](https://roamresearch.slack.com/archives/C016N2B66JU)

## Features

- Pin selected references in the linked reference section to the top of the results.

- Pin, unpin, or toggle the focused block from the command palette.
- Pin or unpin any block from the block context menu.
- Keep multiple pinned siblings at the top in their current pinned-group order.
- Drag pinned blocks to reorder them within the pinned group.
- Move pinned blocks to another parent and keep them pinned in the new pinned group.
- Reorder the real Roam outline with Roam's native block reorder API; no duplicate shelf or hidden source blocks.
- Watch pinned parents so regular blocks inserted above or between pinned blocks are moved below the pinned group.
- Mark pinned blocks with a small pin indicator and stable CSS hooks for custom styling.
- Share pin state between collaborators through graph-backed records on `roam/js/pinned-blocks`.

## Linked reference pins

Use the pin button beside a linked reference to keep it at the top of that
page's linked reference results. Click the active pin button to unpin it.
Pinned results appear under a “Pinned references” heading, show the full source
page title, and retain Roam's native block controls. Pinned results keep their
relative order from Roam's current reference sorting rather than the order in
which you pin them. The pin button shows a loading state while saving.

Daily note pages are supported. Use the Up and Down arrow keys on a pin button
to move between the pin controls in their displayed order. Native Tab navigation
still follows Roam's underlying reference grouping.

Reference pins are saved separately for each target page or block under
`roam/js/pinned-blocks` and shared with collaborators running the extension.
They change the displayed reference order without changing source block order.
Roam's filters still apply; a pinned reference appears only when it is included
in the rendered results. Pins do not force collapsed source groups to expand
or load additional results.

## Multiplayer graphs

Collaborators running Pinned Blocks in the same graph share the same pin records
and pinned order. Pin membership is stored under `roam/js/pinned-blocks`, while
order follows the real Roam outline.

Pinned Blocks changes real sibling order with Roam's native reorder API, so its
changes are also visible to collaborators who do not run the extension. Those
collaborators will not see pin indicators and may not understand why a block
moves back into the pinned group.

## Storage

Pinned Blocks creates `roam/js/pinned-blocks` with a notice explaining that the
page is extension-managed. Each pin is stored as a separate child record using
the `roamjs-pinned-blocks` block-props namespace. The page and notice remain
when there are no pins; pin-data children are removed.

Pinned Blocks does not use browser local storage.

## Commands

- `Pinned Blocks: Toggle Pin Focused Block`
- `Pinned Blocks: Pin Focused Block`
- `Pinned Blocks: Unpin Focused Block`

## Styling

Pinned Blocks adds these classes to the rendered outline:

- `.roamjs-pinned-blocks-block`
- `.roamjs-pinned-blocks-block-pinned`

The default indicator is rendered on `.roamjs-pinned-blocks-block-pinned::before`
and can be adjusted with CSS variables:

- `--roamjs-pinned-blocks-indicator-color`
- `--roamjs-pinned-blocks-indicator-size`
- `--roamjs-pinned-blocks-indicator-left`
- `--roamjs-pinned-blocks-sidebar-indicator-left`
- `--roamjs-pinned-blocks-indicator-top`
- `--roamjs-pinned-blocks-indicator-opacity`
- `--roamjs-pinned-blocks-indicator-z-index`
