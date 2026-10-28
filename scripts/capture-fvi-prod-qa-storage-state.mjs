import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = (process.env.FVI_E2E_BASE_URL ?? "").replace(/\/+$/u, "");
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const credentialFile = process.env.FVI_QA_CREDENTIAL_FILE ?? "";
const mfaFile = process.env.FVI_QA_MFA_VAULT_PATH ?? "";
const identity = process.env.FVI_QA_IDENTITY ?? "maker";
const checkerVault = process.env.FVI_VAULT_PATH ?? "";
const outputFile = path.resolve(process.env.FVI_OWNER_STORAGE_STATE ?? "");
const outputRoot = path.resolve("_e2e_run/owner-session");

if (!baseUrl || !tenantSlug) throw new Error("Set FVI_E2E_BASE_URL and FVI_E2E_TENANT_SLUG");
const host = new URL(baseUrl).hostname;
if (host !== "app.reconiq.example" && !host.endsWith(".fvi-app.pages.dev")) {
  throw new Error("Target must be a canonical or exact FVI PROD origin");
}
if (!["maker", "checker"].includes(identity)) throw new Error("Unknown QA identity");
if (
  identity === "maker" &&
  (!path.isAbsolute(credentialFile) ||
    path.basename(credentialFile) !== "FVI-Codex-QA-Assurance-Lab-PROD.md")
) {
  throw new Error("FVI_QA_CREDENTIAL_FILE must identify the protected PROD QA credential file");
}
if (
  identity === "maker" &&
  (!path.isAbsolute(mfaFile) || path.basename(mfaFile) !== "FVI-Codex-QA-Native-MFA-PROD.md")
) {
  throw new Error("FVI_QA_MFA_VAULT_PATH must identify the protected PROD QA MFA file");
}
if (!outputFile.startsWith(`${outputRoot}${path.sep}`)) {
  throw new Error("Storage state must remain in the ignored owner-session evidence directory");
}

function field(markdown, name) {
  const prefix = `- ${name}: `;
  const line = markdown.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim().replace(/^`|`$/gu, "") ?? "";
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/u, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP secret encoding");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(value).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

let email, password, secret;
if (identity === "checker") {
  if (
    !path.isAbsolute(checkerVault) ||
    path.basename(checkerVault) !== "Falcon-Veritas-Keys.md" ||
    baseUrl !== "https://app.reconiq.example" ||
    tenantSlug !== "reconiq-assurance-lab-prod"
  ) {
    throw new Error("Checker capture requires the canonical vault and PROD Assurance tenant");
  }
  const vault = await readFile(checkerVault, "utf8");
  const blocks = [
    ...vault.matchAll(
      /<!-- FVI_QA_CHECKER_PROD_SNAPSHOT_BEGIN ([0-9a-f-]{36}) -->([\s\S]*?)<!-- FVI_QA_CHECKER_PROD_SNAPSHOT_END \1 -->/gu,
    ),
  ];
  let saved = null;
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[2].trim());
      if (parsed.snapshot_id === block[1]) saved = parsed;
    } catch {
      /* Only complete recoverable snapshots may be used. */
    }
  }
  if (
    saved?.schema_version !== 1 ||
    saved.phase !== "ready" ||
    saved.target?.project_ref !== "YOUR_PROJECT_REF" ||
    saved.target?.tenant_id !== "aa5ed999-69eb-41a0-a9c6-fbb439efcffb" ||
    saved.target?.email !== "codex.qa+assurance-checker@reconiq.example" ||
    saved.user_id !== "2849df7a-f63c-4b3b-9b5f-1c01c3ae8a43"
  ) {
    throw new Error("Checker recovery snapshot is not ready or has a different identity");
  }
  email = saved.target.email;
  password = saved.initial_password;
  secret = saved.totp_secret;
} else {
  const credential = await readFile(credentialFile, "utf8");
  const mfa = await readFile(mfaFile, "utf8");
  email = field(credential, "Account");
  password = field(credential, "Temporary password");
  secret = field(mfa, "TOTP secret");
}
if (!email || !password || !secret) throw new Error("Protected QA inputs are incomplete");

const browser = await chromium.launch({ headless: true });
let stage = "open_auth";
let currentRoute = "/auth";
const authStatuses = [];
const dataApiFailures = [];
try {
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) currentRoute = new URL(frame.url()).pathname;
  });
  page.on("response", async (response) => {
    if (/\/auth\/v1\//u.test(response.url())) {
      authStatuses.push({ status: response.status(), path: new URL(response.url()).pathname });
    }
    if (/\/rest\/v1\//u.test(response.url()) && response.status() >= 400) {
      const payload = await response.json().catch(() => ({}));
      dataApiFailures.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
        code: /^PGRST\d{3}$/u.test(payload.code ?? "") ? payload.code : "other",
      });
    }
  });
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  stage = "password_login";
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  try {
    await page.waitForURL(/\/mfa-challenge/u, { timeout: 30_000 });
  } catch (error) {
    const alerts = await page.getByRole("alert").allTextContents();
    throw new Error(
      `QA login did not reach MFA; route=${new URL(page.url()).pathname}; auth=${JSON.stringify(authStatuses)}; alerts=${alerts.join(" | ") || "none"}`,
      { cause: error },
    );
  }
  await page.getByLabel("Six-digit code").fill(totp(secret));
  stage = "mfa_verification";
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => !/\/auth|\/mfa-challenge/u.test(url.pathname), {
    timeout: 30_000,
  });
  // Retain the successfully established MFA session even if a later provider
  // Data API fault blocks the workspace, so diagnostics can reuse this JWT.
  await context.storageState({ path: outputFile });
  stage = "tenant_workspace";
  await page.goto(`/${tenantSlug}/workspace?page=reference`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Reference data", exact: true })
    .waitFor({ timeout: 30_000 });
  await context.storageState({ path: outputFile });
  console.log(
    JSON.stringify({
      ok: true,
      target_origin: new URL(baseUrl).origin,
      tenant_slug: tenantSlug,
      output_file: path.relative(process.cwd(), outputFile),
    }),
  );
} catch (error) {
  // Playwright exception call logs can contain fill arguments. Emit only
  // structural diagnostics, never the raw exception or credential values.
  console.error(
    JSON.stringify({
      ok: false,
      stage,
      route: currentRoute,
      error_name: error instanceof Error ? error.name : "Error",
      auth: authStatuses,
      data_api_failures: dataApiFailures.slice(0, 10),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
