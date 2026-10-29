import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";

test.use({
  launchOptions: { executablePath: process.env.ROAM_BROWSER_EXECUTABLE_PATH },
});
const script = buildSync({
  stdin: {
    contents: `import { createPinGutterBounds } from './src/pinGutterBounds';
      import { OUTLINE_PIN_STYLES } from './src/outlinePinControls';
      import { LINKED_REFERENCE_STYLES } from './src/linkedReferences';
      window.pinStyles = OUTLINE_PIN_STYLES + LINKED_REFERENCE_STYLES;
      window.gutter = createPinGutterBounds();`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
}).outputFiles[0].text;
const pin = (control: string): string =>
  `<span class="${control}"><button class="bp3-button bp3-minimal bp3-small" aria-pressed="true" aria-busy="false"><span class="bp3-icon">◆</span></button></span>`;
const setup = async (page: Page, mode: string): Promise<void> => {
  await page.setContent(`<style>
    body { margin: 0; }
    .roam-body-main { margin-left: 232px; width: 620px; }
    .roam-article { box-sizing: border-box; width: 100%; max-width: 800px; margin: 0 auto; padding: 0 42px; }
    .rm-spacing--medium .roam-article { max-width: 1100px; }
    .rm-block-main { display: flex; margin-left: -27px; height: 28px; }
    .controls { position: relative; width: 40px; flex-shrink: 0; }
    .rm-caret { position: absolute; left: 4px; top: 4px; width: 16px; height: 16px; }
    .roamjs-reference-pin-title-row { margin-left: -12px; min-height: 24px; }
    .roamjs-reference-pin-row { margin-left: -8px; min-height: 30px; }
    .bp3-button.bp3-small { min-width: 24px; height: 24px; }
  </style><div class="roam-body-main"><div class="rm-article-wrapper rm-spacing--${mode}"><div class="roam-article">
    <h1>Native page heading</h1>
    <div class="rm-block-main roamjs-outline-pin-host">${pin("roamjs-outline-pin-control")}<div class="controls"><span class="rm-caret"></span></div><div class="roam-block">Native outline text</div></div>
    <div class="roamjs-reference-pin-title-row roamjs-reference-pin-near-bullet"><div class="rm-ref-page-view-title">Source title</div>${pin("roamjs-reference-pin-control")}</div>
    <div class="roamjs-reference-pin-row roamjs-reference-pin-near-bullet"><div class="rm-reference-item">Native reference text</div>${pin("roamjs-reference-pin-control")}</div>
  </div></div></div>`);
  await page.addScriptTag({ content: script });
  await page.addStyleTag({ content: await page.evaluate("window.pinStyles") });
};
const measureContent = (page: Page): Promise<unknown> =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        "h1, .roam-block, .rm-caret, .rm-ref-page-view-title, .rm-reference-item",
      ),
    ).map((e) => {
      const { x, y, width, height } = e.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );

for (const mode of ["small", "medium"]) {
  test(`${mode} width keeps pins inside the main pane without moving native content or covering carets`, async ({
    page,
  }) => {
    await setup(page, mode);
    const host = (await page
      .locator(".roamjs-outline-pin-host")
      .boundingBox())!;
    await page.evaluate(({ x, y }) => {
      const guide = document.createElement("div");
      guide.className = "rm-multibar";
      Object.assign(guide.style, {
        position: "absolute",
        left: `${x - 6}px`,
        top: `${y}px`,
        width: "8px",
        height: "200px",
        zIndex: "10",
      });
      document.body.append(guide);
      document.querySelectorAll("button").forEach((button) => {
        button.onclick = (): void => {
          button.dataset.clicked = "true";
        };
      });
    }, host);
    const content = await measureContent(page);
    const pane = (await page.locator(".roam-body-main").boundingBox())!;
    const first = page.locator(".roamjs-outline-pin-control > button");
    expect((await first.boundingBox())!.x).toBeLessThan(pane.x);
    await page.evaluate("window.gutter.refresh()");
    await expect(page.locator(".roam-article")).toHaveAttribute(
      "data-roamjs-pin-edge",
      "",
    );
    const buttons = await page
      .locator(
        ".roamjs-outline-pin-control > button, .roamjs-reference-pin-control > button",
      )
      .all();
    const caret = (await page.locator(".rm-caret").boundingBox())!;
    const column = (await first.boundingBox())!.x;
    for (const button of buttons) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThan(pane.x);
      expect(box.x).toBe(column);
      expect(box.x + box.width).toBeLessThanOrEqual(caret.x);
      await button.click();
      await expect(button).toHaveAttribute("data-clicked", "true");
    }
    expect(await measureContent(page)).toEqual(content);
    await page.evaluate("window.gutter.cleanup()");
    await expect(page.locator("[data-roamjs-pin-edge]")).toHaveCount(0);
    expect((await first.boundingBox())!.x).toBeLessThan(pane.x);
    expect(await measureContent(page)).toEqual(content);
  });
}

test("gutter responds to pane resize and width-mode changes and handles reference-only pages", async ({
  page,
}) => {
  await setup(page, "small");
  await page.evaluate("window.gutter.refresh()");
  const article = page.locator(".roam-article");
  await expect(article).toHaveAttribute("data-roamjs-pin-edge", "");
  await page.locator(".roam-body-main").evaluate((el) => {
    (el as HTMLElement).style.width = "1100px";
  });
  await expect(page.locator("[data-roamjs-pin-edge]")).toHaveCount(0);
  await page.locator(".rm-article-wrapper").evaluate((el) => {
    el.className = "rm-article-wrapper rm-spacing--medium";
  });
  await expect(article).toHaveAttribute("data-roamjs-pin-edge", "");
  await page.locator(".roamjs-outline-pin-host").evaluate((el) => el.remove());
  await page.evaluate("window.gutter.refresh()");
  await expect(article).toHaveAttribute("data-roamjs-pin-edge", "");
  const pane = (await page.locator(".roam-body-main").boundingBox())!;
  for (const button of await page
    .locator(".roamjs-reference-pin-control > button")
    .all())
    expect((await button.boundingBox())!.x).toBeGreaterThan(pane.x);
  await page.locator(".rm-article-wrapper").evaluate((el) => {
    el.className = "rm-article-wrapper rm-spacing--small";
  });
  await expect(page.locator("[data-roamjs-pin-edge]")).toHaveCount(0);
  await page.evaluate("window.gutter.cleanup()");
  await page.locator(".roam-body-main").evaluate((el) => {
    (el as HTMLElement).style.width = "620px";
  });
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.locator("[data-roamjs-pin-edge]")).toHaveCount(0);
});
