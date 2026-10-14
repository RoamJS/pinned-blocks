import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
const skillsRoot =
  process.env.ROAMJS_SKILLS_ROOT ||
  path.join(os.homedir(), ".agents", "skills", "roamjs");
const {
  readFolderFiles,
  installDirectoryPickerShim,
  openRoamDepotSettings,
  removeExistingDeveloperExtensions,
  registerDeveloperExtension,
  activateDeveloperExtensions,
} = await import(
  pathToFileURL(
    path.join(
      skillsRoot,
      "roamjs-load-extension",
      "scripts",
      "load-plugin.mjs",
    ),
  ).href
);
const ownedPages = [];
const ownedDailyPages = [];
let fixture;
export default {
  ready: async ({ page }) =>
    page.evaluate(() =>
      Boolean(document.getElementById("roamjs-pinned-blocks-style")),
    ),
  async run({ page, repoDir, outDir, result }) {
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      window.roamAlphaAPI.ui.mainWindow.openDailyNotes(),
    );
    await page
      .locator(".roam-log-page .rm-title-display-container[data-page-uid]")
      .nth(1)
      .waitFor();
    await page.exposeFunction("ownCollapsedDailyPage", (uid) =>
      ownedPages.push(uid),
    );
    await page.exposeFunction("ownCollapsedDailyDate", (uid) =>
      ownedDailyPages.push(uid),
    );
    fixture = await page.evaluate(async () => {
      const api = window.roamAlphaAPI;
      if (api.graph.name !== "jarvis-sandbox")
        throw new Error("Restricted to test graph");
      const targets = Array.from(
        document.querySelectorAll(
          ".roam-log-page .rm-title-display-container[data-page-uid]",
        ),
      )
        .slice(0, 2)
        .map((el) => ({
          uid: el.dataset.pageUid,
          title: el.querySelector("h1")?.textContent,
        }));
      for (const target of targets) {
        if (!target.uid || !target.title)
          throw new Error("Daily-note page metadata missing");
        if (!api.data.pull("[:block/uid]", [":block/uid", target.uid])) {
          await api.data.page.create({ page: target });
          await window.ownCollapsedDailyDate(target.uid);
        }
      }
      const source = api.util.generateUID(),
        sourceTitle = `Collapsed daily pin source ${source}`,
        blocks = [];
      await api.data.page.create({ page: { uid: source, title: sourceTitle } });
      await window.ownCollapsedDailyPage(source);
      for (const [index, target] of targets.entries()) {
        target.block = api.util.generateUID();
        target.sibling = api.util.generateUID();
        for (const [offset, uid] of [target.block, target.sibling].entries()) {
          await api.data.block.create({
            location: { "parent-uid": source, order: index * 2 + offset },
            block: {
              uid,
              string: `${offset ? "Other" : "Pinned"} daily reference [[${target.title}]]`,
            },
          });
          blocks.push(uid);
        }
      }
      return { source, sourceTitle, targets, blocks };
    });
    const article = (uid) =>
      page.locator(".roam-log-page").filter({
        has: page.locator(
          `.rm-title-display-container[data-page-uid="${uid}"]`,
        ),
      });
    const pinned = (target) =>
      article(target.uid).locator(`[data-reference-pin-uid="${target.block}"]`);
    const normal = (target) =>
      article(target.uid)
        .locator(
          `.rm-ref-page-view .rm-reference-item:has([data-block-uid="${target.block}"])`,
        )
        .locator("..");
    for (const target of fixture.targets) {
      await normal(target).waitFor();
      await normal(target).hover();
      await normal(target)
        .getByRole("button", { name: "Pin linked reference", exact: true })
        .click();
      await pinned(target)
        .locator(`[data-block-uid="${target.block}"]`)
        .waitFor();
      const carets = article(target.uid).locator(
        ".rm-ref-page-view > .rm-title-arrow-wrapper .rm-caret-open",
      );
      while (await carets.count()) {
        const before = await carets.count();
        const caret = carets.first();
        if (await caret.isVisible()) await caret.click();
        else await caret.evaluate((el) => el.click());
        await page.waitForFunction(
          ({ uid, before }) => {
            const heading = document.querySelector(
              `.roam-log-page .rm-title-display-container[data-page-uid="${uid}"]`,
            );
            return (
              heading &&
              heading
                .closest(".roam-log-page")
                .querySelectorAll(
                  ".rm-ref-page-view > .rm-title-arrow-wrapper .rm-caret-open",
                ).length < before
            );
          },
          { uid: target.uid, before },
        );
      }
    }
    const noNativeRows = (targets) =>
      targets.every((target) => {
        const heading = document.querySelector(
          `.roam-log-page .rm-title-display-container[data-page-uid="${target.uid}"]`,
        );
        return (
          heading &&
          heading
            .closest(".roam-log-page")
            .querySelectorAll(".rm-ref-page-view .rm-reference-item").length ===
            0
        );
      });
    await page.waitForFunction(noNativeRows, fixture.targets);
    const files = await readFolderFiles(repoDir);
    await installDirectoryPickerShim({
      page,
      dirName: path.basename(repoDir),
      files,
    });
    await openRoamDepotSettings({ page, timeout: 30000 });
    await removeExistingDeveloperExtensions({
      page,
      registrationName: path.basename(repoDir),
      timeout: 30000,
    });
    await registerDeveloperExtension({
      page,
      registrationName: path.basename(repoDir),
      timeout: 30000,
    });
    await activateDeveloperExtensions({ page, timeout: 30000 });
    await page.keyboard.press("Escape");
    for (const target of fixture.targets) {
      await pinned(target)
        .locator(`[data-block-uid="${target.block}"]`)
        .waitFor();
      assert.equal(
        await article(target.uid)
          .locator(".rm-ref-page-view .rm-reference-item")
          .count(),
        0,
      );
      const other = fixture.targets.find((entry) => entry.uid !== target.uid);
      assert.equal(
        await article(target.uid)
          .locator(`[data-reference-pin-uid="${other.block}"]`)
          .count(),
        0,
      );
    }
    assert.equal(
      await page.evaluate(() =>
        window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(),
      ),
      null,
    );
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(outDir, "01-two-collapsed-daily-note-pins.png"),
      fullPage: true,
    });
    const [first, second] = fixture.targets;
    await pinned(first)
      .getByRole("button", { name: "Unpin linked reference", exact: true })
      .click();
    await pinned(first).waitFor({ state: "detached" });
    assert(
      await pinned(second).isVisible(),
      "Unpinning one daily note must preserve the other",
    );
    const sourceGroup = article(first.uid)
      .locator(".rm-ref-page-view")
      .filter({ hasText: fixture.sourceTitle });
    await sourceGroup
      .locator(".rm-title-arrow-wrapper .rm-caret-closed")
      .click();
    await normal(first).waitFor({ state: "visible" });
    await normal(first).hover();
    assert(
      await normal(first)
        .getByRole("button", { name: "Pin linked reference", exact: true })
        .isVisible(),
    );
    const sourceOrder = await page.evaluate(
      (uid) =>
        window.roamAlphaAPI.data
          .pull("[{:block/children [:block/uid :block/order]}]", [
            ":block/uid",
            uid,
          ])
          [":block/children"].sort(
            (a, b) => a[":block/order"] - b[":block/order"],
          )
          .map((child) => child[":block/uid"]),
      fixture.source,
    );
    assert.deepEqual(sourceOrder, fixture.blocks);
    await page.screenshot({
      path: path.join(outDir, "02-daily-unpin-keeps-other-pin.png"),
    });
    const report = {
      collapsedDailyPinsRestoredAfterActivation: true,
      mainWindowUid: null,
      testedDailyArticles: fixture.targets.length,
      nativeRowsAbsentAtRestoration: true,
      dailyTargetsIndependent: true,
      unpinPreservedOtherDailyPin: true,
      originalRowAvailableAfterExpansion: true,
      sourceOrderUnchanged: true,
      pageErrors: result.pageErrors,
      consoleErrors: result.consoleErrors,
    };
    await fs.writeFile(
      path.join(outDir, "collapsed-daily-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    return report;
  },
  async cleanup({ page }) {
    return page.evaluate(
      async ({ pages, dailyPages, fixture }) => {
        const api = window.roamAlphaAPI;
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
            fixture?.blocks.includes(
              normalize(record[":block/props"])?.["roamjs-pinned-blocks"]?.[
                "block-uid"
              ],
            )
          )
            await api.data.block.delete({
              block: { uid: record[":block/uid"] },
            });
        for (const uid of pages) await api.data.page.delete({ page: { uid } });
        const retainedDailyPages = [];
        for (const uid of dailyPages) {
          const children =
            api.data.pull("[{:block/children [:block/uid]}]", [
              ":block/uid",
              uid,
            ])?.[":block/children"] || [];
          const refs = api.data.fast.q(
            "[:find ?b :in $ ?u :where [?p :block/uid ?u] [?b :block/refs ?p]]",
            uid,
          );
          if (!children.length && !refs.length)
            await api.data.page.delete({ page: { uid } });
          else retainedDailyPages.push(uid);
        }
        await api.ui.mainWindow.openDailyNotes();
        return { sourcePagesRemoved: pages.length, retainedDailyPages };
      },
      { pages: ownedPages, dailyPages: ownedDailyPages, fixture },
    );
  },
};
