import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_REFERENCE_DATA_RECON === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";
const reconName = "Assurance | PROD | Governed Currency Alias Recon | 2026-09-08";

test("browser run consumes the published Reference Data version", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!enabled || !tenantSlug || !tenantId, "Requires retained managed Reference Data reconciliation");
  await page.addInitScript((id) => {
    const key = "fvi.prefs.v1";
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    current.tourSeen = { ...(current.tourSeen ?? {}), "ws.recons": true, [`workspace-${id}-v2`]: true };
    current.tourProgress = { ...(current.tourProgress ?? {}) };
    delete current.tourProgress["ws.recons"];
    localStorage.setItem(key, JSON.stringify(current));
  }, tenantId);
  await page.goto(`/${tenantSlug}/workspace?page=recons`, { waitUntil: "domcontentloaded" });
  const card = page.locator("div.rounded-lg.border").filter({ hasText: reconName }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText(/Run complete · 4 matched, 0 exceptions/u)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(reconName, { exact: true }).last()).toBeVisible();
  await page.screenshot({
    path: `${process.env.FVI_E2E_EVIDENCE_DIR}/reference-data-reconciliation-complete.png`,
    fullPage: true,
  });
});
