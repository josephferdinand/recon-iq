import { expect, test } from "@playwright/test";
import path from "node:path";

const tenantSlug = process.env.FVI_E2E_TENANT_SLUG;
const enabled = process.env.FVI_ALLOW_OWNER_UPLOAD === "YES" && Boolean(tenantSlug);
const uploadFile = process.env.FVI_E2E_UPLOAD_FILE ?? "tests/fixtures/reconciliation/ledger-small.csv";
const sourceName = process.env.FVI_E2E_SOURCE_NAME ?? "FVI validation ledger";
const sourceType = process.env.FVI_E2E_SOURCE_TYPE ?? "csv";
const sourceTypeLabels: Record<string, string> = {
  csv: "CSV file",
  xlsx: "Excel (xlsx)",
  json: "JSON",
};

test("owner-session reconciliation upload reaches the governed upload flow", async ({ page }) => {
  test.skip(!enabled, "Requires signed-in storage state, FVI_E2E_TENANT_SLUG, and FVI_ALLOW_OWNER_UPLOAD=YES");

  await page.goto(`/${tenantSlug}/workspace?page=data`, { waitUntil: "domcontentloaded" });
  const sourceTitle = page.getByText(sourceName, { exact: true }).first();
  const sourceExists = await sourceTitle
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  let sourceCard = sourceTitle.locator(
    "xpath=ancestor::div[(contains(@class,'rounded-lg') or contains(@class,'rounded-xl')) and contains(@class,'bg-card')][1]",
  );
  if (!sourceExists) {
    await page.getByRole("button", { name: "New data source" }).click();
    const dialog = page.getByRole("dialog", { name: "New data source" });
    await dialog.getByPlaceholder("Bank statement — Falcon Nostro USD (Citi)").fill(sourceName);
    await dialog
      .getByPlaceholder("Daily Falcon Nostro USD feed from Citi, T-1 settlement.")
      .fill("Synthetic source retained for authorised FVI DEV reconciliation validation.");
    if (sourceType !== "csv") {
      await dialog.getByRole("combobox").click();
      await page.getByRole("option", { name: sourceTypeLabels[sourceType], exact: true }).click();
    }
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();
    sourceCard = page
      .getByText(sourceName, { exact: true })
      .first()
      .locator("xpath=ancestor::div[(contains(@class,'rounded-lg') or contains(@class,'rounded-xl')) and contains(@class,'bg-card')][1]");
  }

  await expect(sourceCard).toBeVisible();
  const fileInput = sourceCard.locator('input[type="file"]');
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles(path.resolve(uploadFile));
  await expect(sourceCard.getByText(/\d+ rows · \d+ columns/u)).toBeVisible({ timeout: 30_000 });
  await expect(sourceCard.getByText(/ready|uploaded/i).first()).toBeVisible();
});
