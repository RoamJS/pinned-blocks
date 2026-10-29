import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";

test.use({
  launchOptions: { executablePath: process.env.ROAM_BROWSER_EXECUTABLE_PATH },
});
const script = buildSync({
  stdin: {
    contents: `import {createOutlinePinControls, OUTLINE_PIN_STYLES} from './src/outlinePinControls';
      window.styles = OUTLINE_PIN_STYLES;
      window.controls = createOutlinePinControls({togglePin: async uid => {
        window.clicked = uid; window.clicks = (window.clicks || 0) + 1;
        if (window.hold) await new Promise(resolve => window.finish = resolve);
      }});`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
}).outputFiles[0].text;
const block = (uid: string): string =>
  `<div class="roam-block-container"><div class="rm-block-main"><span class="controls">•</span><div class="roam-block" id="block-input-${uid}">Block ${uid}</div></div></div>`;
const setup = async (page: Page): Promise<void> => {
  await page.setContent(
    `<style>.rm-block-main{margin-left:40px;display:flex;min-height:30px}</style>${block("block1234")}<div class="rm-reference-item">${block("other1234")}</div><div id="outside">Outside</div>`,
  );
  await page.addScriptTag({ content: script });
  await page.addStyleTag({ content: await page.evaluate("window.styles") });
};

test("outline pins reserve dark icons for pinned state and highlight button hover", async ({
  page,
}) => {
  await setup(page);
  await page.addStyleTag({
    path: "node_modules/@blueprintjs/core/lib/css/blueprint.css",
  });
  for (const dark of [false, true]) {
    await page.evaluate((enabled) => {
      document.body.classList.toggle("bp3-dark", enabled);
    }, dark);
    await page.evaluate(
      "window.controls.sync({enabled:true,pinnedUids:new Set()})",
    );
    const button = page.getByRole("button", { name: "Pin block", exact: true });
    const icon = button.locator(".bp3-icon");
    await page.locator(".rm-block-main").first().hover();
    await expect(icon).toHaveCSS("color", "rgb(184, 196, 206)");
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await button.hover();
    await expect(icon).toHaveCSS("color", "rgb(184, 196, 206)");
    await page.mouse.down();
    await expect(button).toHaveCSS(
      "background-color",
      "rgba(167, 182, 194, 0.15)",
    );
    await page.mouse.up();
    await page.evaluate(
      "window.controls.sync({enabled:true,pinnedUids:new Set(['block1234'])})",
    );
    await page.locator("#outside").hover();
    const pinned = page.getByRole("button", {
      name: "Unpin block",
      exact: true,
    });
    await expect(pinned.locator(".bp3-icon")).toHaveCSS(
      "color",
      "rgb(92, 112, 128)",
    );
    await expect(pinned).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(pinned).toHaveCSS("box-shadow", "none");
    await pinned.hover();
    await expect(pinned.locator(".bp3-icon")).toHaveCSS(
      "color",
      "rgb(92, 112, 128)",
    );
    await expect(pinned).toHaveCSS(
      "background-color",
      "rgba(167, 182, 194, 0.15)",
    );
  }
});

test("outline pins remain visible across the gap between the block and button", async ({
  page,
}) => {
  await setup(page);
  await page.addStyleTag({
    path: "node_modules/@blueprintjs/core/lib/css/blueprint.css",
  });
  await page.evaluate(
    "window.controls.sync({enabled:true,pinnedUids:new Set()})",
  );
  const host = page.locator(".rm-block-main").first();
  const button = host.getByRole("button");
  const rowBounds = (await host.boundingBox())!;
  const buttonBounds = (await button.boundingBox())!;
  const y = buttonBounds.y + buttonBounds.height / 2;
  const start = rowBounds.x + 4;
  const end = buttonBounds.x + buttonBounds.width / 2;
  await page.evaluate(({ x, y, height }) => {
    const guide = document.createElement("div");
    guide.className = "rm-multibar";
    Object.assign(guide.style, {
      position: "absolute",
      left: `${x - 6}px`,
      top: `${y}px`,
      width: "8px",
      height: `${height}px`,
      zIndex: "10",
    });
    guide.onclick = (): void => {
      guide.dataset.clicked = "true";
    };
    document.body.append(guide);
  }, rowBounds);
  for (const x of [
    ...Array.from({ length: Math.ceil(start - end) + 1 }, (_, i) => start - i),
    ...Array.from({ length: Math.ceil(start - end) + 1 }, (_, i) => end + i),
  ]) {
    await page.mouse.move(x, y);
    await expect(button).toHaveCSS("opacity", "1");
  }
  expect(await host.boundingBox()).toEqual(rowBounds);
  await page.mouse.click(rowBounds.x, y);
  await expect(page.locator(".rm-multibar")).toHaveAttribute(
    "data-clicked",
    "true",
  );
  await expect(button).toHaveCSS("opacity", "1");
  await button.click();
  await expect.poll(() => page.evaluate("window.clicked")).toBe("block1234");
  await page.mouse.move(rowBounds.x, y);
  await expect(host).toHaveAttribute("data-roamjs-pin-hover", "true");
  await page.evaluate("window.controls.cleanup()");
  await expect(page.locator("[data-roamjs-pin-hover]")).toHaveCount(0);
});

test("outline pin icons and hover backgrounds center on the first-line bullet even when text wraps", async ({
  page,
}) => {
  await setup(page);
  await page.addStyleTag({
    path: "node_modules/@blueprintjs/core/lib/css/blueprint.css",
  });
  await page
    .locator(".rm-block-main")
    .first()
    .locator(".controls")
    .evaluate((el) => {
      el.innerHTML = '<span class="rm-bullet__inner">•</span>';
    });
  await page.addStyleTag({
    content: `
    .rm-block-main { width: 240px; min-height: 28px; }
    .controls { display: flex; align-items: center; height: 28px; flex: 0 0 27px; }
    .rm-bullet__inner { height: 13px; line-height: 13px; }
    .roam-block { flex: 1; min-width: 0; line-height: 28px; }
    .bp3-button.bp3-small { min-height: 24px; height: 24px; }
  `,
  });
  await page.evaluate(
    "window.controls.sync({enabled:true,pinnedUids:new Set()})",
  );
  const host = page.locator(".rm-block-main").first();
  const button = host.getByRole("button");
  for (const text of [
    "One line",
    "A long block that wraps onto multiple lines while the pin stays beside its first line",
  ]) {
    await host.locator(".roam-block").evaluate((el, text) => {
      el.textContent = text;
    }, text);
    const bullet = (await host.locator(".rm-bullet__inner").boundingBox())!;
    for (const target of [host, button]) {
      await target.hover();
      for (const element of [button, button.locator(".bp3-icon")]) {
        const box = (await element.boundingBox())!;
        expect(box.y + box.height / 2).toBe(bullet.y + bullet.height / 2);
      }
    }
  }
});

test("disabled mode preserves the outline; enabled buttons reveal on hover and focus", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(
    "window.controls.sync({enabled:false,pinnedUids:new Set()})",
  );
  await expect(page.getByRole("button")).toHaveCount(0);
  await page.evaluate(
    "window.controls.sync({enabled:true,pinnedUids:new Set()})",
  );
  const button = page.getByRole("button", { name: "Pin block", exact: true });
  await expect(button).toHaveCount(1);
  await page.locator("#outside").hover();
  await expect(button).toHaveCSS("opacity", "0");
  await page.locator(".rm-block-main").first().hover();
  await expect(button).toHaveCSS("opacity", "1");
  await page.locator("#outside").hover();
  await button.focus();
  await expect(button).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate("window.clicked")).toBe("block1234");
  await page.evaluate(
    "window.controls.sync({enabled:true,pinnedUids:new Set(['block1234'])})",
  );
  await expect(
    page.getByRole("button", { name: "Unpin block", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("reused rows target their current UID and pending clicks are serialized", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(
    "window.controls.sync({enabled:true,pinnedUids:new Set()})",
  );
  await page
    .locator("#block-input-block1234")
    .evaluate((el) => (el.id = "block-input-newuid123"));
  await page.evaluate(
    "window.controls.sync({enabled:true,pinnedUids:new Set()}); window.hold=true",
  );
  await page.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button")).toBeDisabled();
  await expect.poll(() => page.evaluate("window.clicked")).toBe("newuid123");
  await page.evaluate("document.querySelector('button').click()");
  expect(await page.evaluate("window.clicks")).toBe(1);
  await page.evaluate(
    "window.controls.sync({enabled:false,pinnedUids:new Set()});window.finish()",
  );
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.locator(".roamjs-outline-pin-host")).toHaveCount(0);
});

test("cleanup unmounts controls and prevents an in-flight action restoring them", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(
    "window.hold=true;window.controls.sync({enabled:true,pinnedUids:new Set()})",
  );
  await page.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await page.evaluate(
    "window.controls.cleanup();window.finish();window.controls.sync({enabled:true,pinnedUids:new Set()})",
  );
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.locator(".roamjs-outline-pin-host")).toHaveCount(0);
});

test("sidebar controls remain inside the clipped outline", async ({ page }) => {
  await setup(page);
  await page
    .locator(".roam-block-container")
    .first()
    .evaluate((el) => {
      const sidebar = document.createElement("div");
      sidebar.id = "right-sidebar";
      sidebar.style.overflow = "hidden";
      el.before(sidebar);
      sidebar.append(el);
    });
  await page.evaluate(
    "window.controls.sync({enabled:true,pinnedUids:new Set(['block1234'])})",
  );
  const button = page.getByRole("button", { name: "Unpin block", exact: true });
  const host = await page.locator(".roamjs-outline-pin-host").boundingBox();
  const bounds = await button.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(host!.x);
  await button.click();
  expect(await page.evaluate("window.clicked")).toBe("block1234");
});
