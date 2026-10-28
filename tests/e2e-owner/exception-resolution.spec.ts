import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RUN_EXCEPTION_RESOLUTION === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const reconName = process.env.FVI_E2E_RECON_NAME ?? "FVI Validation Grouped Matching 2026-09-04";

test("platform owner investigates and resolves a retained reconciliation break", async ({ page }) => {
  test.skip(!enabled || !tenantSlug, "Requires FVI_RUN_EXCEPTION_RESOLUTION=YES and the DEV validation tenant");

  await page.goto(`/${tenantSlug}/workspace?page=breaks`, { waitUntil: "domcontentloaded" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (await finishTour.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)) {
    await finishTour.click();
    await expect(page.locator(".driver-overlay")).toBeHidden();
  }
  const shortcutDialog = page.getByRole("dialog", { name: "Break Manager shortcuts" });
  if (await shortcutDialog.isVisible().catch(() => false)) await page.keyboard.press("Escape");

  await page.getByPlaceholder(/Search reason, root cause, recon/u).fill(reconName);
  const newColumn = page
    .getByText("New", { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  const breakReasons = newColumn.getByText(/^Unmatched:/u);
  const beforeCount = await breakReasons.count();
  if (beforeCount === 0) {
    const resolvedColumn = page
      .getByText("Resolved", { exact: true })
      .first()
      .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(resolvedColumn.getByText(/^Unmatched:/u).first()).toBeVisible();
    return;
  }
  const breakReason = breakReasons.first();
  await expect(breakReason).toBeVisible({ timeout: 20_000 });
  await breakReason.click();

  const detail = page.getByRole("dialog", { name: /^Unmatched:/u });
  await expect(detail).toBeVisible();
  const priority = detail.getByRole("combobox").nth(1);
  await priority.click();
  await page.getByRole("option", { name: "P1", exact: true }).click();

  const rootCause = detail.getByPlaceholder("Describe root cause");
  await rootCause.fill("Synthetic unmatched counterparty record retained for validation.");
  await rootCause.locator("xpath=following::button[normalize-space()='Save'][1]").click();

  await detail.getByPlaceholder(/Confirmed with Falcon Treasury/u).fill(
    "Validated as an intentional unmatched test record. Evidence retained for owner review.",
  );
  await detail.getByRole("button", { name: "Post", exact: true }).click();
  await expect(detail.getByText(/Validated as an intentional unmatched test record/u)).toBeVisible();

  await detail.getByRole("button", { name: "Resolve", exact: true }).click();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(breakReasons).toHaveCount(beforeCount - 1, { timeout: 20_000 });
});
