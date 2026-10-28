import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

test.use({ trace: "off", video: "off" });

const enabled = process.env.FVI_RUN_PROFILE_PASSWORD_MFA_LIVE === "YES";

function field(markdown: string, name: string) {
  const prefix = `- ${name}: `;
  const line = markdown.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim().replace(/^`|`$/gu, "") ?? "";
}

function secureFile(variable: string, expectedName: string) {
  const value = process.env[variable] ?? "";
  if (!path.isAbsolute(value) || path.basename(value) !== expectedName)
    throw new Error(`${variable} must identify ${expectedName}`);
  return value;
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/u, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP secret encoding");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string) {
  const counter = Math.floor(Date.now() / 30_000);
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(value).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

test("native MFA gates password login and browser password A-to-B-to-A", async ({ page, context }) => {
  test.setTimeout(240_000);
  test.skip(!enabled, "Requires the dedicated retained PROD QA identity and native factor");
  if (process.env.FVI_AUTH_DIAGNOSTICS === "YES") {
    page.on("response", (response) => {
      if (/\/auth\/v1\/|_serverFn/iu.test(response.url()))
        console.log(`[auth-diagnostic] ${response.status()} ${new URL(response.url()).pathname}`);
    });
    page.on("requestfailed", (request) => {
      if (/\/auth\/v1\/|_serverFn/iu.test(request.url()))
        console.log(`[auth-diagnostic] request failed ${new URL(request.url()).pathname}`);
    });
  }
  const credentialMarkdown = await readFile(
    secureFile("FVI_QA_CREDENTIAL_FILE", "FVI-Codex-QA-Assurance-Lab-PROD.md"),
    "utf8",
  );
  const mfaMarkdown = await readFile(
    secureFile("FVI_QA_MFA_VAULT_PATH", "FVI-Codex-QA-Native-MFA-PROD.md"),
    "utf8",
  );
  const email = field(credentialMarkdown, "Account");
  const original = field(credentialMarkdown, "Temporary password");
  const userId = field(credentialMarkdown, "User ID");
  const secret = field(mfaMarkdown, "TOTP secret");
  const serviceRole = (await readFile(
    secureFile("FVI_PROD_SERVICE_ROLE_KEY_FILE", "SUPABASE_PROD_SERVICE_ROLE_KEY"),
    "utf8",
  )).trim();
  if (!email || !original || !userId || !secret || !serviceRole)
    throw new Error("Protected QA inputs are incomplete");
  const alternate = `${randomBytes(24).toString("base64url")}!Aa9`;
  let expectedPassword = original;

  const admin = createClient("https://YOUR_PROJECT_REF.supabase.co", serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function clearBrowserSession() {
    await context.clearCookies();
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  async function login(password: string) {
    await clearBrowserSession();
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.locator('button[type="submit"]').click();
    try {
      await expect(page).toHaveURL(/\/mfa-challenge/u, { timeout: 30_000 });
    } catch (error) {
      const alert = await page.getByRole("alert").allTextContents();
      throw new Error(`Password login did not reach MFA challenge${alert.length ? `: ${alert.join(" | ")}` : ""}`, { cause: error });
    }
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/mfa-challenge\?redirect=%2Fprofile/u);
    const validCode = totp(secret);
    const invalidCode = `${validCode.slice(0, 5)}${validCode[5] === "9" ? "8" : "9"}`;
    await page.getByLabel("Six-digit code").fill(invalidCode);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByRole("heading", { name: "Verification failed" })).toBeVisible();
    await page.getByLabel("Six-digit code").fill(validCode);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).not.toHaveURL(/\/mfa-challenge/u, { timeout: 30_000 });
    await expect(page).not.toHaveURL(/\/auth/u);
  }

  async function changePassword(currentPassword: string, nextPassword: string) {
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Change password", exact: true })).toBeVisible();
    await page.getByLabel("Current password").fill(currentPassword);
    await page.getByLabel("New password", { exact: true }).fill(nextPassword);
    await page.getByLabel("Confirm new password").fill(nextPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByLabel("Authenticator code")).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp(secret));
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("heading", { name: "Password updated", exact: true })).toBeVisible({ timeout: 30_000 });
    expectedPassword = nextPassword;
  }

  let flowError: unknown = null;
  try {
    await login(original);
    await changePassword(original, alternate);
    await login(alternate);
    await changePassword(alternate, original);
    await login(original);
    expectedPassword = original;
  } catch (error) {
    flowError = error;
  }
  if (expectedPassword !== original) {
    const rollback = await admin.auth.admin.updateUserById(userId, { password: original });
    if (rollback.error && !flowError) flowError = new Error("QA password rollback failed");
  }
  if (flowError) throw flowError;
});
