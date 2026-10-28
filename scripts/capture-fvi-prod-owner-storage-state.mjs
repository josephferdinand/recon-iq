import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = (process.env.FVI_E2E_BASE_URL ?? "").replace(/\/+$/u, "");
const passwordFile = process.env.FVI_OWNER_PASSWORD_FILE ?? "";
const outputFile = path.resolve(process.env.FVI_OWNER_STORAGE_STATE ?? "");
const outputRoot = path.resolve("_e2e_run/owner-session");
const host = baseUrl ? new URL(baseUrl).hostname : "";
if (host !== "app.reconiq.example" && !host.endsWith(".fvi-app.pages.dev")) {
  throw new Error("Target must be a canonical or exact FVI PROD origin");
}
if (!path.isAbsolute(passwordFile) || path.basename(passwordFile) !== "FVI-PROD-Temporary-Password.md") {
  throw new Error("FVI_OWNER_PASSWORD_FILE must identify the protected PROD owner password file");
}
if (!outputFile.startsWith(`${outputRoot}${path.sep}`)) {
  throw new Error("Storage state must remain in the ignored owner-session evidence directory");
}

function field(markdown, name) {
  const prefix = `${name}: `;
  const line = markdown.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim().replace(/^`|`$/gu, "") ?? "";
}

const protectedText = await readFile(passwordFile, "utf8");
const email = field(protectedText, "Account");
const password = field(protectedText, "Temporary password");
if (!email || !password) throw new Error("Protected owner inputs are incomplete");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !/\/auth/u.test(url.pathname), { timeout: 30_000 });
  if (/\/mfa-challenge/u.test(new URL(page.url()).pathname)) {
    throw new Error("Existing owner identity requires an interactive MFA code");
  }
  await context.storageState({ path: outputFile });
  console.log(JSON.stringify({ ok: true, target_origin: new URL(baseUrl).origin, output_file: path.relative(process.cwd(), outputFile) }));
} finally {
  await browser.close();
}
