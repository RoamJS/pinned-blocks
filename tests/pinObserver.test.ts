import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";

test.use({
  launchOptions: { executablePath: process.env.ROAM_BROWSER_EXECUTABLE_PATH },
});
const script = buildSync({
  stdin: {
    contents: `import { observePinStructure } from "./src/utils/pinObserver";
      window.changes = 0;
      window.observer = observePinStructure({root: document.body, onChange: () => window.changes++});`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
}).outputFiles[0].text;
const setup = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.setContent(`<div class="roam-block-container" data-block-uid="block1234">
    <div class="roam-block" id="block-input-block1234">Ordinary text</div></div>
    <div class="rm-mentions"><strong>1 Linked Reference</strong></div>
    <div id="unrelated">Unrelated text</div>`);
  await page.addScriptTag({ content: script });
};
const changes = async (
  page: import("@playwright/test").Page,
): Promise<number> =>
  page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    return (window as unknown as { changes: number }).changes;
  });

test("text edits and replacements do not refresh pins, inside or outside reference lists", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    document.querySelector(".roam-block")!.firstChild!.textContent =
      "Typed character";
    document.querySelector(".roam-block")!.replaceChildren("Replacement text");
    document.querySelector(".rm-mentions strong")!.textContent =
      "2 Linked References";
    document
      .querySelector("#unrelated")!
      .replaceChildren("Changed unrelated text");
    const span = document.createElement("span");
    span.textContent = "Formatted inline text";
    document.querySelector(".roam-block")!.append(span);
  });
  expect(await changes(page)).toBe(0);
});

test("unrelated UI changes do not refresh pins", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const panel = document.createElement("div");
    panel.innerHTML = "<span>Toolbar state</span>";
    document.querySelector("#unrelated")!.append(panel);
    panel.id = "toolbar-changed";
    panel.remove();
  });
  expect(await changes(page)).toBe(0);
});

test("lazy-loaded rows and removed reference containers refresh pins", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<div class="rm-reference-item"><div class="roam-block-container" data-block-uid="other1234"></div></div>';
    document.querySelector(".rm-mentions")!.append(wrapper);
  });
  expect(await changes(page)).toBe(1);
  await page.evaluate(() => document.querySelector(".rm-mentions")!.remove());
  expect(await changes(page)).toBe(2);
});

test("navigation identity and reference-tag updates refresh pins", async ({
  page,
}) => {
  await setup(page);
  for (const [selector, attribute, value] of [
    [".roam-block-container", "data-block-uid", "target456"],
    [".roam-block-container", "data-page-title", "Renamed source"],
    [".roam-block-container", "data-page-links", '["New tag"]'],
    [".roam-block-container", "data-path-page-links", '["Ancestor tag"]'],
    [".roam-block", "id", "block-input-target456"],
  ]) {
    const before = await changes(page);
    await page.evaluate(
      ({ selector, attribute, value }) =>
        document.querySelector(selector)!.setAttribute(attribute, value),
      { selector, attribute, value },
    );
    expect(await changes(page)).toBe(before + 1);
  }
  await page.evaluate(() =>
    document.querySelector(".roam-block")!.removeAttribute("id"),
  );
  expect(await changes(page)).toBe(6);
  await page.evaluate(() => {
    const title = document.createElement("div");
    title.className = "rm-title-display-container";
    title.dataset.pageUid = "10-13-2026";
    document.body.append(title);
  });
  expect(await changes(page)).toBe(7);
  await page.evaluate(
    () =>
      ((
        document.querySelector(".rm-title-display-container") as HTMLElement
      ).dataset.pageUid = "10-12-2026"),
  );
  expect(await changes(page)).toBe(8);
});

test("disconnect prevents refreshes after unload", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    (window as unknown as { observer: MutationObserver }).observer.disconnect();
    document.querySelector(".rm-mentions")!.remove();
  });
  expect(await changes(page)).toBe(0);
});

test("renaming a native source heading refreshes page-title references", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const heading = document.createElement("div");
    heading.className = "rm-title-arrow-wrapper";
    heading.innerHTML =
      '<div class="rm-ref-page-view-title"><a><span>Source [[Target]]</span></a></div>';
    document.querySelector(".rm-mentions")!.append(heading);
  });
  expect(await changes(page)).toBe(1);
  await page.evaluate(() => {
    document.querySelector(
      ".rm-ref-page-view-title span",
    )!.firstChild!.textContent = "Renamed [[Target]]";
  });
  expect(await changes(page)).toBe(2);
  await page.evaluate(() => {
    document
      .querySelector(".rm-ref-page-view-title span")!
      .replaceChildren("Removed reference");
  });
  expect(await changes(page)).toBe(3);
});

test("native source carets refresh pins while pinned and ordinary classes stay ignored", async ({
  page,
}) => {
  await page.setContent(
    '<div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper"><span id="native-caret" class="rm-caret rm-caret-open"></span></div></div><div class="rm-ref-page-view roamjs-reference-pin-page"><div class="rm-title-arrow-wrapper"><span id="pinned-caret" class="rm-caret rm-caret-open"></span></div></div><div id="ordinary" class="roam-block"></div>',
  );
  await page.addScriptTag({ content: script });
  await page.evaluate(() => {
    document.querySelector("#pinned-caret")!.classList.add("rm-caret-closed");
    document.querySelector("#ordinary")!.classList.add("focused");
  });
  expect(await changes(page)).toBe(0);
  await page.evaluate(() =>
    document.querySelector("#native-caret")!.classList.add("rm-caret-closed"),
  );
  expect(await changes(page)).toBe(1);
});
