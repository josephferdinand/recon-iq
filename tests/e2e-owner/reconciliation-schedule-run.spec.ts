import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RUN_RECON_SCHEDULE === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const definitionName =
  process.env.FVI_E2E_RECON_NAME ?? "FVI Validation Grouped Matching 2026-09-04";
const scheduleName =
  process.env.FVI_E2E_SCHEDULE_NAME ?? "FVI Validation Manual Schedule 2026-09-04";

test("platform owner schedules and runs the retained grouped reconciliation", async ({ page }) => {
  test.skip(
    !enabled || !tenantSlug,
    "Requires FVI_RUN_RECON_SCHEDULE=YES and the DEV validation tenant",
  );

  await page.goto(`/${tenantSlug}/workspace?page=schedules`, { waitUntil: "domcontentloaded" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (
    await finishTour
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await finishTour.click();
    await expect(page.locator(".driver-overlay")).toBeHidden();
  }

  let scheduleRow = page.getByRole("row").filter({ hasText: scheduleName });
  const scheduleExists = await scheduleRow
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!scheduleExists) {
    await page.getByRole("button", { name: "New schedule" }).click();
    const dialog = page.getByRole("dialog", { name: "New schedule" });
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option").filter({ hasText: definitionName }).click();
    await dialog.getByPlaceholder("Hourly nostro rekon").fill(scheduleName);
    await dialog.getByRole("button", { name: "Create schedule" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    scheduleRow = page.getByRole("row").filter({ hasText: scheduleName });
  }

  await expect(scheduleRow).toBeVisible();
  await scheduleRow.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("Ran: 5 matched · 2 exceptions", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(scheduleRow.getByText("OK", { exact: true })).toBeVisible({ timeout: 20_000 });
});
