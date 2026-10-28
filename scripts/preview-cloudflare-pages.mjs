import { access, copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const previewEnvironment = process.env.FVI_PREVIEW_ENV ?? "prod";
if (previewEnvironment !== "prod" && previewEnvironment !== "dev") {
  throw new Error("FVI_PREVIEW_ENV must be prod or dev");
}
const configPath = path.join(projectRoot,
  previewEnvironment === "dev" ? "wrangler.staging.jsonc" : "wrangler.jsonc");
const wranglerEntry = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

for (const requiredPath of [distDir, configPath, wranglerEntry]) {
  try {
    await access(requiredPath);
  } catch {
    console.error(`pages-preview FAIL: required path is missing: ${requiredPath}`);
    process.exit(1);
  }
}

// Keep preview state under one stable Temp directory. This isolates it from
// Nitro's root `.wrangler/deploy/config.json` redirect while avoiding a new
// orphaned directory on every Windows terminal interruption.
const isolatedRoot = path.join(os.tmpdir(), `fvi-pages-preview-${previewEnvironment}`);
await mkdir(isolatedRoot, { recursive: true });
await copyFile(configPath, path.join(isolatedRoot, "wrangler.jsonc"));

const args = [
  wranglerEntry,
  "pages",
  "dev",
  distDir,
  "--cwd",
  isolatedRoot,
];

for (const name of [".env", ".env.local"]) {
  const candidate = path.join(projectRoot, name);
  try {
    await access(candidate);
    args.push("--env-file", candidate);
  } catch {
    // Optional local runtime values are not required for public-route preview.
  }
}

args.push(...process.argv.slice(2));

const child = spawn(process.execPath, args, {
  cwd: isolatedRoot,
  stdio: "inherit",
  windowsHide: true,
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", forwardSignal);
process.on("SIGTERM", forwardSignal);

const exitCode = await new Promise((resolve) => {
  child.once("error", (error) => {
    console.error(`pages-preview FAIL: ${error.message}`);
    resolve(1);
  });
  child.once("exit", (code) => resolve(code ?? 1));
});

process.off("SIGINT", forwardSignal);
process.off("SIGTERM", forwardSignal);
process.exit(exitCode);
