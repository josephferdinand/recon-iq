import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_REFERENCE_DATA_RULE_EDITOR === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";

test("Reconciliation editor configures a governed Reference Data rule", async ({ page }) => {
  test.skip(!enabled || !tenantSlug || !tenantId, "Requires authenticated PROD Assurance Lab state");
  await page.addInitScript((id) => {
    const key = "fvi.prefs.v1";
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    current.tourSeen = { ...(current.tourSeen ?? {}), [`workspace-${id}-v2`]: true, "ws.recons": true };
    current.tourProgress = { ...(current.tourProgress ?? {}) };
    delete current.tourProgress["ws.recons"];
    localStorage.setItem(key, JSON.stringify(current));
  }, tenantId);
  await page.goto(`/${tenantSlug}/workspace?page=recons`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".driver-overlay")).toBeHidden();
  await page.getByRole("button", { name: "Classic editor" }).click();
  await expect(page.getByRole("heading", { name: "New recon" })).toBeVisible();
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByRole("combobox", { name: "Rule 1 type" }).click();
  await page.getByRole("option", { name: "Reference lookup" }).click();
  await page.getByRole("combobox", { name: "Rule 1 governed reference table" }).click();
  await page.getByRole("option", { name: "fx_spot_rates" }).click();
  await page.getByRole("combobox", { name: "Rule 1 reference return column" }).click();
  await page.getByRole("option", { name: "mid_rate" }).click();
  await expect(page.getByRole("textbox", { name: "Rule 1 reference effective as of" })).toBeVisible();
  await expect(page.getByText(/effective published version and SHA-256 are resolved at run time/u)).toBeVisible();
  await expect(page.getByText(/Missing mappings fail closed/u)).toBeVisible();
});
