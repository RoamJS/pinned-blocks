# Pinned Blocks

<a href="https://roamjs.com/">
    <img src="https://avatars.githubusercontent.com/u/138642184" alt="RoamJS Logo" title="RoamJS" align="right" height="60" />
</a>

**Keep important child blocks fixed at the top of their parent, even as new siblings are added above them.**

[![RoamJS](https://roamjs.com/badges/website.svg)](https://roamjs.com/) [![DeepWiki](https://roamjs.com/badges/deepwiki.svg)](https://deepwiki.com/RoamJS/pinned-blocks) [![Slack](https://roamjs.com/badges/slack.svg)](https://roamresearch.slack.com/archives/C016N2B66JU)

https://github.com/user-attachments/assets/19d25f0d-1899-4fec-acee-234ea9bebcee

## Pin blocks

Hover over a block or focus it with the keyboard to reveal the pin beside its bullet. Click to pin it; click the dark pin to unpin. Active pins stay visible. You can also use the block context menu or the command palette.

Pinned siblings stay at the top of their parent. Drag them to change their order. Moving a pinned block to another parent keeps it pinned there.

## Pin linked references

Use the pin beside a linked reference to keep it at the top of that page or block's results. These pins affect the reference results, without changing source block order. References in page titles can be pinned beside their source heading, separately from individual blocks.

- Click an active pin to unpin the reference.
- Use the caret beside a pinned result's source title to collapse or expand it. This lasts while the result remains on screen.
- Click a source title to open its page; Shift-click opens it in the sidebar.
- Use Up and Down on a pin button to move between reference pin controls.

Roam's include/remove filters still apply. Daily note pages and the Daily Notes view are supported. If a pinned result fails to render, its original stays available and the pinned result offers **Retry**.

## Shared graphs and storage

Pins are shared with collaborators running Pinned Blocks. Outline pins change the real sibling order, so collaborators without the extension see the reordering but not the pin icons.

Pin data is saved on the extension-managed `roam/js/pinned-blocks` page. Leave that page and its records intact. Reference pins are saved separately for each target page or block.

## Commands

- `Pinned Blocks: Toggle Pin Focused Block`
- `Pinned Blocks: Pin Focused Block`
- `Pinned Blocks: Unpin Focused Block`

<details>
<summary><h2>Custom styling</h2></summary>

Outline blocks expose `.roamjs-pinned-blocks-block` and `.roamjs-pinned-blocks-block-pinned`. The default indicator uses `.roamjs-pinned-blocks-block-pinned::before` with these CSS variables:

- `--roamjs-pinned-blocks-indicator-color`
- `--roamjs-pinned-blocks-indicator-size`
- `--roamjs-pinned-blocks-indicator-left`
- `--roamjs-pinned-blocks-sidebar-indicator-left`
- `--roamjs-pinned-blocks-indicator-top`
- `--roamjs-pinned-blocks-indicator-opacity`
- `--roamjs-pinned-blocks-indicator-z-index`

</details>

<details>
<summary><h2>Demo</h2></summary>

https://github.com/user-attachments/assets/60703fda-3482-40e4-a072-d5c987d04601

</details>
