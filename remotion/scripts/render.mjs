import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, openBrowser } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
const out = process.argv[3];
if (!id || !out) { console.error("usage: node render.mjs <compId> <outPath>"); process.exit(1); }

const bundled = await bundle({ entryPoint: path.resolve(__dirname, "../src/index.ts"), webpackOverride: (c) => c });
const browser = await openBrowser("chrome", {
  browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH ?? "/bin/chromium",
  chromiumOptions: { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] },
  chromeMode: "chrome-for-testing",
});
const composition = await selectComposition({ serveUrl: bundled, id, puppeteerInstance: browser });
await renderMedia({
  composition, serveUrl: bundled, codec: "h264",
  outputLocation: out, puppeteerInstance: browser,
  concurrency: 1,
  audioCodec: "aac",
  crf: 20,
});
await browser.close({ silent: false });
console.log("done:", out);
