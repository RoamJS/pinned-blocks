import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const skillRoot =
  process.env.ROAMJS_SKILLS_ROOT ||
  path.join(os.homedir(), ".agents", "skills", "roamjs");
const { openRoamSession, loadChromium } = await import(
  pathToFileURL(
    path.join(
      skillRoot,
      "roamjs-playwright-session",
      "scripts",
      "roam-session.mjs",
    ),
  )
);
const { runExtensionTest } = await import(
  pathToFileURL(
    path.join(skillRoot, "roamjs-load-extension", "scripts", "load-plugin.mjs"),
  )
);
const repoDir = process.cwd();
const outDir = path.resolve(
  process.argv[2] ||
    `local/linked-references-media/${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
try {
  await fs.access(path.join(outDir, "media-manifest.json"));
  throw new Error(
    "This output directory contains a completed capture. Choose a new output directory to preserve it.",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await fs.mkdir(outDir, { recursive: true });
const rawDir = path.join(outDir, "raw");
await fs.mkdir(rawDir, { recursive: true });
let captureStartedAt;
let captureEndedAt;
const frames = [];
const frameWrites = [];
const chromium = await loadChromium({
  cwd: repoDir,
  playwrightPackageRoot: process.env.PLAYWRIGHT_PACKAGE_ROOT,
});
const result = await runExtensionTest({
  repo: repoDir,
  out: outDir,
  testModule: path.join(repoDir, "e2e", "linked-references-demo.mjs"),
  envPath: process.env.ROAM_PLAYWRIGHT_ENV_PATH,
  profileDir: process.env.ROAM_PROFILE_DIR,
  sessionFactory: async (options) => {
    const session = await openRoamSession({
      ...options,
      chromium,
      viewport: { width: 1440, height: 900 },
    });
    const screencast = await session.context.newCDPSession(session.page);
    screencast.on("Page.screencastFrame", (event) => {
      const frame = {
        path: path.join(
          rawDir,
          `frame-${String(frames.length).padStart(5, "0")}.jpg`,
        ),
        timestamp: event.metadata.timestamp,
        receivedAt: performance.now(),
      };
      frames.push(frame);
      frameWrites.push(
        fs.writeFile(frame.path, Buffer.from(event.data, "base64")),
      );
      void screencast.send("Page.screencastFrameAck", {
        sessionId: event.sessionId,
      });
    });
    await session.page.exposeFunction("beginDemoCapture", async () => {
      captureStartedAt = performance.now();
      await screencast.send("Page.startScreencast", {
        format: "jpeg",
        quality: 92,
        maxWidth: 1440,
        maxHeight: 900,
        everyNthFrame: 1,
      });
      return 0;
    });
    await session.page.exposeFunction("endDemoCapture", async () => {
      captureEndedAt = performance.now();
      await screencast.send("Page.stopScreencast");
      await Promise.all(frameWrites);
      return (captureEndedAt - captureStartedAt) / 1000;
    });
    return session;
  },
});
if (!result.ok || !result.test?.value?.capture)
  throw new Error("The live demo did not complete; inspect last-run.json");
const timing = result.test.value.capture;
if (!frames.length) throw new Error("No live screencast frames were captured");
const rawPath = path.join(rawDir, "recording.ffconcat");
const concatLines = ["ffconcat version 1.0"];
for (let i = 0; i < frames.length; i++) {
  const duration =
    i + 1 < frames.length
      ? Math.max(0.001, frames[i + 1].timestamp - frames[i].timestamp)
      : Math.max(0.001, (captureEndedAt - frames[i].receivedAt) / 1000);
  concatLines.push(
    `file '${path.basename(frames[i].path)}'`,
    `duration ${duration}`,
  );
}
concatLines.push(`file '${path.basename(frames.at(-1).path)}'`);
await fs.writeFile(rawPath, concatLines.join("\n") + "\n");
const videoPath = path.join(outDir, "linked-reference-pins.mp4");
const conversion = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    rawPath,
    "-r",
    "25",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    videoPath,
  ],
  { stdio: "inherit" },
);
if (conversion.status !== 0) throw new Error("Video conversion failed");
const names = (await fs.readdir(outDir)).filter(
  (name) => name.endsWith(".png") && !name.startsWith("roamjs-load"),
);
const sha256 = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const manifest = {
  capturedAt: new Date().toISOString(),
  extensionSha256: await sha256(path.join(repoDir, "extension.js")),
  video: { path: videoPath, sha256: await sha256(videoPath), silent: true },
  images: await Promise.all(
    names.map(async (name) => ({
      path: path.join(outDir, name),
      sha256: await sha256(path.join(outDir, name)),
    })),
  ),
  assertions: result.test.value.assertions,
  sourceRecording: rawPath,
  captureTiming: timing,
  recordingMethod:
    "Chromium live screencast; original frame timestamps preserve interaction pacing",
  sourceFrames: frames.length,
  fixtureCleanup: result.cleanup,
  reviewStatus: "Awaiting requested reviewer",
};
await fs.writeFile(
  path.join(outDir, "media-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
