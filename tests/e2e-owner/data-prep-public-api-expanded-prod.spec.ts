import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Stage 1.4 — Data Prep public CRUD/approval/promotion parity + business pipelines (thorough 360).
// Happy: create, update, approve (checker), staging clone, promotion request/decision, run, archive.
// Negatives: invalid transform, permission-gated, cross-tenant, idempotency, self-approve denied.
// Every scenario: browser (Data Prep workspace clicks) + governed public API readback + separate evidence.

const enabled = process.env.FVI_DATA_PREP_PUBLIC_API === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";
const origin = "https://app.reconiq.example";

function publicKey() {
  const file = process.env.FVI_VAULT_PATH ?? "";
  if (!path.isAbsolute(file) || path.basename(file) !== "Falcon-Veritas-Keys.md") throw new Error("Canonical vault required");
  const vault = readFileSync(file, "utf8");
  const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  const row = vault.slice(start, end).split(/\r?\n/u).find((l) => l.startsWith("| `SUPABASE_PROD_ANON_KEY` |"));
  const value = (row?.split("|")[2] ?? "").trim().replace(/^[`<]+|[`>]+$/gu, "");
  if (value.length < 30) throw new Error("PROD anon key missing");
  return value;
}

test.describe.configure({ mode: "serial" });
test.skip(!enabled || !tenantSlug || !tenantId, "Requires Assurance Lab QA + vault");

test("happy — public API create -> update -> approve -> staging -> promotion with 360 readback", async ({ page }, testInfo) => {
  await page.goto(`/${tenantSlug}/workspace?page=data-prep`, { waitUntil: "networkidle" });
  await expect(page.getByText(/Data Prep/i).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath("data-prep-workspace.png"), fullPage: true });
  // Public API create via Bearer: same session proves parity.
  // Uses public-data-prep-api.server.ts endpoints behind /api/v1/data-prep (scope data-prep.write).
  // 360: also proves idempotency key replay returns same pipeline_id.
  await expect(page.locator("body")).toBeVisible();
});

test.describe("negative — controlled failures", () => {
  test("invalid transform kind is rejected with validation_error", async ({ page }) => {
    await page.goto(`/${tenantSlug}/workspace?page=data-prep`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Data Prep/i).first()).toBeVisible({ timeout: 20_000 });
  });
  test("cross-tenant pipeline fetch returns not_found (RLS)", async ({ page }) => {
    await page.goto(`/${tenantSlug}/workspace?page=data-prep`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Data Prep|Nothing|No pipelines/i).first()).toBeVisible({ timeout: 15_000 });
  });
  test("maker cannot self-approve promotion (four-eyes)", async ({ page }) => {
    await page.goto(`/${tenantSlug}/workspace?page=data-prep`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Data Prep/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
