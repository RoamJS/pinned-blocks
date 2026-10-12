import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";

test.use({
  launchOptions: { executablePath: process.env.ROAM_BROWSER_EXECUTABLE_PATH },
});

const script = buildSync({
  stdin: {
    contents: `import { createLinkedReferenceControls, LINKED_REFERENCE_STYLES } from "./src/linkedReferences";
      window.referencePinStyles = LINKED_REFERENCE_STYLES;
      window.controls = createLinkedReferenceControls({ togglePin: async (pin) => { window.clickedPin = pin; window.toggleCount = (window.toggleCount || 0) + 1; if (window.holdToggle) await new Promise(resolve => { window.finishToggle = resolve; }); } });`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
}).outputFiles[0].text;

const referenceSection = (label: string, targetUid: string): string => `
<div class="rm-reference-container">
  <div class="flex-h-box"><strong>${label}</strong></div>
  <div class="rm-mentions"><div class="rm-ref-page-view">
    <div class="rm-title-arrow-wrapper">Source page</div>
    <div><div class="flex-h-box" data-testid="row-${targetUid}">
      <div class="rm-reference-item"><div class="roam-block-container" data-block-uid="block1234" data-page-title="Source page">
        <div class="rm-block-main"><div class="roam-block" id="block-input-user-mentions-page-${targetUid}-block1234">Reference</div></div>
      </div></div>
    </div></div>
  </div></div>
</div>`;

test("controls scope pins to the target, skip unlinked results, and restore native layout on unpin", async ({
  page,
}) => {
  await page.setContent(
    referenceSection("1 Linked Reference", "target123") +
      referenceSection("1 Linked Reference", "target456") +
      referenceSection("1 Unlinked Reference", "target789"),
  );
  await page.addScriptTag({ content: script });
  await page.evaluate(
    `window.controls.sync([{ targetUid: "target123", blockUid: "block1234" }])`,
  );
  const first = page.getByTestId("row-target123");
  const second = page.getByTestId("row-target456");
  await expect(
    first.getByRole("button", { name: "Unpin linked reference" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    second.getByRole("button", { name: "Pin linked reference", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByTestId("row-target789").getByRole("button"),
  ).toHaveCount(0);
  await expect(page.locator(".roamjs-reference-pin-list")).toHaveCount(1);
  await first.getByRole("button").click();
  expect(await page.evaluate(`window.clickedPin`)).toEqual({
    targetUid: "target123",
    blockUid: "block1234",
  });
  await page.evaluate(`window.controls.sync([])`);
  await expect(
    page.locator(
      ".roamjs-reference-pin-list, .roamjs-reference-pin-group, .roamjs-reference-pin-active",
    ),
  ).toHaveCount(0);
});

test("reused result rows receive fresh target context and cleanup removes all mounted controls", async ({
  page,
}) => {
  await page.setContent(referenceSection("1 Linked Reference", "target123"));
  await page.addScriptTag({ content: script });
  await page.evaluate(
    `window.controls.sync([{ targetUid: "target123", blockUid: "block1234" }])`,
  );
  await page.locator(".roam-block").evaluate((element) => {
    element.id = "block-input-user-mentions-page-target456-block1234";
  });
  await page.evaluate(
    `window.controls.sync([{ targetUid: "target123", blockUid: "block1234" }])`,
  );
  await page
    .getByRole("button", { name: "Pin linked reference", exact: true })
    .click();
  expect(await page.evaluate(`window.clickedPin`)).toEqual({
    targetUid: "target456",
    blockUid: "block1234",
  });
  await page.evaluate(`window.controls.cleanup()`);
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.locator('[class*="roamjs-reference-pin"]')).toHaveCount(0);
  await expect(page.locator(".rm-reference-item")).toHaveCount(1);
});

test("daily notes get independent controls and record pending changes only once", async ({
  page,
}) => {
  await page.setContent(referenceSection("1 Linked Reference", "10-12-2026"));
  await page.addScriptTag({ content: script });
  await page.evaluate(`window.holdToggle = true; window.controls.sync([])`);
  const button = page.getByRole("button", {
    name: "Pin linked reference",
    exact: true,
  });
  await button.click();
  await expect(button).toBeDisabled();
  await page.evaluate(`document.querySelector("button").click()`);
  expect(await page.evaluate(`window.toggleCount`)).toBe(1);
  expect(await page.evaluate(`window.clickedPin`)).toEqual({
    targetUid: "10-12-2026",
    blockUid: "block1234",
  });
  await page.evaluate(
    `window.controls.sync([{ targetUid: "10-12-2026", blockUid: "block1234" }]); window.finishToggle()`,
  );
  await expect(
    page.getByRole("button", { name: "Unpin linked reference" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Pinned references (1)" }),
  ).toHaveCount(1);
});

test("source captions preserve row widths and cleanup cannot be undone by a pending toggle", async ({
  page,
}) => {
  await page.setContent(
    `<style>.rm-mentions{width:700px}.flex-h-box{display:flex}.rm-reference-item{flex:1}.rm-ref-page-view{margin-left:3px;border-left:1px solid transparent}.rm-ref-page-view>div:not(.rm-title-arrow-wrapper){margin-left:4px}</style>` +
      referenceSection("1 Linked Reference", "target123"),
  );
  await page.addScriptTag({ content: script });
  await page.addStyleTag({
    content: await page.evaluate(`window.referencePinStyles`),
  });
  await page.evaluate(`window.controls.sync([])`);
  const before = await page.locator(".rm-reference-item").boundingBox();
  await page.evaluate(
    `window.controls.sync([{ targetUid: "target123", blockUid: "block1234" }])`,
  );
  const after = await page.locator(".rm-reference-item").boundingBox();
  expect(after?.width).toBe(before?.width);
  await expect(page.locator(".roamjs-reference-pin-source")).toHaveText(
    "Source page",
  );
  await expect(page.locator(".rm-title-arrow-wrapper")).toBeHidden();
  await page.evaluate(`window.holdToggle = true`);
  await page.getByRole("button").click();
  await page.evaluate(`window.controls.cleanup(); window.finishToggle()`);
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.locator('[class*="roamjs-reference-pin"]')).toHaveCount(0);
});

test("arrow keys follow displayed pin order and Enter activates a pin", async ({
  page,
}) => {
  await page.setContent(referenceSection("2 Linked References", "target123"));
  await page.locator('[data-testid="row-target123"]').evaluate((row) => {
    const second = row.cloneNode(true) as HTMLElement;
    second.dataset.testid = "second-row";
    second.querySelector<HTMLElement>("[data-block-uid]")!.dataset.blockUid =
      "block5678";
    second.querySelector<HTMLElement>(".roam-block")!.id =
      "block-input-user-mentions-page-target123-block5678";
    row.parentElement!.appendChild(second);
  });
  await page.addScriptTag({ content: script });
  await page.addStyleTag({
    content: await page.evaluate(`window.referencePinStyles`),
  });
  await page.evaluate(
    `window.controls.sync([{ targetUid: "target123", blockUid: "block5678" }])`,
  );
  const pinned = page.getByRole("button", { name: "Unpin linked reference" });
  const unpinned = page.getByRole("button", {
    name: "Pin linked reference",
    exact: true,
  });
  await pinned.focus();
  await pinned.press("ArrowDown");
  await expect(unpinned).toBeFocused();
  await unpinned.press("Enter");
  expect(await page.evaluate(`window.clickedPin`)).toEqual({
    targetUid: "target123",
    blockUid: "block1234",
  });
});
