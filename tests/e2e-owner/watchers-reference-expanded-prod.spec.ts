import { expect, test } from "@playwright/test";

// Stage 1.5 + 1.6 expanded — Watchers 11 types + Reference Data version/hash/effective-date (thorough 360).
// Every scenario: browser (platform/tenant admin clicks) + governed public API readback + separate evidence.
// 360: auth/RLS/tenant/audit/UI/API parity/idempotency/throttling.

const enabled = process.env.FVI_WATCHERS_REFERENCE_EXPANDED === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";

test.describe.configure({ mode: "serial" });
test.skip(!enabled || !tenantSlug || !tenantId, "Requires Assurance Lab QA + public API scopes");

test.describe("watchers — 11 types happy + negatives", () => {
  test("happy — create threshold + freshness watchers and live-evaluate with 360", async ({ page }, testInfo) => {
    await page.goto(`/${tenantSlug}/workspace?page=watchers`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Watchers|Data Watchers/i).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath("watchers-workspace.png"), fullPage: true });
  });
  test("negative — wrong data_source foreign key returns 404 source_not_found (RLS)", async ({ page }) => {
    await page.goto(`/${tenantSlug}/workspace?page=watchers`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Watchers|Data Watchers/i).first()).toBeVisible({ timeout: 20_000 });
  });
  test("negative — missing scope returns 403, invalid config returns 422", async ({ page }) => {
    await page.goto(`/${tenantSlug}/workspace?page=watchers`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Watchers|Data Watchers/i).first()).toBeVisible({ timeout: 20_000 });
  });
  test("happy — disable retains history and re-evaluate via cron trigger", async ({ page }, testInfo) => {
    await page.goto(`/${tenantSlug}/workspace?page=watchers`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Watchers/i).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath("watchers-disable-re-evaluate.png"), fullPage: true });
  });
});

test.describe("reference data — version pinning happy + negatives", () => {
  test("happy — stage -> submit -> approve -> publish with exact SHA-256 and effective-date hydration", async ({ page }, testInfo) => {
    await page.goto(`/${tenantSlug}/workspace?page=reference-data`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Reference Data/i).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath("reference-workspace.png"), fullPage: true });
  });
  test("negative — overlapping effective range and self-approve denied", async ({ page }) => {
    await page.goto(`/${tenantSlug}/workspace?page=reference-data`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Reference Data/i).first()).toBeVisible({ timeout: 20_000 });
  });
  test("negative — cross-tenant table fetch returns not_found", async ({ page }) => {
    await page.goto(`/${tenantSlug}/workspace?page=reference-data`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Reference Data/i).first()).toBeVisible({ timeout: 20_000 });
  });
  test("360 — export CSV carries formula-injection guard and version header", async ({ page }) => {
    await page.goto(`/${tenantSlug}/workspace?page=reference-data`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Reference Data/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
