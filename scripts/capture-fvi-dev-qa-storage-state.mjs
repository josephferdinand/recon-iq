import { chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const DEV_ORIGIN = "https://dev.app.reconiq.example";
const credentialFile = process.env.FVI_QA_CREDENTIAL_FILE ?? "";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const outputFile = path.resolve(process.env.FVI_OWNER_STORAGE_STATE ?? "");
const outputRoot = path.resolve("_e2e_run/owner-session");

const allowedCredentialFiles = new Set([
  "FVI-Codex-QA-Assurance-Lab-DEV.md",
  "FVI-Codex-Environment-Checker-DEV.md",
  "FVI-QA-Access-DEV-maker-20260925.cred",
]);
if (
  !path.isAbsolute(credentialFile) ||
  !allowedCredentialFiles.has(path.basename(credentialFile))
) {
  throw new Error("FVI_QA_CREDENTIAL_FILE must identify the protected DEV QA credential file");
}
if (tenantSlug !== "reconiq-assurance-lab-development") {
  throw new Error("FVI_E2E_TENANT_SLUG must identify the governed DEV assurance tenant");
}
if (!outputFile.startsWith(`${outputRoot}${path.sep}`)) {
  throw new Error("Storage state must remain in the ignored owner-session evidence directory");
}

function field(markdown, name) {
  const prefixes = [`- ${name}: `, `${name}: `];
  const line = markdown.split(/\r?\n/u).find((candidate) =>
    prefixes.some((prefix) => candidate.startsWith(prefix)),
  );
  const prefix = prefixes.find((candidate) => line?.startsWith(candidate));
  return line && prefix ? line.slice(prefix.length).trim().replace(/^`|`$/gu, "") : "";
}

const credential = await readFile(credentialFile, "utf8");
const email = field(credential, "Account");
const password = field(credential, "Temporary password");
if (!email || !password) throw new Error("Protected DEV QA inputs are incomplete");

await mkdir(path.dirname(outputFile), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ baseURL: DEV_ORIGIN });
  const page = await context.newPage();
  const authStatuses = [];
  page.on("response", (response) => {
    if (/\/auth\/v1\//u.test(response.url())) {
      authStatuses.push({ status: response.status(), path: new URL(response.url()).pathname });
    }
  });
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  try {
    await page.waitForURL((url) => url.origin === DEV_ORIGIN && !url.pathname.startsWith("/auth"), {
      timeout: 30_000,
    });
  } catch (error) {
    const alerts = await page.getByRole("alert").allTextContents();
    throw new Error(
      `DEV QA login did not leave auth; route=${new URL(page.url()).pathname}; auth=${JSON.stringify(authStatuses)}; alerts=${alerts.join(" | ") || "none"}`,
      { cause: error },
    );
  }
  await page.goto(`/${tenantSlug}/workspace`, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.startsWith("/auth")) {
    throw new Error("DEV QA session was not accepted by the application");
  }
  await context.storageState({ path: outputFile });
  await chmod(outputFile, 0o600).catch(() => undefined);
  console.log(
    JSON.stringify({
      ok: true,
      target_origin: DEV_ORIGIN,
      tenant_slug: tenantSlug,
      output_file: path.relative(process.cwd(), outputFile),
    }),
  );
} finally {
  await browser.close();
}
