import { expect, test, type Locator, type Page } from "@playwright/test";

const enabled = process.env.FVI_RUN_RECON_WIZARD === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const sourceAName = process.env.FVI_E2E_SOURCE_A_NAME ?? "FVI Validation Two-sided A";
const sourceBName = process.env.FVI_E2E_SOURCE_B_NAME ?? "FVI Validation Two-sided B";
const definitionName = process.env.FVI_E2E_RECON_NAME ?? "FVI Validation Grouped Matching 2026-09-04";

async function chooseOption(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("platform owner creates a runnable grouped two-sided reconciliation", async ({ page }) => {
  test.skip(!enabled || !tenantSlug, "Requires FVI_RUN_RECON_WIZARD=YES and the DEV validation tenant");

  await page.goto(`/${tenantSlug}/workspace?page=recons`, { waitUntil: "domcontentloaded" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (await finishTour.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)) {
    await finishTour.click();
    await expect(page.locator(".driver-overlay")).toBeHidden();
  }
  if (await page.getByText(definitionName, { exact: true }).first().isVisible().catch(() => false)) return;

  await page.getByRole("button", { name: "New reconciliation" }).click();
  const modeDialog = page.getByRole("dialog", { name: "New Reconciliation" });
  const twoSided = modeDialog.locator("div.rounded-xl").filter({ hasText: "Two-Sided Reconciliation" });
  await twoSided.getByRole("button", { name: "Select", exact: true }).click();

  const wizard = page.getByRole("dialog").filter({ hasText: "Two-Sided Reconciliation" });
  await expect(wizard).toBeVisible();
  for (const [sideLabel, sourceName] of [["Source A", sourceAName], ["Source B", sourceBName]] as const) {
    const sourceCard = wizard.locator("div.rounded-xl").filter({ hasText: sideLabel }).first();
    await sourceCard.getByRole("button", { name: "EXISTING DATA", exact: true }).click();
    await chooseOption(page, sourceCard.getByRole("combobox"), sourceName);
    await expect(sourceCard.getByText(/7 cols · \d+ rows/u)).toBeVisible({ timeout: 20_000 });
  }

  await wizard.getByText("Manually Configure", { exact: true }).first().click();
  await expect(wizard.getByText("Amount field", { exact: true })).toBeVisible();

  const mappingTable = wizard.locator("table").filter({ hasText: "Canonical" });
  for (const field of ["record_id", "group_id", "scenario", "value_date", "currency", "amount", "reference"]) {
    const row = mappingTable.getByRole("row").filter({ hasText: field });
    await chooseOption(page, row.getByRole("combobox").nth(1), field);
  }
  await mappingTable.getByRole("row").filter({ hasText: "group_id" }).getByRole("checkbox").check();

  const mappingControls = wizard.locator("div.grid.grid-cols-2").filter({ hasText: "Amount field" });
  await chooseOption(page, mappingControls.getByRole("combobox").nth(0), "amount");
  await chooseOption(page, mappingControls.getByRole("combobox").nth(1), "value_date");

  await wizard.getByRole("button", { name: "Continue" }).click();
  await expect(wizard.getByText("Review Results", { exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard.getByPlaceholder("e.g. Daily Custody vs Ledger").fill(definitionName);
  await wizard.getByRole("button", { name: "Save as draft" }).click();

  await expect(wizard).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(definitionName, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});
