import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_REFERENCE_DATA_BROWSER === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";

test("Reference Data exposes governed version controls", async ({ page }) => {
  test.skip(!enabled || !tenantSlug || !tenantId, "Requires authenticated PROD Assurance Lab state");
  await page.addInitScript((id) => {
    const key = "fvi.prefs.v1";
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    current.tourSeen = { ...(current.tourSeen ?? {}), [`workspace-${id}-v2`]: true, "ws.reference": true };
    localStorage.setItem(key, JSON.stringify(current));
  }, tenantId);
  await page.goto(`/${tenantSlug}/workspace?page=reference`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".driver-overlay")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Reference data", exact: true })).toBeVisible();
  await expect(page.getByText("Governed tenant data", { exact: true })).toBeVisible();
  const catalogue = page.getByRole("table").first();
  const existing = catalogue.getByRole("row").filter({ hasText: "fx_spot_rates" });
  const resolvedExisting = await existing.waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!resolvedExisting) {
    await expect(page.getByRole("heading", { name: "Start building your reference library" })).toBeVisible();
    await page.getByRole("button", { name: /Use FX rates template/u }).click();
    await expect(page.getByRole("heading", { name: "Create from template" })).toBeVisible();
    await page.getByRole("button", { name: "Create table" }).click();
    await expect(page.getByText(/Table created with draft version/u)).toBeVisible({ timeout: 30_000 });
  } else {
    await existing.click();
  }
  await expect(page.getByText("Version governance", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stage version (CSV)" }).click();
  await expect(page.getByRole("heading", { name: "Stage a governed version" })).toBeVisible();
  await expect(page.getByLabel("Effective from", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Effective to (optional)")).toBeVisible();
  await expect(page.getByLabel("Change note")).toBeVisible();
  await page.screenshot({ path: `${process.env.FVI_E2E_EVIDENCE_DIR}/reference-data-governance.png`, fullPage: true });
});
