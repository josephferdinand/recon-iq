import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RECON_PASTE_CAPTURE === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";
const definitionName = "Assurance | PROD | Single Side pasted ledger | 2026-09-06";

test("pasted data is snapshotted and remains runnable after the wizard closes", async ({
  page,
}, testInfo) => {
  test.skip(!enabled || !slug, "Requires retained PROD owner state");
  await page.goto(`/${slug}/workspace?page=recons`, { waitUntil: "networkidle" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (await finishTour.isVisible()) await finishTour.click();

  let definition = page.getByText(definitionName, { exact: true }).first();
  if ((await definition.count()) === 0) {
    await page.getByRole("button", { name: "New reconciliation" }).click();
    const modeDialog = page.getByRole("dialog", { name: "New Reconciliation" });
    const modeCard = modeDialog.locator("div.rounded-xl").filter({
      hasText: "Single Side Reconciliation",
    });
    await modeCard.getByRole("button", { name: "Select", exact: true }).click();
    const wizard = page.getByRole("dialog").filter({ hasText: "Single Side Reconciliation" });
    const source = wizard.locator("div.rounded-xl").filter({ hasText: "Source A" }).first();
    await source.getByRole("button", { name: "PASTE DATA", exact: true }).click();
    await source.getByRole("textbox").fill([
      "record_id,account,currency,amount,value_date",
      "PST-001,NOSTRO-USD-001,USD,125000.25,2026-09-05",
      "PST-002,NOSTRO-USD-001,USD,75000.00,2026-09-05",
      "PST-003,NOSTRO-USD-001,USD,25000.50,2026-09-05",
    ].join("\n"));
    await expect(source.getByText(/5 cols · 3 rows/u)).toBeVisible();
    await wizard.getByText("Manually Configure", { exact: true }).first().click();
    const mappingControls = wizard.locator("div.grid.grid-cols-2").filter({ hasText: "Amount field" });
    await mappingControls.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "amount", exact: true }).click();
    await mappingControls.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "value_date", exact: true }).click();
    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard.getByText("Review Results", { exact: true })).toBeVisible();
    await wizard.getByRole("button", { name: "Continue" }).click();
    await wizard.getByPlaceholder("e.g. Daily Custody vs Ledger").fill(definitionName);
    await wizard.getByRole("button", { name: "Save as draft" }).click();
    await expect(wizard).toBeHidden({ timeout: 20_000 });
    definition = page.getByText(definitionName, { exact: true }).first();
    await expect(definition).toBeVisible();
  }

  const card = definition.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await card.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/Run complete ·/u)).toBeVisible();
  const recent = page.getByText(definitionName, { exact: true }).last()
    .locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await expect(recent).toContainText("3 rows");
  await page.screenshot({ path: testInfo.outputPath("single-side-paste-rerun.png"), fullPage: true });
});
