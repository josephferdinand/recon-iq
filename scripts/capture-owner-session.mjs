import { spawnSync } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const DEV_ORIGIN = "https://dev.app.reconiq.example";
const DEFAULT_OUTPUT = "_e2e_run/owner-session/storage-state.json";

function readFlag(argv, name) {
  const prefix = `${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

export function resolveOwnerSessionCaptureOptions({
  argv = process.argv.slice(2),
  environment = process.env,
  root = process.cwd(),
} = {}) {
  const requestedBase =
    readFlag(argv, "--base-url") ??
    environment.FVI_E2E_BASE_URL ??
    environment.FVI_OWNER_BASE_URL ??
    DEV_ORIGIN;
  const baseUrl = new URL(requestedBase);
  if (baseUrl.origin !== DEV_ORIGIN || baseUrl.username || baseUrl.password) {
    throw new Error(`Owner session capture is restricted to ${DEV_ORIGIN}`);
  }

  const requestedOutput =
    readFlag(argv, "--output") ?? environment.FVI_OWNER_STORAGE_STATE ?? DEFAULT_OUTPUT;
  const outputPath = path.resolve(root, requestedOutput);
  const evidenceRoot = path.resolve(root, "_e2e_run");
  if (!isInside(evidenceRoot, outputPath) || path.extname(outputPath).toLowerCase() !== ".json") {
    throw new Error(
      "Owner storage state must be a JSON file inside the ignored _e2e_run directory",
    );
  }

  const timeoutSeconds = Number(readFlag(argv, "--timeout-seconds") ?? "600");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 60 || timeoutSeconds > 1800) {
    throw new Error("--timeout-seconds must be an integer between 60 and 1800");
  }

  return {
    authUrl: new URL("/auth", DEV_ORIGIN).href,
    baseUrl: DEV_ORIGIN,
    outputPath,
    timeoutMs: timeoutSeconds * 1000,
  };
}

export function assertOwnerStorageStateIgnored(outputPath, root = process.cwd()) {
  const relativeOutput = path.relative(root, outputPath);
  const result = spawnSync("git", ["check-ignore", "-q", "--", relativeOutput], {
    cwd: root,
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Refusing to capture owner session: ${relativeOutput} is not git-ignored ` +
        "(git check-ignore did not confirm it). Add the path to .gitignore and retry; " +
        "no storage state was written.",
    );
  }
}

export async function captureOwnerSession(options = resolveOwnerSessionCaptureOptions()) {
  assertOwnerStorageStateIgnored(options.outputPath);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: false });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log(
      "A private DEV sign-in window is open. Complete sign-in there; credentials are not read or logged.",
    );
    await page.goto(options.authUrl, { waitUntil: "domcontentloaded" });
    await page.waitForURL(
      (candidate) =>
        candidate.origin === options.baseUrl && !candidate.pathname.startsWith("/auth"),
      { timeout: options.timeoutMs, waitUntil: "domcontentloaded" },
    );
    await context.storageState({ path: options.outputPath });
    await chmod(options.outputPath, 0o600).catch(() => undefined);
    console.log(
      `PASS owner_storage_state_captured path=${path.relative(process.cwd(), options.outputPath)}`,
    );
    console.log("Delete this short-lived ignored file after the owner test session.");
  } finally {
    await browser.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await captureOwnerSession();
}
