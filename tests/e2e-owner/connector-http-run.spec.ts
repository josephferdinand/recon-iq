import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RUN_CONNECTOR_TEST === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const existingScheduleName = process.env.FVI_CONNECTOR_EXISTING_SCHEDULE_NAME ?? "";
const expectedConnectorType = process.env.FVI_CONNECTOR_EXPECTED_TYPE ?? "https";
const scheduleName = existingScheduleName || "FVI Validation HTTPS Public Feed 2026-09-04";
const blockedScheduleName = "FVI Validation Blocked Private Feed 2026-09-04";
const sourceName = "FVI Validation Excel Pack";
const publicFeedUrl = "https://jsonplaceholder.typicode.com/users";

async function retainedScheduleIsVisible(page: import("@playwright/test").Page, name: string) {
  return page
    .getByText(name, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test("platform owner retains and runs a governed connector", async ({ page }) => {
  test.skip(
    !enabled || !tenantSlug,
    "Requires FVI_RUN_CONNECTOR_TEST=YES and the DEV validation tenant",
  );

  await page.goto(`/${tenantSlug}/workspace?page=connectors`, {
    waitUntil: "domcontentloaded",
  });
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

  if (existingScheduleName && !(await retainedScheduleIsVisible(page, scheduleName))) {
    throw new Error(`Expected retained connector schedule is unavailable: ${scheduleName}`);
  }
  if (!existingScheduleName && !(await retainedScheduleIsVisible(page, scheduleName))) {
    await page.getByRole("button", { name: "New schedule" }).click();
    const dialog = page.getByRole("dialog", { name: "New scheduled connector" });
    await dialog.getByPlaceholder("Falcon Nostro USD — hourly feed").fill(scheduleName);

    await dialog.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: sourceName, exact: true }).click();

    await dialog.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "HTTPS / REST", exact: true }).click();
    await dialog
      .getByPlaceholder("https://feeds.falconbank.com/nostro/eod.json")
      .fill(publicFeedUrl);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  }

  const scheduleCard = page
    .getByText(scheduleName, { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border')][1]");
  await expect(scheduleCard).toBeVisible();
  await expect(scheduleCard.getByText(expectedConnectorType, { exact: true })).toBeVisible();

  await scheduleCard.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/Ingested \d+ rows/u)).toBeVisible({ timeout: 30_000 });
  await expect(scheduleCard.getByText("success", { exact: true })).toBeVisible({ timeout: 20_000 });

  await scheduleCard.getByRole("button", { name: "Run history" }).click();
  const history = page.getByRole("dialog", { name: "Run history" });
  await expect(history.getByText("success", { exact: true }).first()).toBeVisible();
  await expect(history.locator("tbody tr").first().getByRole("cell").nth(2)).not.toHaveText("—");
});

test("platform owner receives a retained failure for an SSRF-blocked connector", async ({
  page,
}) => {
  test.skip(
    !enabled || !tenantSlug,
    "Requires FVI_RUN_CONNECTOR_TEST=YES and the DEV validation tenant",
  );

  await page.goto(`/${tenantSlug}/workspace?page=connectors`, {
    waitUntil: "domcontentloaded",
  });
  if (!(await retainedScheduleIsVisible(page, blockedScheduleName))) {
    await page.getByRole("button", { name: "New schedule" }).click();
    const dialog = page.getByRole("dialog", { name: "New scheduled connector" });
    await dialog.getByPlaceholder("Falcon Nostro USD — hourly feed").fill(blockedScheduleName);
    await dialog.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: sourceName, exact: true }).click();
    await dialog.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "HTTPS / REST", exact: true }).click();
    await dialog
      .getByPlaceholder("https://feeds.falconbank.com/nostro/eod.json")
      .fill("https://127.0.0.1/private-feed.json");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  }

  const scheduleCard = page
    .getByText(blockedScheduleName, { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border')][1]");
  await scheduleCard.getByRole("button", { name: "Run now" }).click();
  await expect(scheduleCard.getByText(/Blocked private IPv4/u)).toBeVisible({ timeout: 30_000 });
  await expect(scheduleCard.getByText("failed", { exact: true })).toBeVisible({ timeout: 20_000 });

  await scheduleCard.getByRole("button", { name: "Run history" }).click();
  const history = page.getByRole("dialog", { name: "Run history" });
  await expect(history.getByText("failed", { exact: true }).first()).toBeVisible();
  await expect(history.getByText(/Blocked private IPv4/u).first()).toBeVisible();
});
