import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const ownedPages = [];
let fixture;
let previousMainUid;
export default {
  ready: async ({ page }) =>
    page.evaluate(() =>
      Boolean(document.getElementById("roamjs-pinned-blocks-style")),
    ),
  async run({ page, outDir, result }) {
    await page.keyboard.press("Escape");
    await page.exposeFunction("ownRenderFailurePage", (uid) =>
      ownedPages.push(uid),
    );
    previousMainUid = await page.evaluate(() =>
      window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(),
    );
    fixture = await page.evaluate(async () => {
      const api = window.roamAlphaAPI;
      if (api.graph.name !== "jarvis-sandbox")
        throw new Error("Restricted to test graph");
      const target = api.util.generateUID(),
        source = api.util.generateUID(),
        block = api.util.generateUID();
      const title = `Pin render failure ${target}`;
      await api.data.page.create({ page: { uid: target, title } });
      await window.ownRenderFailurePage(target);
      await api.data.page.create({
        page: { uid: source, title: `Pin render source ${source}` },
      });
      await window.ownRenderFailurePage(source);
      await api.data.block.create({
        location: { "parent-uid": source, order: 0 },
        block: {
          uid: block,
          string: `Keep this reference usable [[${title}]]`,
        },
      });
      await api.ui.mainWindow.openPage({ page: { uid: target } });
      return { target, source, block };
    });
    const row = page
      .locator(
        `.roam-article .rm-ref-page-view .rm-reference-item:has([data-block-uid="${fixture.block}"])`,
      )
      .locator("..");
    const pinned = page.locator(
      `.roam-article [data-reference-pin-uid="${fixture.block}"]`,
    );
    await row.waitFor();
    await page.evaluate((uid) => {
      const components = window.roamAlphaAPI.ui.components;
      window.originalPinnedBlockRenderer = components.renderBlock;
      window.failNextPinnedRender = true;
      components.renderBlock = (args) => {
        if (args.uid === uid && window.failNextPinnedRender) {
          window.failNextPinnedRender = false;
          return Promise.reject(
            new Error("Injected pinned-reference render failure"),
          );
        }
        return window.originalPinnedBlockRenderer(args);
      };
    }, fixture.block);
    await row.hover();
    await row
      .getByRole("button", { name: "Pin linked reference", exact: true })
      .click();
    await pinned.getByRole("status").waitFor();
    assert(
      await row.isVisible(),
      "A render failure must leave the original reference visible",
    );
    assert(
      await row
        .getByRole("button", { name: "Unpin linked reference", exact: true })
        .isVisible(),
    );
    await page.screenshot({
      path: path.join(outDir, "01-failure-keeps-native-reference.png"),
    });
    await row
      .getByRole("button", { name: "Unpin linked reference", exact: true })
      .click();
    await pinned.waitFor({ state: "detached" });
    assert(await row.isVisible());
    await page.evaluate(() => {
      window.failNextPinnedRender = true;
    });
    await row.hover();
    await row
      .getByRole("button", { name: "Pin linked reference", exact: true })
      .click();
    await pinned.getByRole("status").waitFor();
    await pinned.getByRole("button", { name: "Retry", exact: true }).click();
    await pinned.locator(`[data-block-uid="${fixture.block}"]`).waitFor();
    await row.waitFor({ state: "hidden" });
    assert.equal(await pinned.getByRole("status").count(), 0);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(outDir, "02-retry-restores-pinned-copy.png"),
    });
    const report = {
      nativeRowPreservedOnFailure: true,
      nativeUnpinWorksAfterFailure: true,
      retryRestoresPinnedCopy: true,
      duplicateHiddenOnlyAfterSuccess: true,
      pageErrors: result.pageErrors,
      consoleErrors: result.consoleErrors,
    };
    await fs.writeFile(
      path.join(outDir, "render-failure-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    return report;
  },
  async cleanup({ page }) {
    await page.evaluate(
      async ({ pages, block, previousMainUid }) => {
        const api = window.roamAlphaAPI;
        if (window.originalPinnedBlockRenderer)
          api.ui.components.renderBlock = window.originalPinnedBlockRenderer;
        const normalize = (value) =>
          value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([key, v]) => [
                  key.replace(/^:+/, ""),
                  normalize(v),
                ]),
              )
            : value;
        const records = api.data.fast.q(
          '[:find (pull ?c [:block/uid :block/props]) :where [?p :node/title "roam/js/pinned-blocks"] [?p :block/children ?c]]',
        );
        for (const [record] of records)
          if (
            normalize(record[":block/props"])?.["roamjs-pinned-blocks"]?.[
              "block-uid"
            ] === block
          )
            await api.data.block.delete({
              block: { uid: record[":block/uid"] },
            });
        for (const uid of pages) await api.data.page.delete({ page: { uid } });
        if (previousMainUid)
          await api.ui.mainWindow.openPage({ page: { uid: previousMainUid } });
      },
      { pages: ownedPages, block: fixture?.block, previousMainUid },
    );
    return { pagesRemoved: ownedPages.length, rendererRestored: true };
  },
};
