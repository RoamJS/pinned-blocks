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
    window.roamAlphaAPI = { data: { fast: { q: () => [['title1234']] } }, ui: { rightSidebar: { getWindows: () => [{type:"mentions", "window-id":"sidebar-mentions-target123", "page-uid":"target123"}] }, filters: {
      getGlobalFilters: () => ({}), getPageLinkedRefsFilters: () => window.filters,
      getSidebarWindowFilters: args => {window.sidebarFilterArgs=args;return window.sidebarFilters || {}}
    } } };
    window.controls = createLinkedReferenceControls({
      readReference: pin => pin.blockUid === 'title1234' ? ({sourceTitle:'Title [[Target]]', sourceUid:pin.blockUid, isPage:true, titles:['Title [[Target]]', 'Target']}) : window.missingPins?.includes(pin.blockUid) ? null : ({ sourceTitle: 'Source page', sourceUid: 'source123', titles: ['Source page', 'Tag'] }),
      renderBlock: async ({uid,el,"zoom-path?":zoomPath}) => { window.lastZoomPath=zoomPath; if (window.failRender) throw new Error("Injected render failure"); if (window.holdRender) await new Promise(resolve => {window.finishRender = resolve}); el.innerHTML = '<div class="roam-block-container" data-block-uid="'+uid+'">Rendered '+uid+'</div>'; window.renders = (window.renders || 0) + 1; },
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
  expect(await page.evaluate("window.lastZoomPath")).toBe(false);
  await expect(page.locator(".roamjs-reference-pin-heading")).toHaveCount(0);
  await page
    .locator(
      ".rm-ref-page-view:not(.roamjs-reference-pin-page) > div:last-child",
    )
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

test("nested mentions do not acquire controls from the owning reference list", async ({
  page,
}) => {
  const html = `<div class="roam-article"><div class="rm-reference-container"><div class="flex-h-box"><strong>2 Linked References</strong></div><div class="rm-mentions">
    <div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper">Source page</div><div data-testid="outer-row" class="flex-h-box"><div class="rm-reference-item"><div class="roam-block-container" data-block-uid="block1234"><div class="rm-block-main"><div class="roam-block" id="block-input-user-mentions-page-target123-block1234">Outer</div></div></div></div></div></div>
    <div class="rm-mentions" data-testid="nested-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper"><div class="rm-ref-page-view-title">Title [[Target]]</div></div><div class="flex-h-box"><div class="rm-reference-item"><div class="roam-block-container" data-block-uid="nested123"><div class="rm-block-main"><div class="roam-block" id="block-input-user-mentions-page-target123-nested123">Nested</div></div></div></div></div></div></div>
    </div></div></div>`;
  await setup(page, html);
  await page.evaluate("window.controls.sync([])");
  await expect(
    page.getByTestId("outer-row").getByRole("button", {
      name: "Pin linked reference",
    }),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("nested-mentions").getByRole("button", {
      name: "Pin linked reference",
    }),
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

test("unsaved title controls follow filter-only changes without replacing native rows", async ({
  page,
}) => {
  await setup(
    page,
    section("target123").replace(
      ">Source page</div>",
      '><div class="rm-ref-page-view-title">Title [[Target]]</div></div>',
    ),
  );
  await page.evaluate("window.controls.sync([])");
  const heading = page.locator(".rm-title-arrow-wrapper");
  const titlePin = heading.getByRole("button", {
    name: "Pin linked reference",
    exact: true,
  });
  const native = await page
    .getByTestId("row-target123-block1234")
    .elementHandle();
  await expect(titlePin).toHaveCount(1);
  await page.evaluate("window.filters={includes:['Tag']}");
  await expect(titlePin).toHaveCount(0);
  expect(await native!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.getByTestId("row-target123-block1234")).toBeVisible();
  await page.evaluate("window.filters={}");
  await expect(titlePin).toHaveCount(1);
  await page.evaluate("window.filters={removes:['Target']}");
  await expect(titlePin).toHaveCount(0);
  await page.evaluate("window.controls.cleanup();window.filters={}");
  await page.waitForTimeout(600);
  await expect(page.locator(".roamjs-reference-pin-control")).toHaveCount(0);
  expect(await page.evaluate("window.toggleCount || 0")).toBe(0);
});

test("clearing filters restores an unsaved title when no pin controls were mounted", async ({
  page,
}) => {
  await setup(
    page,
    '<div class="roam-article"><div class="rm-reference-container"><div class="flex-h-box"><strong>1 Linked Reference</strong></div><div class="rm-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper"><div class="rm-ref-page-view-title">Title [[Target]]</div></div></div></div></div></div>',
  );
  await page.evaluate(
    `window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=> 'target123'};window.filters={includes:['Tag']};window.controls.sync([])`,
  );
  await page.waitForTimeout(600);
  await expect(page.locator(".roamjs-reference-pin-control")).toHaveCount(0);
  await page.evaluate("window.filters={}");
  await expect(
    page.getByRole("button", { name: "Pin linked reference", exact: true }),
  ).toHaveCount(1);
  await page.evaluate("window.controls.cleanup()");
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
    `document.querySelector('.rm-ref-page-view:not(.roamjs-reference-pin-page)').replaceChildren();window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=> 'target123'};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}])`,
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
    `document.querySelector('.rm-ref-page-view:not(.roamjs-reference-pin-page)').replaceChildren();window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:()=>new Promise(resolve=>{window.finishTarget=resolve})};window.controls.sync([{targetUid:'target123',blockUid:'block1234'}]);window.controls.cleanup();window.finishTarget('target123')`,
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
    `document.querySelector('.rm-ref-page-view:not(.roamjs-reference-pin-page)').replaceChildren();window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=> 'target456'};window.location.hash='page/target456'`,
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
    `document.querySelector('.rm-ref-page-view:not(.roamjs-reference-pin-page)').replaceChildren();window.pins=[{targetUid:'target123',blockUid:'block1234'},{targetUid:'target456',blockUid:'other1234'}];window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:()=>new Promise(resolve=>{window.finishOldTarget=resolve})};window.controls.sync(window.pins);window.location.hash='page/target456';window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid=async()=> 'target456';window.controls.sync(window.pins)`,
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
  const heading = page.locator(
    ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
  );
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
  await expect(
    page.locator(
      ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
    ),
  ).toBeVisible();
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

test("old native rows cannot seed the destination cache before collapsed rows disappear", async ({
  page,
}) => {
  await setup(
    page,
    '<div class="roam-article">' + section("target123") + "</div>",
  );
  await page.evaluate(
    `window.pins=[{targetUid:'target123',blockUid:'block1234'},{targetUid:'target456',blockUid:'other1234'}];window.currentTarget='target123';window.lookups=0;window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=>{window.lookups++;return window.currentTarget}};window.controls.sync(window.pins)`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toContainText("Rendered block1234");
  await page.evaluate(
    `window.currentTarget='target456';window.location.hash='page/target456';window.controls.sync(window.pins)`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="other1234"]'),
  ).toContainText("Rendered other1234");
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("row-target123-block1234").getByRole("button"),
  ).toHaveCount(0);
  await page.evaluate(
    `document.querySelector('.rm-ref-page-view:not(.roamjs-reference-pin-page)').replaceChildren();window.controls.sync(window.pins)`,
  );
  await page.waitForTimeout(600);
  await expect(
    page.locator('[data-reference-pin-uid="other1234"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toHaveCount(0);
  expect(await page.evaluate("window.lookups")).toBe(2);
});

test("daily notes retain per-article targets when the main API returns no single page", async ({
  page,
}) => {
  await setup(
    page,
    '<div class="roam-article">' +
      section("10-13-2026") +
      '</div><div class="roam-article">' +
      section("10-12-2026", "1 Linked Reference", "other1234") +
      "</div>",
  );
  await page.evaluate(
    `window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=>null};window.controls.sync([{targetUid:'10-13-2026',blockUid:'block1234'},{targetUid:'10-12-2026',blockUid:'other1234'}])`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toContainText("Rendered block1234");
  await expect(
    page.locator('[data-reference-pin-uid="other1234"]'),
  ).toContainText("Rendered other1234");
  await expect(page.getByTestId("row-10-13-2026-block1234")).toBeHidden();
  await expect(page.getByTestId("row-10-12-2026-other1234")).toBeHidden();
});

test("collapsed daily-note lists resolve enclosing page metadata and follow changed article identity", async ({
  page,
}) => {
  const daily = (uid: string, block: string): string =>
    `<div class="roam-log-page" data-testid="daily-${uid}"><div class="rm-title-display-container" data-page-uid="${uid}"><h1 class="rm-title-display">Daily note</h1></div>${section(uid, "1 Linked Reference", block)}</div>`;
  await setup(
    page,
    '<div class="roam-article">' +
      daily("10-13-2026", "block1234") +
      daily("10-12-2026", "other1234") +
      "</div>",
  );
  await page.evaluate(
    `document.querySelectorAll('.rm-ref-page-view:not(.roamjs-reference-pin-page)').forEach(group=>group.replaceChildren());window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=>null};window.pins=[{targetUid:'10-13-2026',blockUid:'block1234'},{targetUid:'10-12-2026',blockUid:'other1234'},{targetUid:'10-11-2026',blockUid:'third1234'}];window.controls.sync(window.pins)`,
  );
  const today = page.getByTestId("daily-10-13-2026");
  const yesterday = page.getByTestId("daily-10-12-2026");
  await expect(
    today.locator('[data-reference-pin-uid="block1234"]'),
  ).toContainText("Rendered block1234");
  await expect(
    yesterday.locator('[data-reference-pin-uid="other1234"]'),
  ).toContainText("Rendered other1234");
  await expect(
    today.locator('[data-reference-pin-uid="other1234"]'),
  ).toHaveCount(0);
  await expect(
    yesterday.locator('[data-reference-pin-uid="block1234"]'),
  ).toHaveCount(0);
  await page.evaluate(
    `document.querySelector('.rm-title-display-container').dataset.pageUid='10-11-2026';window.controls.sync(window.pins)`,
  );
  await expect(
    today.locator('[data-reference-pin-uid="block1234"]'),
  ).toHaveCount(0);
  await expect(
    today.locator('[data-reference-pin-uid="third1234"]'),
  ).toContainText("Rendered third1234");
  await expect(
    yesterday.locator('[data-reference-pin-uid="other1234"]'),
  ).toBeVisible();
});

for (const { label, field, type } of [
  { label: "page", field: "page-uid", type: "mentions" },
  { label: "block", field: "block-uid", type: "block" },
  { label: "block mentions", field: "mentions-uid", type: "mentions" },
]) {
  test(`sidebar ${label} navigation trusts window identity over retained rows and unpins the destination`, async ({
    page,
  }) => {
    await setup(
      page,
      '<div class="roam-article">' +
        section("target123") +
        '</div><div id="right-sidebar"><div class="rm-sidebar-window" id="sidebar-window-reused-window">' +
        section("target123") +
        "</div></div>",
    );
    await page.evaluate(
      ({ field, type }) => {
        const state = window as unknown as {
          sidebarWindow: Record<string, string>;
          pins: { targetUid: string; blockUid: string }[];
          controls: {
            sync: (pins: { targetUid: string; blockUid: string }[]) => void;
          };
          roamAlphaAPI: {
            ui: {
              rightSidebar: { getWindows: () => Record<string, string>[] };
            };
          };
        };
        state.sidebarWindow = {
          type,
          "window-id": "reused-window",
          [field]: "target123",
        };
        state.roamAlphaAPI.ui.rightSidebar.getWindows = () => [
          state.sidebarWindow,
        ];
        state.pins = [
          { targetUid: "target123", blockUid: "block1234" },
          { targetUid: "target456", blockUid: "block1234" },
        ];
        state.controls.sync(state.pins);
      },
      { field, type },
    );
    const mainPin = page.locator(
      '.roam-article [data-reference-pin-uid="block1234"]',
    );
    const sidebarPin = page.locator(
      '#right-sidebar [data-reference-pin-uid="block1234"]',
    );
    await expect(sidebarPin).toContainText("Rendered block1234");
    await page.evaluate(
      `window.sidebarWindow['${field}']='target456';window.controls.sync(window.pins)`,
    );
    await expect(sidebarPin).toContainText("Rendered block1234");
    await expect(
      page
        .locator("#right-sidebar")
        .getByTestId("row-target123-block1234")
        .getByRole("button"),
    ).toHaveCount(0);
    expect(await page.evaluate("window.sidebarFilterArgs")).toEqual({
      window: { type, "block-uid": "target456" },
    });
    await sidebarPin
      .getByRole("button", { name: "Unpin linked reference", exact: true })
      .click();
    expect(await page.evaluate("window.clickedPin")).toEqual({
      targetUid: "target456",
      blockUid: "block1234",
    });
    await page.evaluate(
      `window.pins=window.pins.filter(pin=>pin.targetUid!=='target456');document.querySelector('#right-sidebar .rm-ref-page-view:not(.roamjs-reference-pin-page)').replaceChildren();window.controls.sync(window.pins)`,
    );
    await expect(sidebarPin).toHaveCount(0);
    await expect(mainPin).toBeVisible();
  });
}

test("pinned references stay visible without a group collapse control", async ({
  page,
}) => {
  await setup(page, section("target123"));
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123', blockUid:'block1234'}])`,
  );
  const copy = page.locator('[data-reference-pin-uid="block1234"]');
  await expect(copy).toBeVisible();
  await expect(page.locator(".roamjs-reference-pin-heading")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /(?:Toggle|Collapse|Expand) pinned references/,
    }),
  ).toHaveCount(0);
  await expect(page.getByText(/^Pinned references \(\d+\)$/)).toHaveCount(0);
  await expect(page.getByTestId("row-target123-block1234")).toBeHidden();
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123', blockUid:'block1234'}])`,
  );
  await expect(copy).toBeVisible();
  await copy.getByRole("button", { name: "Unpin linked reference" }).click();
  await page.evaluate("window.controls.sync([])");
  await expect(page.getByTestId("row-target123-block1234")).toBeVisible();
});

test("page-title references pin independently of block results and keep source links clickable", async ({
  page,
}) => {
  await setup(
    page,
    section("target123").replace(
      ">Source page</div>",
      '><div class="rm-ref-page-view-title"><a><span class="rm-page__title">Title [[Target]]</span></a></div></div>',
    ),
  );
  await page.evaluate(`window.roamAlphaAPI.ui.mainWindow = {openPage: args => {window.openedPage=args}};
    window.roamAlphaAPI.ui.rightSidebar.addWindow = args => {window.openedSidebar=args}; window.controls.sync([])`);
  const title = page.locator(
    ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
  );
  await title.hover();
  await title
    .getByRole("button", { name: "Pin linked reference", exact: true })
    .click();
  expect(await page.evaluate("window.clickedPin")).toEqual({
    targetUid: "target123",
    blockUid: "title1234",
  });
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  const copy = page.locator('[data-reference-pin-uid="title1234"]');
  await expect(copy).toBeVisible();
  await expect(copy).toHaveClass(/rm-ref-page-view/);
  await expect(copy.locator(".rm-reference-item")).toHaveCount(0);
  await expect(copy.locator(".rm-ref-page-view-title")).toHaveText(
    "Title [[Target]]",
  );
  await expect(
    copy.getByRole("button", { name: "Collapse source references" }),
  ).toBeVisible();
  await expect(title).toBeVisible(); // Still labels the unpinned child result.
  await expect(page.getByTestId("row-target123-block1234")).toBeVisible();
  await copy.getByRole("link").click();
  expect(await page.evaluate("window.openedPage")).toEqual({
    page: { uid: "title1234" },
  });
  await copy.getByRole("link").click({ modifiers: ["Shift"] });
  expect(await page.evaluate("window.openedSidebar")).toEqual({
    window: { type: "outline", "block-uid": "title1234" },
  });
  await copy.getByRole("button", { name: "Unpin linked reference" }).click();
  await page.evaluate("window.controls.sync([])");
  await expect(copy).toHaveCount(0);
  await title.hover();
  await expect(title.getByRole("button")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

for (const [label, graphRoot, route] of [
  ["graph root", "#/app/Test%20Graph", ""],
  ["page", "#/app/Test%20Graph", "/page/target123"],
  ["search", "#/app/Test%20Graph", "/search"],
  ["search query", "#/app/Test%20Graph", "/search?query=Tag%2FName"],
  ["graph view", "#/app/Test%20Graph", "/graph"],
  ["offline graph", "#/offline/Test%20Graph", "/search"],
]) {
  test(`pinned source links use the graph root from ${label}`, async ({
    page,
  }) => {
    const base = "https://roamresearch.com/?theme=dark";
    await page.route("https://roamresearch.com/**", (request) =>
      request.fulfill({ contentType: "text/html", body: "<html></html>" }),
    );
    await page.goto(`${base}${graphRoot}${route}`);
    await setup(
      page,
      '<div id="right-sidebar">' + section("target123") + "</div>",
    );
    await page.evaluate(
      `window.controls.sync([{targetUid:'target123',blockUid:'title1234'},{targetUid:'target123',blockUid:'block1234'}])`,
    );
    const links = page.locator(".roamjs-reference-pin-panel a.rm-page-ref");
    await expect(links).toHaveCount(2);
    await expect(links.filter({ hasText: "Title [[Target]]" })).toHaveAttribute(
      "href",
      `${base}${graphRoot}/page/title1234`,
    );
    await expect(links.filter({ hasText: "Source page" })).toHaveAttribute(
      "href",
      `${base}${graphRoot}/page/source123`,
    );
    await page.evaluate("window.controls.cleanup()");
  });
}

test("source links preserve native modified and middle clicks from search", async ({
  page,
  context,
}) => {
  const graphRoot = "https://roamresearch.com/#/app/Test%20Graph";
  await context.route("https://roamresearch.com/**", (request) =>
    request.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto(`${graphRoot}/search`);
  await setup(
    page,
    '<div id="right-sidebar">' + section("target123") + "</div>",
  );
  await page.evaluate(`window.roamAlphaAPI.ui.mainWindow = {openPage: args => {window.openedPage=args}};
    window.roamAlphaAPI.ui.rightSidebar.addWindow = args => {window.openedSidebar=args};
    window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`);
  const link = page.locator(".roamjs-reference-pin-panel a.rm-page-ref");
  const modifiers = await link.evaluate((element) =>
    ["ctrlKey", "metaKey", "altKey"].map((modifier) => {
      let prevented = true;
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      });
      // Cancel only after React handles the event so the test does not open tabs.
      document.addEventListener(
        "click",
        (nativeEvent) => {
          prevented = nativeEvent.defaultPrevented;
          nativeEvent.preventDefault();
        },
        { once: true },
      );
      element.dispatchEvent(event);
      return prevented;
    }),
  );
  expect(modifiers).toEqual([false, false, false]);
  expect(
    await page.evaluate("window.openedPage || window.openedSidebar"),
  ).toBeUndefined();
  const popupPromise = context.waitForEvent("page");
  await link.click({ button: "middle" });
  const popup = await popupPromise;
  await popup.waitForURL(`${graphRoot}/page/title1234`);
  await popup.close();
  await link.click();
  expect(await page.evaluate("window.openedPage")).toEqual({
    page: { uid: "title1234" },
  });
  await link.click({ modifiers: ["Shift"] });
  expect(await page.evaluate("window.openedSidebar")).toEqual({
    window: { type: "outline", "block-uid": "title1234" },
  });
  await page.evaluate("window.controls.cleanup()");
});

test("saved page-title pins stay visible without block rows and respect filters", async ({
  page,
}) => {
  await setup(
    page,
    '<div class="roam-article">' +
      section("target123").replace(
        /<div><div class="flex-h-box"[\s\S]*?(?=<\/div><\/div><\/div><\/div>$)/,
        "",
      ) +
      "</div>",
  );
  await page.evaluate(`window.roamAlphaAPI.ui.mainWindow = {getOpenPageOrBlockUid:async()=> 'target123'};
    window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`);
  const copy = page.locator('[data-reference-pin-uid="title1234"]');
  await expect(copy).toHaveCount(1);
  await expect(copy).toBeVisible();
  await page.evaluate(
    `window.filters={removes:['Target']};window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  await expect(copy).toHaveCount(0);
  await page.evaluate(
    `window.filters={};window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  await expect(copy).toBeVisible();
});

test("pinning a title preserves a collapsed source heading with unloaded block references", async ({
  page,
}) => {
  const html =
    '<div class="roam-article"><div class="rm-reference-container"><div class="flex-h-box"><strong>2 Linked References</strong></div><div class="rm-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper"><span class="rm-caret-closed"></span><div class="rm-ref-page-view-title">Title [[Target]]</div></div></div></div></div></div>';
  await setup(page, html);
  await page.evaluate(`window.roamAlphaAPI.data.fast.q = query => query.includes(':block/page') ? [['block1234']] : [['title1234']]; window.roamAlphaAPI.ui.mainWindow = {getOpenPageOrBlockUid:async()=> 'target123'};
    window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`);
  await expect(
    page.locator('[data-reference-pin-uid="title1234"]'),
  ).toBeVisible();
  await expect(
    page.locator(
      ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
    ),
  ).toBeVisible();
});

test("collapsed source heading hides once every hidden child has a rendered pin", async ({
  page,
}) => {
  const html =
    '<div class="roam-article"><div class="rm-reference-container"><div class="flex-h-box"><strong>2 Linked References</strong></div><div class="rm-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper"><span class="rm-caret-closed"></span><div class="rm-ref-page-view-title">Title [[Target]]</div></div></div></div></div></div>';
  await setup(page, html);
  await page.evaluate(() => {
    window.roamAlphaAPI.ui.mainWindow = {
      getOpenPageOrBlockUid: async () => "target123",
    };
    window.roamAlphaAPI.data.fast.q = (query, title) =>
      query.includes(":node/title") && title === "Title [[Target]]"
        ? [["title1234"]]
        : query.includes(":block/page")
          ? [["block1234"]]
          : [];
    window.controls.sync([
      { targetUid: "target123", blockUid: "title1234" },
      { targetUid: "target123", blockUid: "block1234" },
    ]);
  });
  const heading = page.locator(
    ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toContainText("Rendered block1234");
  await expect(heading).toBeHidden();
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  await expect(heading).toBeVisible();
});

test("filtered hidden child does not keep a pinned title's collapsed heading visible", async ({
  page,
}) => {
  const html =
    '<div class="roam-article"><div class="rm-reference-container"><div class="flex-h-box"><strong>2 Linked References</strong></div><div class="rm-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper"><span class="rm-caret-closed"></span><div class="rm-ref-page-view-title">Title [[Target]]</div></div></div></div></div></div>';
  await setup(page, html);
  await page.evaluate(() => {
    window.roamAlphaAPI.ui.mainWindow = {
      getOpenPageOrBlockUid: async () => "target123",
    };
    window.roamAlphaAPI.data.fast.q = (query, title) =>
      query.includes(":node/title") && title === "Title [[Target]]"
        ? [["title1234"]]
        : query.includes(":block/page")
          ? [["block1234"]]
          : [];
    window.filters = { removes: ["Tag"] };
    window.controls.sync([{ targetUid: "target123", blockUid: "title1234" }]);
  });
  const heading = page.locator(
    ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
  );
  await expect(
    page.locator('[data-reference-pin-uid="title1234"]'),
  ).toBeVisible();
  await expect(heading).toBeHidden();
  await page.evaluate(
    `window.filters={};window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  await expect(heading).toBeVisible();
});

test("collapsed ordinary source heading hides when its only reference is pinned", async ({
  page,
}) => {
  const html =
    '<div class="roam-article"><div class="rm-reference-container"><div class="flex-h-box"><strong>1 Linked Reference</strong></div><div class="rm-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper"><span class="rm-caret-closed"></span><div class="rm-ref-page-view-title">Source page</div></div></div></div></div></div>';
  await setup(page, html);
  await page.evaluate(() => {
    window.roamAlphaAPI.ui.mainWindow = {
      getOpenPageOrBlockUid: async () => "target123",
    };
    window.roamAlphaAPI.data.fast.q = (query, title) =>
      query.includes(":node/title") && title === "Source page"
        ? [["source123"]]
        : query.includes(":block/page")
          ? [["block1234"]]
          : [];
    window.controls.sync([{ targetUid: "target123", blockUid: "block1234" }]);
  });
  const heading = page.locator(
    ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toContainText("Rendered block1234");
  await expect(heading).toBeHidden();
  await page.evaluate("window.controls.sync([])");
  await expect(heading).toBeVisible();
});

test("rendered ancestor pin covers a hidden descendant reference", async ({
  page,
}) => {
  const html =
    '<div class="roam-article"><div class="rm-reference-container"><div class="flex-h-box"><strong>1 Linked Reference</strong></div><div class="rm-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper"><span class="rm-caret-closed"></span><div class="rm-ref-page-view-title">Source page</div></div></div></div></div></div>';
  await setup(page, html);
  await page.evaluate(() => {
    window.roamAlphaAPI.ui.mainWindow = {
      getOpenPageOrBlockUid: async () => "target123",
    };
    window.roamAlphaAPI.data.fast.q = (query, title) =>
      query.includes(":node/title") && title === "Source page"
        ? [["source123"]]
        : query.includes(":block/parents")
          ? [["source123"], ["block1234"]]
          : query.includes(":block/page")
            ? [["child1234"]]
            : [];
    window.controls.sync([{ targetUid: "target123", blockUid: "block1234" }]);
  });
  const heading = page.locator(
    ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
  );
  await expect(
    page.locator('[data-reference-pin-uid="block1234"]'),
  ).toContainText("Rendered block1234");
  await expect(heading).toBeHidden();
  await page.evaluate("window.controls.sync([])");
  await expect(heading).toBeVisible();
});

test("a previously hidden title heading returns when an unpinned child reference appears", async ({
  page,
}) => {
  await setup(
    page,
    '<div class="roam-article">' +
      section("target123").replace(
        ">Source page</div>",
        '><div class="rm-ref-page-view-title">Title [[Target]]</div></div>',
      ) +
      "</div>",
  );
  await page.evaluate(
    `window.roamAlphaAPI.data.fast.q = query => query.includes(':block/page') ? [['block1234']] : [['title1234']]; window.removedReferenceRow = document.querySelector('[data-testid="row-target123-block1234"]'); window.removedReferenceRow.remove(); window.roamAlphaAPI.ui.mainWindow={getOpenPageOrBlockUid:async()=> 'target123'}; window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  await expect(
    page.locator('[data-reference-pin-uid="title1234"]'),
  ).toBeVisible();
  await expect(
    page.locator(
      ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
    ),
  ).toBeHidden();
  await page.evaluate(
    `document.querySelector('.rm-ref-page-view:not(.roamjs-reference-pin-page) > div:last-child').append(window.removedReferenceRow); window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  await expect(
    page.locator(
      ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
    ),
  ).toBeVisible();
  await page.evaluate(
    `window.removedReferenceRow.remove();document.querySelector('.rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper').insertAdjacentHTML('afterbegin','<span class="rm-caret-closed"></span>');window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  await expect(
    page.locator(
      ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
    ),
  ).toBeVisible();
});

for (const filters of [{ includes: ["Tag"] }, { removes: ["Target"] }]) {
  test(`filtered title references expose no misleading control while a child matches ${JSON.stringify(filters)}`, async ({
    page,
  }) => {
    await setup(
      page,
      section("target123").replace(
        ">Source page</div>",
        '><div class="rm-ref-page-view-title">Title [[Target]]</div></div>',
      ),
    );
    await page.evaluate(
      `window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
    );
    await expect(
      page.locator('[data-reference-pin-uid="title1234"]'),
    ).toBeVisible();
    await page.evaluate((filters) => {
      const w = window as unknown as {
        filters: unknown;
        controls: { sync: (pins: unknown[]) => void };
      };
      w.filters = filters;
      w.controls.sync([{ targetUid: "target123", blockUid: "title1234" }]);
    }, filters);
    const title = page.locator(
      ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
    );
    await expect(title).toBeVisible();
    await expect(title.getByRole("button")).toHaveCount(0);
    await expect(
      page.getByTestId("row-target123-block1234").getByRole("button"),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-reference-pin-uid="title1234"]'),
    ).toHaveCount(0);
    await page.evaluate(
      `window.filters={};window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
    );
    await expect(
      page.locator('[data-reference-pin-uid="title1234"]'),
    ).toBeVisible();
    await expect(title.getByRole("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await page.evaluate("window.toggleCount || 0")).toBe(0);
    await page.evaluate((filters) => {
      const w = window as unknown as {
        filters: unknown;
        controls: { sync: (pins: unknown[]) => void };
      };
      w.filters = filters;
      w.controls.sync([]);
    }, filters);
    await expect(title.getByRole("button")).toHaveCount(0);
    await page.evaluate(`window.filters={};window.controls.sync([])`);
    await title.hover();
    await expect(title.getByRole("button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
}

test("pinned page caret operates the original source group", async ({
  page,
}) => {
  await setup(
    page,
    section("target123").replace(
      ">Source page</div>",
      '><span class="rm-caret rm-caret-closed"></span><div class="rm-ref-page-view-title">Title [[Target]]</div></div>',
    ),
  );
  await page.evaluate(() => {
    const caret = document.querySelector(".rm-caret");
    caret.addEventListener("click", () => {
      window.sourceCaretClicks = (window.sourceCaretClicks || 0) + 1;
      caret.classList.toggle("rm-caret-closed");
      caret.classList.toggle("rm-caret-open");
    });
    window.controls.sync([{ targetUid: "target123", blockUid: "title1234" }]);
  });
  const copy = page.locator('[data-reference-pin-uid="title1234"]');
  const expand = copy.getByRole("button", {
    name: "Expand source references",
    exact: true,
  });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(expand.locator("svg")).toHaveAttribute(
    "data-icon",
    "caret-down",
  );
  await expand.press("Enter");
  await expect(
    copy.getByRole("button", {
      name: "Collapse source references",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate("window.sourceCaretClicks")).toBe(1);
  await expect(copy).toBeVisible();
});

test("pinned block source caret hides only its copy without remounting or exposing duplicates", async ({
  page,
}) => {
  await setup(
    page,
    section("target123") +
      section("target456", "1 Linked Reference", "other1234"),
  );
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'block1234'},{targetUid:'target456',blockUid:'other1234'}])`,
  );
  const pinned = page.locator('[data-reference-pin-uid="block1234"]');
  const group = pinned.locator(
    'xpath=ancestor::*[contains(@class,"roamjs-reference-pin-page")]',
  );
  const native = page.getByTestId("row-target123-block1234");
  await expect(pinned).toContainText("Rendered block1234");
  await expect(native).toBeHidden();
  const renders = await page.evaluate("window.renders");
  await group
    .getByRole("button", { name: "Collapse pinned reference", exact: true })
    .click();
  await expect(pinned).toBeHidden();
  await expect(
    group
      .getByRole("button", { name: "Expand pinned reference", exact: true })
      .locator("svg"),
  ).toHaveAttribute("data-icon", "caret-down");
  await expect(group.locator(".roamjs-reference-pin-source")).toBeVisible();
  await expect(native).toBeHidden();
  await expect(
    page.locator('[data-reference-pin-uid="other1234"]'),
  ).toBeVisible();
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'block1234'},{targetUid:'target456',blockUid:'other1234'}])`,
  );
  await expect(pinned).toBeHidden();
  await group
    .getByRole("button", { name: "Expand pinned reference", exact: true })
    .press("Enter");
  await expect(pinned).toBeVisible();
  await group
    .getByRole("button", { name: "Collapse pinned reference", exact: true })
    .press("Space");
  await expect(pinned).toBeHidden();
  expect(await page.evaluate("window.renders")).toBe(renders);
  expect(await page.evaluate("window.unmounts || 0")).toBe(0);
  await page.evaluate(`window.controls.sync([])`);
  await expect(native).toBeVisible();
});

test("raw alias source headings retain page pin identity and native caret mapping", async ({
  page,
}) => {
  const sourceTitle = "Alias source [label]([[Target]])";
  // Native Roam headings retain the full alias syntax instead of rendering its label.
  await setup(
    page,
    `<div class="roam-article"><div class="rm-reference-container"><div class="flex-h-box"><strong>1 Linked Reference</strong></div>
    <div class="rm-mentions"><div class="rm-ref-page-view"><div class="flex-h-box rm-title-arrow-wrapper">
    <span class="rm-caret rm-caret-open"></span><div class="rm-ref-page-view-title dont-focus-block"><a><span class="rm-page__title dont-focus-block">${sourceTitle}</span></a></div>
    </div><div></div></div></div></div></div>`,
  );
  await page.evaluate((rawTitle) => {
    window.sourceTitleQueries = [];
    window.roamAlphaAPI.data.fast.q = (query, title) => {
      if (!query.includes(":node/title")) return [];
      window.sourceTitleQueries.push(title);
      return title === rawTitle ? [["title1234"]] : [];
    };
    window.roamAlphaAPI.ui.mainWindow = {
      getOpenPageOrBlockUid: async () => "target123",
    };
    const caret = document.querySelector(".rm-caret");
    caret.addEventListener("click", () => {
      window.sourceCaretClicks = (window.sourceCaretClicks || 0) + 1;
      caret.classList.toggle("rm-caret-closed");
      caret.classList.toggle("rm-caret-open");
    });
    window.controls.sync([]);
  }, sourceTitle);
  const heading = page.locator(
    ".rm-ref-page-view:not(.roamjs-reference-pin-page) > .rm-title-arrow-wrapper",
  );
  await heading.hover();
  await heading
    .getByRole("button", { name: "Pin linked reference", exact: true })
    .click();
  expect(await page.evaluate("window.clickedPin")).toEqual({
    targetUid: "target123",
    blockUid: "title1234",
  });
  await page.evaluate(
    `window.controls.sync([{targetUid:'target123',blockUid:'title1234'}])`,
  );
  const pinned = page.locator('[data-reference-pin-uid="title1234"]');
  await expect(pinned).toBeVisible();
  await expect(heading).toBeHidden();
  await pinned
    .getByRole("button", { name: "Collapse source references", exact: true })
    .click();
  expect(await page.evaluate("window.sourceCaretClicks")).toBe(1);
  await expect(
    pinned.getByRole("button", {
      name: "Expand source references",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await pinned.getByRole("button", { name: "Unpin linked reference" }).click();
  await page.evaluate("window.controls.sync([])");
  await expect(pinned).toHaveCount(0);
  await expect(heading).toBeVisible();
  await expect(heading.getByRole("button")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const queriedTitles = (await page.evaluate(
    "window.sourceTitleQueries",
  )) as string[];
  expect(queriedTitles.length).toBeGreaterThan(0);
  expect(new Set(queriedTitles)).toEqual(new Set([sourceTitle]));
});
