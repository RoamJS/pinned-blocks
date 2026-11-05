import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test.use({
  launchOptions: { executablePath: process.env.ROAM_BROWSER_EXECUTABLE_PATH },
});

let script: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "testExtension",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "roam-host-fixture",
        setup: (builder): void => {
          builder.onResolve({ filter: /^roamjs-components\// }, (args) => ({
            path: args.path,
            namespace: "host-fixture",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "host-fixture" },
            (args) => {
              if (args.path.endsWith("/Toast"))
                return { contents: "export const render = () => {};" };
              if (args.path.endsWith("/addStyle"))
                return {
                  contents: `export default (css,id) => {
                  const style = document.createElement('style');
                  style.id=id; style.textContent=css; document.head.append(style);
                  return style;
                };`,
                };
              if (args.path.endsWith("/getPageUidByPageTitle"))
                return { contents: "export default () => 'config123';" };
              if (args.path.endsWith("/getParentUidByBlockUid"))
                return { contents: "export default () => 'target123';" };
              if (args.path.endsWith("/getShallowTreeByParentUid"))
                return { contents: "export default () => [];" };
              throw new Error(`Unexpected host dependency: ${args.path}`);
            },
          );
        },
      },
    ],
  });
  script = result.outputFiles[0].text;
});

for (const preference of [undefined, false, true]) {
  test(`startup exposes near-bullet controls with saved preference ${preference}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setContent(`
      <style>.roam-article{margin:60px;width:600px}.rm-block-main{display:flex;min-height:28px}</style>
      <div class="roam-article">
        <div class="roam-block-container"><div class="rm-block-main">
          <span class="controls">•</span><div class="roam-block" id="block-input-outline12">Next action</div>
        </div></div>
        <div class="rm-reference-container"><div class="flex-h-box"><strong>1 Linked Reference</strong></div>
          <div class="rm-mentions"><div class="rm-ref-page-view"><div class="rm-title-arrow-wrapper">Source page</div>
            <div><div class="flex-h-box" data-testid="reference-row"><div class="rm-reference-item">
              <div class="roam-block-container" data-block-uid="block1234"><div class="rm-block-main">
                <div class="roam-block" id="block-input-user-mentions-page-target123-block1234">Reference to next action</div>
              </div></div>
            </div></div></div>
          </div></div>
        </div>
      </div>`);
    await page.evaluate(`
      window.settingsReads = 0; window.settingsPanels = 0;
      window.roamAlphaAPI = {
        util: { generateUID: () => 'notice123' },
        data: {
          fast: { q: () => [] }, pull: () => null,
          block: { create: async () => {}, update: async () => {}, delete: async () => {}, reorderBlocks: async () => {} },
          addPullWatch: () => {}, removePullWatch: () => {}
        },
        ui: {
          getFocusedBlock: () => null,
          blockContextMenu: { addCommand: () => {}, removeCommand: () => {} },
          mainWindow: { getOpenPageOrBlockUid: async () => 'target123' },
          rightSidebar: { getWindows: () => [] },
          filters: { getGlobalFilters: () => ({}), getPageLinkedRefsFilters: () => ({}) }
        }
      };
      window.extensionAPI = {
        settings: {
          get: () => { window.settingsReads++; return ${JSON.stringify(preference) ?? "undefined"}; },
          panel: { create: () => { window.settingsPanels++; } }
        },
        ui: { commandPalette: { addCommand: async () => {}, removeCommand: async () => {} } }
      };
    `);
    await page.addScriptTag({ content: script });
    await page.evaluate(
      "window.testExtension.default.onload({extensionAPI: window.extensionAPI})",
    );
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(errors).toEqual([]);
    const outline = page.locator(".roamjs-outline-pin-control button");
    await expect(outline).toHaveCount(1);
    await page.locator(".rm-block-main").first().hover();
    await expect(outline).toHaveCSS("opacity", "1");
    const row = page.getByTestId("reference-row");
    await expect(row).toHaveClass(/roamjs-reference-pin-near-bullet/);
    await row.hover();
    await expect(row.getByRole("button")).toHaveCSS("opacity", "1");
    expect(await page.evaluate("window.settingsReads")).toBe(0);
    expect(await page.evaluate("window.settingsPanels")).toBe(0);

    await page.evaluate("window.testExtension.default.onunload()");
    await expect(
      page.locator(
        ".roamjs-outline-pin-control, .roamjs-reference-pin-control",
      ),
    ).toHaveCount(0);
    await expect(page.locator("#roamjs-pinned-blocks-style")).toHaveCount(0);
    await expect(page.getByText("Next action", { exact: true })).toBeVisible();
  });
}
