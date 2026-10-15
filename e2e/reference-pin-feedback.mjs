import assert from "node:assert/strict";
import fs from "node:fs/promises";
const ownedPages = [];
const ownedBlocks = [];
let fixture;
const copy = (page, uid) =>
  page.locator(`.roam-article [data-reference-pin-uid="${uid}"]`);
const nativeRow = (page, uid) =>
  page
    .locator(
      `.roam-article .rm-ref-page-view .rm-reference-item:has([data-block-uid="${uid}"])`,
    )
    .locator("..");
const closeSettings = (page) =>
  page.locator(".rm-settings-close-button").click();
const reloadExtension = async (page) => {
  await page.locator(".rm-topbar .bp3-icon-more").click();
  await page
    .locator(".bp3-menu-item")
    .filter({ hasText: /^Settings$/ })
    .click();
  await page.locator("#bp3-tab-title_rm-settings-tabs_rm-depot-tab").click();
  const row = page.locator(".rm-extension-installed").filter({
    has: page
      .locator(".rm-extension-installed__name")
      .filter({ hasText: /^pinned-blocks$/ }),
  });
  await page.evaluate(() => {
    window.feedbackPreviousStyle = document.getElementById(
      "roamjs-pinned-blocks-style",
    );
  });
  await row.locator("button.bp3-icon-refresh").click();
  await page.waitForFunction(() => {
    const style = document.getElementById("roamjs-pinned-blocks-style");
    return style && style !== window.feedbackPreviousStyle;
  });
  await closeSettings(page);
};
const assertEventually = (page, fn, arg) =>
  page.waitForFunction(fn, arg, { timeout: 60000 });
export default {
  ready: async ({ page }) =>
    page.evaluate(() =>
      Boolean(document.getElementById("roamjs-pinned-blocks-style")),
    ),
  async run({ page, outDir }) {
    assert(
      await page.evaluate(
        () =>
          /^mclicks-test-graph[123]$/.test(window.roamAlphaAPI.graph.name) ||
          window.roamAlphaAPI.graph.name === "jarvis-sandbox",
      ),
      "Test graph only",
    );
    await page.exposeFunction("ownFeedbackPage", async (uid) => {
      ownedPages.push(uid);
      await fs.writeFile(
        outDir + "/owned-pages.json",
        JSON.stringify(ownedPages),
      );
    });
    await page.exposeFunction("ownFeedbackBlock", (uid) =>
      ownedBlocks.push(uid),
    );
    fixture = await page.evaluate(async () => {
      const api = window.roamAlphaAPI;
      if (
        !/^mclicks-test-graph[123]$/.test(api.graph.name) &&
        api.graph.name !== "jarvis-sandbox"
      )
        throw Error("Test graph only");
      const target = api.util.generateUID(),
        source = api.util.generateUID(),
        titleSource = api.util.generateUID(),
        destination = api.util.generateUID(),
        titleBlock = api.util.generateUID();
      const title = "Reference feedback " + target,
        sourceTitle = "Research notes " + source,
        titleSourceTitle = "Notes about [[" + title + "]]",
        destinationTitle = "Open source " + destination;
      for (const [uid, text] of [
        [target, title],
        [source, sourceTitle],
        [destination, destinationTitle],
      ]) {
        await api.data.page.create({ page: { uid, title: text } });
        await window.ownFeedbackPage(uid);
      }
      const blocks = [];
      for (let i = 0; i < 120; i++) {
        const uid = api.util.generateUID();
        blocks.push(uid);
        await api.data.block.create({
          location: { "parent-uid": source, order: i },
          block: {
            uid,
            string: `Reference ${i + 1} [[${title}]] [[${destinationTitle}]]`,
          },
        });
        await window.ownFeedbackBlock(uid);
      }
      await api.data.page.create({
        page: { uid: titleSource, title: titleSourceTitle },
      });
      await window.ownFeedbackPage(titleSource);
      await api.data.block.create({
        location: { "parent-uid": titleSource, order: 0 },
        block: {
          uid: titleBlock,
          string: "An ordinary child, separate from the title reference",
        },
      });
      await window.ownFeedbackBlock(titleBlock);
      await api.ui.mainWindow.openPage({ page: { uid: target } });
      return {
        target,
        source,
        titleSource,
        destination,
        titleBlock,
        title,
        sourceTitle,
        titleSourceTitle,
        blocks,
      };
    });
    await fs.writeFile(
      outDir + "/fixture.json",
      JSON.stringify(fixture, null, 2),
    );
    await page
      .locator(".roam-article .rm-ref-page-view [data-block-uid]")
      .first()
      .waitFor();
    const loaded = await page
      .locator(".roam-article .rm-ref-page-view [data-block-uid]")
      .evaluateAll((els) => els.map((el) => el.dataset.blockUid));
    const first = loaded.find((uid) => fixture.blocks.includes(uid)),
      last = fixture.blocks.find((uid) => !loaded.includes(uid));
    assert(
      first && last,
      "Fixture must include both loaded and unloaded references",
    );
    fixture.unloaded = last;
    await nativeRow(page, first).waitFor();
    assert.equal(
      await page.locator(`.roam-article [data-block-uid="${last}"]`).count(),
      0,
      "The last reference must start outside the loaded DOM",
    );
    const beforeOrder = await page.evaluate(
      (f) =>
        window.roamAlphaAPI.data.pull(
          "[{:block/children [:block/uid :block/order]}]",
          [":block/uid", f.source],
        ),
      fixture,
    );
    await nativeRow(page, first).hover();
    await nativeRow(page, first)
      .getByRole("button", { name: "Pin linked reference", exact: true })
      .click();
    await copy(page, first).locator(`[data-block-uid="${first}"]`).waitFor();
    // A saved pin must render even when its native reference has not loaded.
    await page.evaluate(async (f) => {
      const api = window.roamAlphaAPI;
      const config = api.data.fast.q(
        '[:find ?uid :where [?p :node/title "roam/js/pinned-blocks"] [?p :block/uid ?uid]]',
      )[0]?.[0];
      if (!config) throw Error("Missing extension config page");
      await api.data.block.create({
        location: { "parent-uid": config, order: "last" },
        block: {
          uid: api.util.generateUID(),
          string: "Feedback fixture saved pin",
          props: {
            "roamjs-pinned-blocks": {
              type: "reference-pin",
              version: 1,
              "target-uid": f.target,
              "block-uid": f.unloaded,
            },
          },
        },
      });
    }, fixture);
    await copy(page, last).locator(`[data-block-uid="${last}"]`).waitFor();
    const sourceHeading = page
      .locator(".roam-article .rm-title-arrow-wrapper")
      .filter({ hasText: fixture.titleSourceTitle });
    await sourceHeading.hover();
    await sourceHeading
      .getByRole("button", { name: "Pin linked reference", exact: true })
      .click();
    await copy(page, fixture.titleSource).getByRole("link").waitFor();
    assert.equal(
      await sourceHeading.isVisible(),
      false,
      "A title-only native duplicate is hidden",
    );
    await page.screenshot({ path: outDir + "/expanded.png" });
    await copy(page, first)
      .locator(`[data-link-uid="${fixture.destination}"] .rm-page-ref`)
      .click();
    await assertEventually(
      page,
      (uid) => window.location.hash.endsWith("/page/" + uid),
      fixture.destination,
    );
    await page.evaluate(
      (f) =>
        window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: f.target } }),
      fixture,
    );
    // Each block's source label belongs to its preceding sibling, rather than its native renderer.
    const label = page
      .locator(".roam-article .roamjs-reference-pin-source a")
      .filter({ hasText: fixture.sourceTitle })
      .first();
    await label.click();
    await assertEventually(
      page,
      (uid) => window.location.hash.endsWith("/page/" + uid),
      fixture.source,
    );
    await page.evaluate(
      (f) =>
        window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: f.target } }),
      fixture,
    );
    const beforeSidebar = await page.evaluate(
      () => window.roamAlphaAPI.ui.rightSidebar.getWindows().length,
    );
    await label.click({ modifiers: ["Shift"] });
    await assertEventually(
      page,
      (uid) =>
        window.roamAlphaAPI.ui.rightSidebar
          .getWindows()
          .some((w) => w["page-uid"] === uid || w["block-uid"] === uid),
      fixture.source,
    );
    await page.screenshot({ path: outDir + "/source-link-sidebar.png" });
    await page.evaluate(
      async ({ uid, close }) => {
        await window.roamAlphaAPI.ui.rightSidebar.removeWindow({
          window: { type: "outline", "block-uid": uid },
        });
        if (close) await window.roamAlphaAPI.ui.rightSidebar.close();
      },
      { uid: fixture.source, close: beforeSidebar === 0 },
    );
    assert.equal(
      await page.locator(".roamjs-reference-pin-heading").count(),
      0,
    );
    assert.equal(await copy(page, first).isVisible(), true);
    assert.equal(await nativeRow(page, first).isVisible(), false);
    await page.screenshot({
      path: outDir + "/pins-without-heading-or-collapse.png",
    });
    await reloadExtension(page);
    await copy(page, fixture.titleSource).waitFor({ timeout: 60000 });
    await copy(page, first).waitFor();
    assert.equal(
      await page.locator(".roamjs-reference-pin-heading").count(),
      0,
    );
    await page.evaluate(async (f) => {
      await window.roamAlphaAPI.data.block.update({
        block: {
          uid: f.titleBlock,
          string:
            "Independent block reference [[" +
            f.title +
            "]] [[Open source " +
            f.destination +
            "]]",
        },
      });
    }, fixture);
    await nativeRow(page, fixture.titleBlock).waitFor();
    assert.equal(await sourceHeading.isVisible(), true);
    await page.evaluate(
      (f) =>
        window.roamAlphaAPI.ui.filters.setPageLinkedRefsFilters({
          page: { uid: f.target },
          filters: { includes: ["Open source " + f.destination] },
        }),
      fixture,
    );
    await assertEventually(
      page,
      (uid) => !document.querySelector(`[data-reference-pin-uid="${uid}"]`),
      fixture.titleSource,
    );
    await nativeRow(page, fixture.titleBlock).waitFor();
    assert.equal(
      await sourceHeading.getByRole("button").count(),
      0,
      "Filtered title pins must not display a misleading native control",
    );
    await page.screenshot({
      path: outDir + "/filtered-title-control-hidden.png",
    });
    await page.evaluate(
      (f) =>
        window.roamAlphaAPI.ui.filters.setPageLinkedRefsFilters({
          page: { uid: f.target },
          filters: {},
        }),
      fixture,
    );
    await copy(page, fixture.titleSource).waitFor();
    await sourceHeading.locator(".rm-caret-open").click();
    await assertEventually(
      page,
      (uid) =>
        !document.querySelector(
          `.roam-article .rm-ref-page-view [data-block-uid="${uid}"]`,
        ),
      fixture.titleBlock,
    );
    assert.equal(
      await sourceHeading.isVisible(),
      true,
      "A title pin must leave the expansion control for other references",
    );
    await copy(page, fixture.titleSource)
      .getByRole("button", { name: "Unpin linked reference", exact: true })
      .click();
    await assertEventually(
      page,
      (uid) => !document.querySelector(`[data-reference-pin-uid="${uid}"]`),
      fixture.titleSource,
    );
    await sourceHeading.locator(".rm-caret-closed").click();
    await nativeRow(page, fixture.titleBlock).waitFor();
    assert.equal(
      await nativeRow(page, fixture.titleBlock)
        .getByRole("button")
        .getAttribute("aria-pressed"),
      "false",
    );
    const afterOrder = await page.evaluate(
      (f) =>
        window.roamAlphaAPI.data.pull(
          "[{:block/children [:block/uid :block/order]}]",
          [":block/uid", f.source],
        ),
      fixture,
    );
    assert.deepEqual(
      afterOrder,
      beforeOrder,
      "Reference pin operations leave source order intact",
    );
    await page.screenshot({ path: outDir + "/native-controls-preserved.png" });
    const report = {
      graph: await page.evaluate(() => window.roamAlphaAPI.graph.name),
      fixture,
      checks: [
        "120 references with unloaded saved pin",
        "page-title-only pin/unpin",
        "native inline and source page links, including Shift-click sidebar",
        "pins always visible without heading or group collapse control",
        "pins stay visible after native extension reload",
        "title and block pins remain independent",
        "collapsed source groups preserve expansion controls",
        "source order unchanged",
        "filtered title controls hidden while saved membership survives",
      ],
    };
    await fs.writeFile(
      outDir + "/feedback-results.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    return report;
  },
  async cleanup({ page }) {
    if (!ownedPages.length) return;
    await page
      .locator(".rm-settings-close-button")
      .click({ timeout: 1000 })
      .catch(() => {});
    await page.evaluate(
      async ({ pages, blocks, f }) => {
        const api = window.roamAlphaAPI;
        const normalize = (v) =>
          v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [
                  k.replace(/^:+/, ""),
                  normalize(x),
                ]),
              )
            : v;
        if (f?.target && pages.includes(f.target))
          for (const [c] of api.data.fast.q(
            '[:find (pull ?c [:block/uid :block/props]) :where [?p :node/title "roam/js/pinned-blocks"] [?p :block/children ?c]]',
          )) {
            const r = normalize(c[":block/props"])?.["roamjs-pinned-blocks"];
            if (
              r?.type === "reference-pin" &&
              r.version === 1 &&
              r["target-uid"] === f.target &&
              [...f.blocks, f.titleSource].includes(r["block-uid"])
            )
              await api.data.block.delete({ block: { uid: c[":block/uid"] } });
          }
        await api.ui.mainWindow.openDailyNotes();
        for (const uid of blocks)
          if (api.data.pull("[:block/uid]", [":block/uid", uid]))
            await api.data.block.delete({ block: { uid } });
        for (const uid of [...pages].reverse())
          if (api.data.pull("[:block/uid]", [":block/uid", uid]))
            await api.data.page.delete({ page: { uid } });
      },
      { pages: ownedPages, blocks: ownedBlocks, f: fixture },
    );
    return { ownedPagesRemoved: ownedPages.length };
  },
};
