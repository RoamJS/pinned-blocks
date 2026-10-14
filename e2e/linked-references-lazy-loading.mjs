import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
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
const expectMainPin = async (page, uid) => {
  assert(
    await page
      .locator(`.roam-article [data-reference-pin-uid="${uid}"]`)
      .isVisible(),
    "Sidebar filter must not hide the main pin",
  );
};
const ownedPages = new Set();
let fixture;
let picked;
let completed = false;
const collect = async (page) =>
  page.evaluate(() => ({
    rendered: Array.from(
      document.querySelectorAll(".roam-article .rm-reference-item"),
    )
      .filter((item) => !item.closest(".roamjs-reference-pin-panel"))
      .map((item) => item.querySelector("[data-block-uid]")?.dataset.blockUid)
      .filter(Boolean),
    headings: Array.from(
      document.querySelectorAll(".roam-article .rm-reference-container strong"),
    ).map((el) => el.textContent),
    moreControls: Array.from(
      document.querySelectorAll(
        'button,.rm-mentions a,.rm-mentions [role="button"]',
      ),
    )
      .map((el) => ({
        text: el.textContent,
        title: el.getAttribute("title"),
        label: el.getAttribute("aria-label"),
      }))
      .filter((x) =>
        /more|load|next/i.test([x.text, x.title, x.label].join(" ")),
      ),
    pinned: Array.from(
      document.querySelectorAll(".roam-article .roamjs-reference-pin-active"),
    ).map((row) => row.querySelector("[data-block-uid]")?.dataset.blockUid),
    tail: document
      .querySelector(".roam-article .rm-mentions")
      ?.textContent?.slice(-1400),
  }));
const stored = async (page, target, uid, backend = false) =>
  page.evaluate(
    async ({ target, uid, backend }) => {
      const normalize = (value) =>
        value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([key, v]) => [
                key.replace(/^:+/, ""),
                normalize(v),
              ]),
            )
          : value;
      const query =
        '[:find (pull ?c [:block/uid :block/props]) :where [?p :node/title "roam/js/pinned-blocks"] [?p :block/children ?c]]';
      const records = await (backend
        ? window.roamAlphaAPI.data.backend.q(query)
        : window.roamAlphaAPI.data.fast.q(query));
      return records.some(([c]) => {
        const p = normalize(c[":block/props"])?.["roamjs-pinned-blocks"];
        return (
          p?.type === "reference-pin" &&
          p?.["target-uid"] === target &&
          p?.["block-uid"] === uid
        );
      });
    },
    { target, uid, backend },
  );
const waitStored = async (page, target, uid, backend = false) => {
  const started = Date.now();
  while (Date.now() - started < 45000) {
    if (await stored(page, target, uid, backend)) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`Pin record missing ${backend ? "on backend" : "locally"}`);
};
const loadBatch = async (page) => {
  const section = page
    .locator(".rm-reference-container")
    .filter({ has: page.locator(".rm-mentions") })
    .first();
  const control = section
    .getByText(/^(show|load) (\d+ )?more( references| results)?(\.\.\.)?$/i)
    .first();
  if ((await control.count()) && (await control.isVisible())) {
    await control.click();
    console.log("Clicked native more control");
  } else {
    await page.mouse.move(700, 650);
    await page.mouse.wheel(0, 4000);
  }
  await page.waitForTimeout(600);
};
export default {
  ready: async ({ page }) =>
    page.evaluate(() =>
      Boolean(document.getElementById("roamjs-pinned-blocks-style")),
    ),
  async run({ page, outDir, repoDir, result }) {
    await page.keyboard.press("Escape");
    await page.exposeFunction("registerLazyFixturePage", (uid) =>
      ownedPages.add(uid),
    );
    const sourcePageCount = Number(process.env.ROAMJS_LAZY_SOURCE_PAGES || 24);
    assert(
      Number.isInteger(sourcePageCount) &&
        sourcePageCount >= 1 &&
        sourcePageCount <= 24,
    );
    fixture = await page.evaluate(async (sourcePageCount) => {
      const api = window.roamAlphaAPI;
      if (api.graph.name !== "jarvis-sandbox")
        throw new Error("Restricted to test graph");
      const target = api.util.generateUID(),
        other = api.util.generateUID();
      const title = `Lazy pin test ${target}`;
      await api.data.page.create({ page: { uid: target, title } });
      await window.registerLazyFixturePage(target);
      await api.data.page.create({
        page: { uid: other, title: `Lazy pin alternate ${other}` },
      });
      await window.registerLazyFixturePage(other);
      const blocks = [],
        sources = [];
      for (let i = 0; i < sourcePageCount; i++) {
        const uid = api.util.generateUID();
        sources.push(uid);
        await api.data.page.create({
          page: {
            uid,
            title: `Lazy pin source ${String(i).padStart(2, "0")} ${target}`,
          },
        });
        await window.registerLazyFixturePage(uid);
        for (let j = 0; j < 5; j++) {
          const blockUid = api.util.generateUID();
          blocks.push({ uid: blockUid, sourceUid: uid, ordinal: i * 5 + j });
          await api.data.block.create({
            location: { "parent-uid": uid, order: j },
            block: {
              uid: blockUid,
              string: `Reference ${String(i * 5 + j).padStart(3, "0")} [[${title}]]`,
            },
          });
        }
      }
      await api.ui.mainWindow.openPage({ page: { uid: target } });
      return { target, other, title, sources, blocks };
    }, sourcePageCount);
    await page.locator(".roam-article .rm-reference-item").first().waitFor();
    await page.waitForTimeout(1200);
    const initial = await collect(page);
    console.log("INITIAL " + JSON.stringify(initial));
    await page.screenshot({ path: path.join(outDir, "01-initial-batch.png") });
    const initialSet = new Set(initial.rendered);
    const absent = fixture.blocks.filter((b) => !initialSet.has(b.uid));
    if (!absent.length) {
      const report = {
        status: "lazy-loading-not-triggered",
        total: fixture.blocks.length,
        initial,
      };
      await fs.writeFile(
        path.join(outDir, "lazy-results.json"),
        JSON.stringify(report, null, 2),
      );
      return report;
    }
    picked = absent[0];
    const batches = [];
    for (let i = 0; i < 40; i++) {
      await loadBatch(page);
      const state = await collect(page);
      batches.push({
        iteration: i,
        rendered: state.rendered.length,
        pickedRendered: state.rendered.includes(picked.uid),
        moreControls: state.moreControls,
      });
      if (state.rendered.includes(picked.uid)) break;
    }
    console.log("BATCHES " + JSON.stringify(batches));
    const fullyLoaded = await collect(page);
    assert(
      fullyLoaded.rendered.includes(picked.uid),
      "Could not reveal selected late reference via native lazy loading",
    );
    const row = page
      .locator(
        `.roam-article .rm-ref-page-view .rm-reference-item:has([data-block-uid="${picked.uid}"])`,
      )
      .locator("..");
    await row
      .getByRole("button", { name: "Pin linked reference", exact: true })
      .waitFor();
    const orderBefore = await page.evaluate(
      (uid) =>
        window.roamAlphaAPI.data.pull(
          "[{:block/children [:block/uid :block/order]}]",
          [":block/uid", uid],
        ),
      picked.sourceUid,
    );
    await row.hover();
    await row
      .getByRole("button", { name: "Pin linked reference", exact: true })
      .click();
    await page.waitForFunction(
      (uid) =>
        document.querySelector(
          `.roamjs-reference-pin-active [data-block-uid="${uid}"]`,
        ),
      picked.uid,
    );
    await waitStored(page, fixture.target, picked.uid);
    const orderAfter = await page.evaluate(
      (uid) =>
        window.roamAlphaAPI.data.pull(
          "[{:block/children [:block/uid :block/order]}]",
          [":block/uid", uid],
        ),
      picked.sourceUid,
    );
    assert.deepEqual(orderAfter, orderBefore);
    await page
      .locator(".roam-article")
      .getByRole("heading", { name: /Pinned references/ })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(outDir, "02-late-reference-pinned.png"),
    });
    await page.mouse.move(700, 300);
    await page.mouse.wheel(0, -100000);
    await page.waitForTimeout(300);
    await waitStored(page, fixture.target, picked.uid, true);
    console.log("BACKEND pin record confirmed");
    await page.reload();
    await page.waitForFunction(() => Boolean(window.roamAlphaAPI?.data));
    await installDirectoryPickerShim({
      page,
      dirName: path.basename(repoDir),
      files: await readFolderFiles(repoDir),
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
    await page.waitForFunction(() =>
      Boolean(document.getElementById("roamjs-pinned-blocks-style")),
    );
    await page.locator(".roam-article .rm-reference-item").first().waitFor();
    await page.waitForTimeout(1000);
    const reopened = await collect(page);
    assert(
      reopened.pinned.includes(picked.uid),
      "Saved pin must render before lazy loading",
    );
    assert(
      !reopened.rendered.includes(picked.uid),
      "Pinned reference must remain absent from native initial batch",
    );
    console.log("REOPENED diagnostics " + JSON.stringify(reopened));
    await fs.writeFile(
      path.join(outDir, "intermediate-results.json"),
      JSON.stringify({ fixture, initial, batches, reopened }, null, 2),
    );
    await waitStored(page, fixture.target, picked.uid);
    await page.screenshot({
      path: path.join(outDir, "03-reopened-before-loading.png"),
    });
    console.log(
      "REOPENED " +
        JSON.stringify({
          rendered: reopened.rendered.length,
          pickedRendered: reopened.rendered.includes(picked.uid),
          pinned: reopened.pinned,
        }),
    );
    const restoredBatches = [];
    for (
      let i = 0;
      i < 40 && !(await collect(page)).rendered.includes(picked.uid);
      i++
    ) {
      await loadBatch(page);
      const state = await collect(page);
      restoredBatches.push({
        iteration: i,
        rendered: state.rendered.length,
        pickedRendered: state.rendered.includes(picked.uid),
      });
    }
    await page.waitForFunction(
      (uid) =>
        document.querySelector(
          `.roamjs-reference-pin-active [data-block-uid="${uid}"]`,
        ),
      picked.uid,
    );
    await page
      .locator(".roam-article")
      .getByRole("heading", { name: /Pinned references/ })
      .scrollIntoViewIfNeeded();
    const restored = await collect(page);
    await page.screenshot({
      path: path.join(outDir, "04-pin-restored-after-loading.png"),
    });
    const pinnedRow = page.locator(
      `.roam-article [data-reference-pin-uid="${picked.uid}"]`,
    );
    const y = await pinnedRow.boundingBox();
    const otherRows = await page
      .locator(
        ".roam-article .roamjs-reference-pin-row:not(.roamjs-reference-pin-active)",
      )
      .evaluateAll((rows) =>
        rows
          .filter((el) => el.getClientRects().length)
          .map((el) => el.getBoundingClientRect().y),
      );
    assert(otherRows.every((otherY) => otherY >= y.y));
    assert(await row.isHidden(), "Lazy-loaded native duplicate must be hidden");
    const visibleCopies = await page
      .locator(`[data-block-uid="${picked.uid}"]`)
      .evaluateAll(
        (nodes) => nodes.filter((el) => el.getClientRects().length).length,
      );
    assert.equal(visibleCopies, 1, "Exactly one copy should be visible");
    const sourceTitle = await page.evaluate(
      (uid) =>
        window.roamAlphaAPI.data.pull("[:node/title]", [":block/uid", uid])[
          ":node/title"
        ],
      picked.sourceUid,
    );
    await page.evaluate(
      async ({ target, title }) =>
        window.roamAlphaAPI.ui.filters.setPageLinkedRefsFilters({
          page: { uid: target },
          filters: { removes: [title] },
        }),
      { target: fixture.target, title: sourceTitle },
    );
    await page.waitForFunction(
      (uid) => !document.querySelector(`[data-reference-pin-uid="${uid}"]`),
      picked.uid,
    );
    assert(
      await stored(page, fixture.target, picked.uid),
      "Filtering must not unpin",
    );
    await page.evaluate(
      async (target) =>
        window.roamAlphaAPI.ui.filters.setPageLinkedRefsFilters({
          page: { uid: target },
          filters: {},
        }),
      fixture.target,
    );
    await pinnedRow.waitFor();
    await page.evaluate(async (target) => {
      await window.roamAlphaAPI.ui.rightSidebar.addWindow({
        window: { type: "mentions", "block-uid": target },
      });
      await window.roamAlphaAPI.ui.rightSidebar.open();
    }, fixture.target);
    const sidebarPin = page.locator(
      `#right-sidebar [data-reference-pin-uid="${picked.uid}"], .roam-right-sidebar-content [data-reference-pin-uid="${picked.uid}"]`,
    );
    await sidebarPin.waitFor();
    await page.evaluate(
      async ({ target, title }) =>
        window.roamAlphaAPI.ui.filters.setSidebarWindowFilters({
          window: { type: "mentions", "block-uid": target },
          filters: { removes: [title] },
        }),
      { target: fixture.target, title: sourceTitle },
    );
    await sidebarPin.waitFor({ state: "detached" });
    await expectMainPin(page, picked.uid);
    await page.screenshot({
      path: path.join(outDir, "07-sidebar-filter-keeps-main-pin.png"),
    });
    await page.evaluate(async (target) => {
      await window.roamAlphaAPI.ui.filters.setSidebarWindowFilters({
        window: { type: "mentions", "block-uid": target },
        filters: {},
      });
    }, fixture.target);
    await sidebarPin.waitFor();
    await page.evaluate(async (target) => {
      await window.roamAlphaAPI.ui.rightSidebar.removeWindow({
        window: { type: "mentions", "block-uid": target },
      });
      await window.roamAlphaAPI.ui.rightSidebar.close();
    }, fixture.target);
    await pinnedRow
      .getByRole("button", { name: "Unpin linked reference", exact: true })
      .click();
    await pinnedRow.waitFor({ state: "detached" });
    await row.waitFor({ state: "visible" });
    assert(!(await stored(page, fixture.target, picked.uid)));
    await page.screenshot({
      path: path.join(outDir, "05-unpinned-native-row-restored.png"),
    });
    await row.hover();
    await row
      .getByRole("button", { name: "Pin linked reference", exact: true })
      .click();
    await pinnedRow.waitFor();
    await page
      .locator(".roam-article")
      .getByRole("heading", { name: /Pinned references/ })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(outDir, "06-final-immediate-pins.png"),
    });
    await waitStored(page, fixture.target, picked.uid, true);
    const report = {
      status: "completed",
      total: fixture.blocks.length,
      selected: { uid: picked.uid, ordinal: picked.ordinal },
      initialRendered: initial.rendered.length,
      initiallyAbsent: true,
      loadingBatches: batches,
      controlsAttachedAfterLoading: true,
      pinningAfterLoading: true,
      persisted: true,
      sourceOrderUnchanged: true,
      reopened: {
        rendered: reopened.rendered.length,
        selectedRendered: reopened.rendered.includes(picked.uid),
        selectedPinned: reopened.pinned.includes(picked.uid),
      },
      restoredBatches,
      pinRestoredAfterLoading: restored.pinned.includes(picked.uid),
      automaticTopPromotion: true,
      immediateAfterReload: true,
      duplicateHidden: true,
      visibleCopies: 1,
      filtersRespected: true,
      sidebarFiltersIndependent: true,
      unpinRestoredNativeRow: true,
      url: page.url(),
      pageErrors: result.pageErrors,
      consoleErrors: result.consoleErrors,
    };
    await fs.writeFile(
      path.join(outDir, "lazy-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log("RESULT " + JSON.stringify(report));
    completed = true;
    return report;
  },
  async cleanup({ page }) {
    if (!ownedPages.size) return;
    if (completed && process.env.KEEP_LAZY_PIN_FIXTURE === "1")
      return {
        retainedForManualTesting: true,
        pages: [...ownedPages],
        target: fixture.target,
      };
    await page.evaluate(
      async ({ pages, target, blocks }) => {
        const api = window.roamAlphaAPI;
        if (target && pages.includes(target)) {
          const normalize = (value) =>
            value && typeof value === "object"
              ? Object.fromEntries(
                  Object.entries(value).map(([key, child]) => [
                    key.replace(/^:+/, ""),
                    normalize(child),
                  ]),
                )
              : value;
          const records = api.data.fast.q(
            '[:find (pull ?c [:block/uid :block/props]) :where [?p :node/title "roam/js/pinned-blocks"] [?p :block/children ?c]]',
          );
          for (const [record] of records) {
            const pin = normalize(record[":block/props"])?.[
              "roamjs-pinned-blocks"
            ];
            if (
              pin?.type === "reference-pin" &&
              pin.version === 1 &&
              pin["target-uid"] === target &&
              blocks.includes(pin["block-uid"])
            )
              await api.data.block.delete({
                block: { uid: record[":block/uid"] },
              });
          }
        }
        for (const uid of pages) await api.data.page.delete({ page: { uid } });
      },
      {
        pages: [...ownedPages],
        target: fixture?.target,
        blocks: fixture?.blocks.map(({ uid }) => uid) || [],
      },
    );
    return { pagesRemoved: ownedPages.size };
  },
};
