import assert from "node:assert/strict";
import path from "node:path";
let fixture;
const ownedPages = new Set();
let previousMainUid;
const pinButton = (page, uid) =>
  page
    .locator(`.rm-reference-item:has([data-block-uid="${uid}"])`)
    .locator("..")
    .getByRole("button", { name: /^(Unpin|Pin) linked reference$/ });
const pause = (page) => page.waitForTimeout(2200);
const waitForTarget = (page, targetUid) =>
  page.waitForFunction(
    (target) =>
      document.querySelector(`.roam-block[id*="-mentions-page-${target}-"]`),
    targetUid,
  );
export default {
  ready: async ({ page }) =>
    page.evaluate(() =>
      Boolean(document.getElementById("roamjs-pinned-blocks-style")),
    ),
  async run({ page, outDir }) {
    await page.keyboard.press("Escape");
    previousMainUid = await page.evaluate(() =>
      window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(),
    );
    await page.exposeFunction("registerReferenceDemoPage", (uid) =>
      ownedPages.add(uid),
    );
    fixture = await page.evaluate(async () => {
      const api = window.roamAlphaAPI;
      const uids = Array.from({ length: 5 }, () => api.util.generateUID());
      const titles = [
        "Pinned Blocks demo: Research priorities",
        "Pinned Blocks demo: Team agenda",
        "Pinned Blocks demo: Team discussion",
        "Pinned Blocks demo: Reading notes",
        "Pinned Blocks demo: Project ideas",
      ];
      const dailyUid = "09-19-2099";
      const dailyTitle = api.util.dateToPageTitle(new Date(2099, 8, 19));
      if (api.data.pull("[:block/uid]", [":block/uid", dailyUid]))
        throw new Error("Daily demo page already exists");
      for (const title of [...titles, dailyTitle]) {
        if (
          api.data.fast.q(
            "[:find ?p . :in $ ?title :where [?p :node/title ?title]]",
            title,
          )
        )
          throw new Error(`Demo page collision: ${title}`);
      }
      for (let i = 0; i < titles.length; i++) {
        await api.data.page.create({
          page: { uid: uids[i], title: titles[i] },
        });
        await window.registerReferenceDemoPage(uids[i]);
      }
      await api.data.page.create({
        page: { uid: dailyUid, title: dailyTitle },
      });
      await window.registerReferenceDemoPage(dailyUid);
      const blocks = [];
      const texts = [
        "Agree on the next research question",
        "Collect feedback before Friday",
        "Use the evidence checklist for every source",
        "Check the assumptions behind the key claim",
        "Prototype a better linked-reference workflow",
        "Keep the most useful references easy to find",
      ];
      for (let i = 0; i < texts.length; i++) {
        const uid = api.util.generateUID();
        blocks.push(uid);
        await api.data.block.create({
          location: { "parent-uid": uids[2 + Math.floor(i / 2)], order: i % 2 },
          block: {
            uid,
            string: `${texts[i]} [[${titles[0]}]] [[${titles[1]}]] [[${dailyTitle}]]`,
          },
        });
      }
      await api.ui.leftSidebar.close();
      await api.ui.mainWindow.openPage({ page: { uid: uids[0] } });
      return {
        target: uids[0],
        other: uids[1],
        sources: uids.slice(2),
        pages: [...uids, dailyUid],
        dailyUid,
        blocks,
      };
    });
    const first = fixture.blocks[0],
      second = fixture.blocks[2];
    await pinButton(page, first).waitFor();
    await waitForTarget(page, fixture.target);
    const snapshotOrder = () =>
      page.evaluate(
        ({ sources }) =>
          sources.map((uid) =>
            window.roamAlphaAPI.data.pull(
              "[{:block/children [:block/uid :block/order]}]",
              [":block/uid", uid],
            ),
          ),
        fixture,
      );
    const originalOrder = await snapshotOrder();
    const originalBox = await page
      .locator(`.rm-reference-item:has([data-block-uid="${first}"])`)
      .boundingBox();
    await page.addStyleTag({
      content: `.roamjs-demo-cursor{position:fixed;z-index:2147483647;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:17px solid #202b33;transform:rotate(-30deg);transform-origin:0 0;filter:drop-shadow(0 0 1px white);pointer-events:none}.roamjs-demo-cursor-click::after{content:"";position:absolute;left:-16px;top:-4px;width:26px;height:26px;border:2px solid #106ba3;border-radius:50%;animation:click-ring .45s ease-out forwards}@keyframes click-ring{from{opacity:1;scale:.5}to{opacity:0;scale:1.5}}`,
    });
    await page.evaluate(() => {
      const cursor = document.createElement("div");
      cursor.className = "roamjs-demo-cursor";
      document.body.appendChild(cursor);
      document.addEventListener("pointermove", (event) => {
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY}px`;
      });
      document.addEventListener("pointerdown", () => {
        cursor.classList.remove("roamjs-demo-cursor-click");
        void cursor.offsetWidth;
        cursor.classList.add("roamjs-demo-cursor-click");
      });
    });
    await page.mouse.move(1150, 160);
    const start = await page.evaluate(() => window.beginDemoCapture());
    await page.screenshot({ path: path.join(outDir, "01-before-pinning.png") });
    await pause(page);
    await pinButton(page, first).hover();
    await page.waitForTimeout(900);
    await pinButton(page, first).click();
    await page.waitForFunction(
      (uid) =>
        document.querySelector(
          `.roamjs-reference-pin-active [data-block-uid="${uid}"]`,
        ),
      first,
    );
    const pinnedBox = await page
      .locator(`.rm-reference-item:has([data-block-uid="${first}"])`)
      .boundingBox();
    assert(
      Math.abs(pinnedBox.width - originalBox.width) < 1,
      `Row width changed: ${JSON.stringify({ originalBox, pinnedBox })}`,
    );
    assert(
      Math.abs(pinnedBox.x - originalBox.x) < 1,
      `Row alignment changed: ${JSON.stringify({ originalBox, pinnedBox })}`,
    );
    await page.mouse.move(1150, 160);
    await pause(page);
    await page.screenshot({ path: path.join(outDir, "02-one-pinned.png") });
    await pinButton(page, second).hover();
    await page.waitForTimeout(900);
    await pinButton(page, second).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".roamjs-reference-pin-active").length === 2,
    );
    await page.mouse.move(1150, 160);
    const rows = await page
      .locator(".roamjs-reference-pin-row")
      .evaluateAll((rows) =>
        rows.map((row) => ({
          pinned: row.classList.contains("roamjs-reference-pin-active"),
          y: row.getBoundingClientRect().y,
        })),
      );
    assert(
      Math.max(...rows.filter((row) => row.pinned).map((row) => row.y)) <
        Math.min(...rows.filter((row) => !row.pinned).map((row) => row.y)),
    );
    await pause(page);
    await page.screenshot({ path: path.join(outDir, "03-multiple-pins.png") });
    await page.evaluate(
      ({ other }) =>
        window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: other } }),
      fixture,
    );
    await waitForTarget(page, fixture.other);
    await page.waitForFunction(
      () => !document.querySelector(".roamjs-reference-pin-active"),
    );
    await pause(page);
    await page.screenshot({
      path: path.join(outDir, "04-independent-page.png"),
    });
    await page.evaluate(
      ({ target }) =>
        window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: target } }),
      fixture,
    );
    await waitForTarget(page, fixture.target);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".roamjs-reference-pin-active").length === 2,
    );
    await pause(page);
    await pinButton(page, first).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".roamjs-reference-pin-active").length === 1,
    );
    await page.mouse.move(1150, 160);
    await pause(page);
    await page.screenshot({ path: path.join(outDir, "05-after-unpin.png") });
    assert.deepEqual(await snapshotOrder(), originalOrder);
    await page.waitForTimeout(3500);
    await page.evaluate(
      ({ dailyUid }) =>
        window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: dailyUid } }),
      fixture,
    );
    await waitForTarget(page, fixture.dailyUid);
    await pinButton(page, first).waitFor();
    await pinButton(page, first).hover();
    await page.waitForTimeout(900);
    await pinButton(page, first).click();
    await page.waitForFunction(
      (uid) =>
        document.querySelector(
          `.roamjs-reference-pin-active [data-block-uid="${uid}"]`,
        ),
      first,
    );
    await page.mouse.move(1150, 160);
    await pause(page);
    await page.screenshot({
      path: path.join(outDir, "07-daily-note-pins.png"),
    });
    const end = await page.evaluate(() => window.endDemoCapture());
    await page.evaluate(
      ({ target }) =>
        window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid: target } }),
      fixture,
    );
    await waitForTarget(page, fixture.target);
    await page.setViewportSize({ width: 900, height: 850 });
    await page.screenshot({ path: path.join(outDir, "06-narrow-layout.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    return {
      capture: { start, end },
      assertions: {
        pin: "passed",
        multiplePins: "passed",
        visualOrder: "passed",
        pageIsolation: "passed",
        unpin: "passed",
        sourceOrder: "unchanged",
        rowWidth: "unchanged",
        rowAlignment: "unchanged",
        dailyNotePins: "passed",
      },
    };
  },
  async cleanup({ page }) {
    if (!ownedPages.size) return;
    await page.evaluate(
      async ({ pages, previousMainUid }) => {
        const api = window.roamAlphaAPI;
        const records = api.data.fast.q(
          '[:find (pull ?c [:block/uid :block/props]) :where [?p :node/title "roam/js/pinned-blocks"] [?p :block/children ?c]]',
        );
        for (const [record] of records) {
          const props = record[":block/props"];
          const pin =
            props?.[":roamjs-pinned-blocks"] || props?.["roamjs-pinned-blocks"];
          if (pages.includes(pin?.[":target-uid"] || pin?.["target-uid"]))
            await api.data.block.delete({
              block: { uid: record[":block/uid"] },
            });
        }
        for (const uid of pages) await api.data.page.delete({ page: { uid } });
        if (
          previousMainUid &&
          api.data.pull("[:block/uid]", [":block/uid", previousMainUid])
        ) {
          await api.ui.mainWindow.openPage({ page: { uid: previousMainUid } });
        } else {
          await api.ui.mainWindow.openDailyNotes();
        }
      },
      { pages: [...ownedPages], previousMainUid },
    );
    return { fixtureRemoved: true };
  },
};
