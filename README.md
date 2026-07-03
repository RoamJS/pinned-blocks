# Pinned Blocks

<a href="https://roamjs.com/">
    <img src="https://avatars.githubusercontent.com/u/138642184" alt="RoamJS Logo" title="RoamJS" align="right" height="60" />
</a>

**Keep selected child blocks pinned to the top of their parent, even when new siblings are added above them.**

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/RoamJS/pinned-blocks)
[![Slack](https://img.shields.io/badge/Slack-%23roam--js-purple)](https://roamresearch.slack.com/archives/C016N2B66JU)

## Features

- Pin any block to its current parent from the block context menu or command palette.
- Keep multiple pinned siblings at the top in the order they were pinned.
- Reorder the real Roam outline with Roam's native block reorder API; no duplicate shelf or hidden source blocks.
- Watch pinned parents so new siblings inserted above pinned blocks are moved below the pinned group.
- Mark pinned blocks with a small pin indicator and stable CSS hooks for custom styling.
- Automatically unpin a block if it is moved away from the parent it was pinned under.

## Styling

Pinned Blocks adds these classes to the rendered outline:

- `.roamjs-pinned-blocks-block`
- `.roamjs-pinned-blocks-block-pinned`
- `.roamjs-pinned-blocks-indicator`
- `.roamjs-pinned-blocks-indicator-icon`

The default indicator can be adjusted with CSS variables:

- `--roamjs-pinned-blocks-indicator-color`
- `--roamjs-pinned-blocks-indicator-size`
- `--roamjs-pinned-blocks-indicator-left`
- `--roamjs-pinned-blocks-indicator-top`
- `--roamjs-pinned-blocks-indicator-opacity`
- `--roamjs-pinned-blocks-indicator-z-index`
