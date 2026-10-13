import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";

test.use({
  launchOptions: { executablePath: process.env.ROAM_BROWSER_EXECUTABLE_PATH },
});
const script = buildSync({
  stdin: {
    contents: `import { createLinkedReferenceControls, LINKED_REFERENCE_STYLES } from "./src/linkedReferences";
    window.referencePinStyles = LINKED_REFERENCE_STYLES;
    window.filters = {};
    window.roamAlphaAPI = { ui: { rightSidebar: { getWindows: () => [{type:"mentions", "window-id":"sidebar-mentions-target123", "page-uid":"target123"}] }, filters: {
      getGlobalFilters: () => ({}), getPageLinkedRefsFilters: () => window.filters,
      getSidebarWindowFilters: args => {window.sidebarFilterArgs=args;return window.sidebarFilters || {}}
    } } };
    window.controls = createLinkedReferenceControls({
      readReference: pin => window.missingPins?.includes(pin.blockUid) ? null : ({ sourceTitle: 'Source page', titles: ['Source page', 'Tag'] }),
      renderBlock: async ({uid,el}) => { if (window.failRender) throw new Error("Injected render failure"); if (window.holdRender) await new Promise(resolve => {window.finishRender = resolve}); el.innerHTML = '<div class="roam-block-container" data-block-uid="'+uid+'">Rendered '+uid+'</div>'; window.renders = (window.renders || 0) + 1; },
      unmountBlock: async ({el}) => {el.innerHTML = ''; window.unmounts = (window.unmounts || 0) + 1},
      togglePin: async pin => {window.clickedPin = pin; window.toggleCount = (window.toggleCount || 0) + 1; if(window.holdToggle) await new Promise(resolve => {window.finishToggle = resolve})}
    });`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
}).outputFiles[0].text;
const section = (
  target: string,
  label = "1 Linked Reference",
  uid = "block1234",
): string => `
<div class="rm-reference-container"><div class="flex-h-box"><strong>${label}</strong></div>
<div class="rm-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper">Source page</div>
<div><div class="flex-h-box" data-testid="row-${target}-${uid}"><div class="rm-reference-item">
<div class="roam-block-container" data-block-uid="${uid}" data-page-title="Source page"><div class="rm-block-main">
<div class="roam-block" id="block-input-user-mentions-page-${target}-${uid}">Native ${uid}</div>
</div></div></div></div></div></div></div></div>`;
const setup = async (
  page: import("@playwright/test").Page,
  content: string,
): Promise<void> => {
  await page.setContent(content);
  await page.addScriptTag({ content: script });
  await page.addStyleTag({
    content: await page.evaluate("window.referencePinStyles"),
  });
};

test("pins render before lazy rows arrive, hide duplicates, and reveal native rows on unpin", async ({
  page,
}) => {
  await setup(page, section("target123", "2 Linked References", "other1234"));
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123', blockUid:'block1234'}])`,
  );
  const pinned = page.locator('[data-reference-pin-uid="block1234"]');
  await expect(pinned).toContainText("Rendered block1234");
  await expect(
    page.getByRole("heading", { name: "Pinned references (1)" }),
  ).toBeVisible();
  await page
    .locator(".rm-ref-page-view > div:last-child")
    .evaluate(
      (el, html) => el.insertAdjacentHTML("beforeend", html),
      section("target123").match(
        /<div class="flex-h-box" data-testid[\s\S]+(?=<\/div><\/div><\/div><\/div>$)/,
      )![0],
    );
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123', blockUid:'block1234'}])`,
  );
  await expect(page.getByTestId("row-target123-block1234")).toBeHidden();
  await expect(pinned).toBeVisible();
  await pinned.getByRole("button").click();
  expect(await page.evaluate("window.clickedPin")).toEqual({
    targetUid: "target123",
    blockUid: "block1234",
  });
  await page.evaluate("window.controls.sync([])");
  await expect(pinned).toHaveCount(0);
  await expect(page.getByTestId("row-target123-block1234")).toBeVisible();
});

test("pins remain target-scoped and unlinked results receive no controls", async ({
  page,
}) => {
  await setup(
    page,
    section("target123") +
      section("target456") +
      section("target789", "1 Unlinked Reference"),
  );
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123', blockUid:'block1234'}])`,
  );
  await expect(
    page.getByRole("button", { name: "Unpin linked reference" }),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("row-target456-block1234").getByRole("button"),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByTestId("row-target789-block1234").getByRole("button"),
  ).toHaveCount(0);
  await page
    .locator("#block-input-user-mentions-page-target123-block1234")
    .evaluate(
      (el) => (el.id = "block-input-user-mentions-page-target987-block1234"),
    );
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123', blockUid:'block1234'}])`,
  );
  await expect(
    page.getByRole("button", { name: "Unpin linked reference" }),
  ).toHaveCount(0);
});

test("filters and missing references suppress top copies without losing saved pins", async ({
  page,
}) => {
  await setup(page, section("target123"));
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await expect(page.locator(".roamjs-reference-pin-panel")).toBeVisible();
  await page.evaluate(
    `window.filters={removes:['Tag']};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await expect(page.locator(".roamjs-reference-pin-panel")).toHaveCount(0);
  await expect(page.getByTestId("row-target123-block1234")).toBeVisible();
  await page.evaluate(
    `window.filters={includes:['Tag']};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await expect(page.locator(".roamjs-reference-pin-panel")).toBeVisible();
  await page.evaluate(
    `window.missingPins=['block1234'];window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await expect(page.locator(".roamjs-reference-pin-panel")).toHaveCount(0);
});

test("daily note pins prevent duplicate saves, and stable syncs do not remount native blocks", async ({
  page,
}) => {
  await setup(page, section("10-12-2026"));
  await page.evaluate("window.holdToggle=true;window.controls.sync([])");
  await page.getByTestId("row-10-12-2026-block1234").hover();
  await page
    .getByRole("button", { name: "Pin linked reference", exact: true })
    .click();
  await expect(page.getByRole("button")).toBeDisabled();
  await page.evaluate("document.querySelector('button').click()");
  expect(await page.evaluate("window.toggleCount")).toBe(1);
  await page.evaluate(
    `window.controls.sync([{targetUid:'10-12-2026',blockUid:'block1234'}]);window.finishToggle()`,
  );
  await expect(
    page.getByRole("button", { name: "Unpin linked reference" }),
  ).toBeEnabled();
  const renders = await page.evaluate("window.renders");
  await page.evaluate(
    `window.controls.sync([{targetUid:'10-12-2026',blockUid:'block1234'}])`,
  );
  expect(await page.evaluate("window.renders")).toBe(renders);
});

test("arrow keys skip hidden duplicates and follow the visible pins", async ({
  page,
}) => {
  await setup(page, section("target123", "2 Linked References", "other1234"));
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  const pinned = page.getByRole("button", { name: "Unpin linked reference" });
  const native = page.getByRole("button", {
    name: "Pin linked reference",
    exact: true,
  });
  await pinned.focus();
  await pinned.press("ArrowDown");
  await expect(native).toBeFocused();
  await native.press("Enter");
  expect(await page.evaluate("window.clickedPin")).toEqual({
    targetUid: "target123",
    blockUid: "other1234",
  });
});

test("cleanup restores native layout and delayed renders cannot resurrect mounted UI", async ({
  page,
}) => {
  await setup(page, section("target123"));
  await page.evaluate(
    `window.holdRender=true;window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await page.waitForFunction("Boolean(window.finishRender)");
  await expect(page.getByTestId("row-target123-block1234")).toBeVisible();
  await page.evaluate("window.controls.cleanup();window.finishRender()");
  await expect(page.locator('[class*="roamjs-reference-pin"]')).toHaveCount(0);
  await expect(page.getByTestId("row-target123-block1234")).toBeVisible();
  await expect(page.locator(".rm-reference-item")).toHaveCount(1);
  expect(await page.evaluate("window.unmounts")).toBeGreaterThan(0);
});

test("sidebar filters use block-uid and remain independent of main page filters", async ({
  page,
}) => {
  await setup(
    page,
    section("target123") +
      '<div id="right-sidebar">' +
      section("target123") +
      "</div>",
  );
  await page.evaluate(
    `window.sidebarFilters={removes:['Tag']};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  expect(await page.evaluate("window.sidebarFilterArgs")).toEqual({
    window: { type: "mentions", "block-uid": "target123" },
  });
  await expect(
    page.locator("#right-sidebar .roamjs-reference-pin-panel"),
  ).toHaveCount(0);
  await expect(page.locator(".roamjs-reference-pin-panel")).toHaveCount(1);
  await page.evaluate(
    `window.sidebarFilters={};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await expect(
    page.locator("#right-sidebar .roamjs-reference-pin-panel"),
  ).toHaveCount(1);
});

test("filter changes refresh unloaded pins even without a native DOM change", async ({
  page,
}) => {
  await setup(page, section("target123", "2 Linked References", "other1234"));
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toBeVisible();
  await page.evaluate(`window.filters={removes:['Tag']}`);
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toHaveCount(0);
  await page.evaluate(`window.filters={}`);
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toBeVisible();
  await page.evaluate(`window.controls.cleanup()`);
  await page.waitForTimeout(600);
  await expect(page.locator('[class*="roamjs-reference-pin"]')).toHaveCount(0);
});

test("a recreated empty sidebar reference list restores pins from its window identity", async ({
  page,
}) => {
  await setup(
    page,
    '<div id="right-sidebar"><div class="rm-sidebar-window" id="sidebar-window-sidebar-mentions-target123">' +
      section("target123") +
      "</div></div>",
  );
  await page.evaluate(
    `window.sidebarFilters={removes:['Tag']};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}]); const old=document.querySelector('.rm-mentions'); const fresh=old.cloneNode(false); old.replaceWith(fresh); window.controls.sync([{targetUid:'target123',blockUid:'block1234'}]);`,
  );
  await expect(page.locator(".roamjs-reference-pin-panel")).toHaveCount(0);
  await page.evaluate(`window.sidebarFilters={}`);
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toBeVisible();
});

test("inactive pins reveal on row hover and keyboard focus without moving content", async ({
  page,
}) => {
  await setup(page, section("target123", "2 Linked References", "other1234"));
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  const row = page.getByTestId("row-target123-other1234");
  const button = row.getByRole("button");
  const pinned = page.getByRole("button", { name: "Unpin linked reference" });
  await page.mouse.move(0, 0);
  await expect(button).toHaveCSS("opacity", "0");
  await expect(button).toHaveCSS("pointer-events", "none");
  await expect(pinned).toHaveCSS("opacity", "1");
  const before = await row.locator(".rm-reference-item").boundingBox();
  await row.locator(".roam-block").hover();
  await expect(button).toHaveCSS("opacity", "1");
  await expect(button).toHaveCSS("pointer-events", "auto");
  expect(await row.locator(".rm-reference-item").boundingBox()).toEqual(before);
  await page.mouse.move(0, 0);
  await expect(button).toHaveCSS("opacity", "0");
  await pinned.focus();
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS("opacity", "1");
  await button.press("Enter");
  expect(await page.evaluate("window.clickedPin")).toEqual({
    targetUid: "target123",
    blockUid: "other1234",
  });
});

test("pending saves remain visible after pointer and focus leave", async ({
  page,
}) => {
  await setup(page, section("target123"));
  await page.evaluate("window.holdToggle=true;window.controls.sync([])");
  const row = page.getByTestId("row-target123-block1234");
  const button = row.getByRole("button");
  await row.hover();
  await button.click();
  await page.mouse.move(0, 0);
  await button.evaluate((el) => el.blur());
  await expect(button).toHaveCSS("opacity", "1");
  await expect(button).toHaveAttribute("aria-busy", "true");
  await page.evaluate("window.finishToggle()");
  await expect(button).toHaveCSS("opacity", "0");
});

test("empty main reference lists resolve their target and ignore late results after cleanup", async ({
  page,
}) => {
  await setup(
    page,
    '<div class="roam-article">' + section("target123") + "</div>",
  );
  await page.evaluate(
    `document.querySelector('.rm-ref-page-view').replaceChildren();window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=> 'target123'};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toBeVisible();
  await page.evaluate(`window.controls.cleanup()`);
  await setup(
    page,
    '<div class="roam-article">' + section("target123") + "</div>",
  );
  await page.evaluate(
    `document.querySelector('.rm-ref-page-view').replaceChildren();window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:()=>new Promise(resolve=>{window.finishTarget=resolve})};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}]);window.controls.cleanup();window.finishTarget('target123')`,
  );
  await expect(page.locator(".roamjs-reference-pin-panel")).toHaveCount(0);
});

test("reused empty main lists invalidate cached pins on navigation", async ({
  page,
}) => {
  await setup(
    page,
    '<div class="roam-article">' + section("target123") + "</div>",
  );
  await page.evaluate(
    `window.pins=[{targetUid:'target123',blockUid:'block1234'},{targetUid:'target456',blockUid:'other1234'}];window.controls.sync(window.pins)`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toContainText("Rendered block1234");
  await page.evaluate(
    `document.querySelector('.rm-ref-page-view').replaceChildren();window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=> 'target456'};window.location.hash='page/target456'`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-reference-pin-uid="other1234"]'),
  ).toContainText("Rendered other1234");
});

test("navigation starts a fresh target lookup while a previous lookup is pending", async ({
  page,
}) => {
  await setup(
    page,
    '<div class="roam-article">' + section("target123") + "</div>",
  );
  await page.evaluate(
    `document.querySelector('.rm-ref-page-view').replaceChildren();window.pins=[{targetUid:'target123',blockUid:'block1234'},{targetUid:'target456',blockUid:'other1234'}];window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:()=>new Promise(resolve=>{window.finishOldTarget=resolve})};window.controls.sync(window.pins);window.location.hash='page/target456';window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid=async()=> 'target456';window.controls.sync(window.pins)`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="other1234"]'),
  ).toContainText("Rendered other1234");
  await page.evaluate(`window.finishOldTarget('target123')`);
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-reference-pin-uid="other1234"]'),
  ).toBeVisible();
});

test("native rows and source headings stay usable until pinned rendering succeeds", async ({
  page,
}) => {
  await setup(page, section("target123"));
  await page.evaluate(
    `window.holdRender=true;window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
  );
  await page.waitForFunction("Boolean(window.finishRender)");
  const row = page.getByTestId("row-target123-block1234");
  const heading = page.locator(".rm-title-arrow-wrapper");
  await expect(row).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(row.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate("window.finishRender()");
  await expect(row).toBeHidden();
  await expect(heading).toBeHidden();
});

test("renderer failures preserve the native row and retry restores one visible copy", async ({
  page,
}) => {
  await setup(page, section("target123"));
  await page.evaluate(
    `window.failRender=true;window.pins=[{targetUid:'target123',blockUid:'block1234'}];window.controls.sync(window.pins)`,
  );
  const row = page.getByTestId("row-target123-block1234");
  const pinned = page.locator('[data-reference-pin-uid="block1234"]');
  await expect(pinned.getByRole("status")).toContainText("Couldn’t load");
  await expect(row).toBeVisible();
  await expect(page.locator(".rm-title-arrow-wrapper")).toBeVisible();
  await row.getByRole("button", { name: "Unpin linked reference" }).click();
  expect(await page.evaluate("window.clickedPin")).toEqual({
    targetUid: "target123",
    blockUid: "block1234",
  });
  await page.evaluate(`window.failRender=false`);
  await pinned.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(pinned).toContainText("Rendered block1234");
  await expect(pinned.getByRole("status")).toHaveCount(0);
  await expect(row).toBeHidden();
  await page.evaluate("window.controls.sync(window.pins)");
  expect(await page.evaluate("window.renders")).toBe(1);
  await page.evaluate("window.controls.sync([])");
  await expect(row).toBeVisible();
});
