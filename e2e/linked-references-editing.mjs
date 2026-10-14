import assert from "node:assert/strict";
import fs from "node:fs/promises";
const ownedPages = [];
let fixture;
export default {
  ready: async ({ page }) =>
    page.evaluate(() =>
      Boolean(document.getElementById("roamjs-pinned-blocks-style")),
    ),
  async run({ page, outDir, result }) {
    await page.keyboard.press("Escape");
    await page.exposeFunction("ownReferenceEditingPage", (uid) =>
      ownedPages.push(uid),
    );
    fixture = await page.evaluate(async () => {
      const api = window.roamAlphaAPI;
      if (api.graph.name !== "jarvis-sandbox")
        throw new Error("Test graph only");
      const target = api.util.generateUID(),
        source = api.util.generateUID(),
        editor = api.util.generateUID();
      const refs = [];
      const title = "Typing pins " + target;
      for (const [uid, titleValue] of [
        [target, title],
        [source, "Typing source " + source],
      ]) {
        await api.data.page.create({ page: { uid, title: titleValue } });
        await window.ownReferenceEditingPage(uid);
      }
      await api.data.block.create({
        location: { "parent-uid": target, order: 0 },
        block: { uid: editor, string: "Ordinary editing " },
      });
      for (let order = 0; order < 3; order++) {
        const uid = api.util.generateUID();
        refs.push(uid);
        await api.data.block.create({
          location: { "parent-uid": source, order },
          block: {
            uid,
            string: "Pinned reference " + order + " [[" + title + "]]",
          },
        });
      }
      await api.ui.mainWindow.openPage({ page: { uid: target } });
      return { target, source, editor, refs };
    });
    for (const uid of fixture.refs) {
      const row = page
        .locator(
          `.roam-article .rm-ref-page-view .rm-reference-item:has([data-block-uid="${uid}"])`,
        )
        .locator("..");
      await row.waitFor();
      await row.hover();
      await row
        .getByRole("button", { name: "Pin linked reference", exact: true })
        .click();
      await page
        .locator(
          `.roam-article [data-reference-pin-uid="${uid}"] [data-block-uid="${uid}"]`,
        )
        .waitFor();
    }
    await page.evaluate(() => {
      window.originalReferenceEditingPull = window.roamAlphaAPI.data.pull;
      window.referenceEditingPullCount = 0;
      window.roamAlphaAPI.data.pull = function (pattern, ...args) {
        if (
          typeof pattern === "string" &&
          pattern.includes(":block/parents") &&
          pattern.includes(":block/refs")
        )
          window.referenceEditingPullCount++;
        return window.originalReferenceEditingPull.call(this, pattern, ...args);
      };
    });
    const editor = page.locator(
      `.roam-article .roam-block-container[data-block-uid="${fixture.editor}"] .roam-block`,
    );
    await editor.click();
    const textarea = page.locator(
      `.roam-article .roam-block-container[data-block-uid="${fixture.editor}"] textarea`,
    );
    await textarea.waitFor();
    await page.keyboard.press("End");
    await page.waitForTimeout(800);
    await page.evaluate(() => (window.referenceEditingPullCount = 0));
    await page.keyboard.type(
      "plain text typed in the outline while three references are pinned",
      { delay: 15 },
    );
    await page.waitForTimeout(600);
    const outlinePulls = await page.evaluate(
      () => window.referenceEditingPullCount,
    );
    assert.equal(
      outlinePulls,
      0,
      "Ordinary typing must not reread all pinned references",
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    await page.evaluate(() => (window.referenceEditingPullCount = 0));
    await page.evaluate(() => {
      const status = document.createElement("div");
      status.id = "reference-editing-status";
      status.textContent = "Ready";
      document.body.append(status);
      for (let i = 0; i < 20; i++) status.textContent = "Status " + i;
      status.remove();
    });
    await page.waitForTimeout(600);
    const unrelatedPulls = await page.evaluate(
      () => window.referenceEditingPullCount,
    );
    assert.equal(
      unrelatedPulls,
      0,
      "Unrelated UI text must not reread references",
    );
    await page.screenshot({ path: outDir + "/typing-with-three-pins.png" });
    await page.evaluate(() => (window.referenceEditingPullCount = 0));
    await page.evaluate(
      async ({ source, target }) => {
        const uid = window.roamAlphaAPI.util.generateUID();
        const title = window.roamAlphaAPI.data.pull("[:node/title]", [
          ":block/uid",
          target,
        ])[":node/title"];
        await window.roamAlphaAPI.data.block.create({
          location: { "parent-uid": source, order: 3 },
          block: { uid, string: "Added reference [[" + title + "]]" },
        });
      },
      { source: fixture.source, target: fixture.target },
    );
    await page
      .locator(".roam-article .rm-ref-page-view")
      .getByText("Added reference", { exact: false })
      .waitFor();
    await page.waitForFunction(
      () => window.referenceEditingPullCount > 0,
      null,
      {
        timeout: 5000,
      },
    );
    const structurePulls = await page.evaluate(
      () => window.referenceEditingPullCount,
    );
    assert(structurePulls > 0, "Reference additions must still refresh pins");
    assert.equal(
      await page.locator(".roam-article [data-reference-pin-uid]").count(),
      3,
    );
    const report = {
      outlineTypingReferencePulls: outlinePulls,
      unrelatedUiReferencePulls: unrelatedPulls,
      referenceAdditionPulls: structurePulls,
      pinsPreserved: 3,
      pageErrors: result.pageErrors,
    };
    await fs.writeFile(
      outDir + "/typing-results.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    return report;
  },
  async cleanup({ page }) {
    await page.evaluate(
      async ({ pages, refs }) => {
        const api = window.roamAlphaAPI;
        if (window.originalReferenceEditingPull)
          api.data.pull = window.originalReferenceEditingPull;
        const normalize = (v) =>
          v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, val]) => [
                  k.replace(/^:+/, ""),
                  normalize(val),
                ]),
              )
            : v;
        for (const [c] of api.data.fast.q(
          '[:find (pull ?c [:block/uid :block/props]) :where [?p :node/title "roam/js/pinned-blocks"] [?p :block/children ?c]]',
        ))
          if (
            refs.includes(
              normalize(c[":block/props"])?.["roamjs-pinned-blocks"]?.[
                "block-uid"
              ],
            )
          )
            await api.data.block.delete({ block: { uid: c[":block/uid"] } });
        for (const uid of pages) await api.data.page.delete({ page: { uid } });
        await api.ui.mainWindow.openDailyNotes();
      },
      { pages: ownedPages, refs: fixture?.refs || [] },
    );
    return { ownedPagesRemoved: ownedPages.length };
  },
};
