import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_WATCHER_LIFECYCLE_CAPTURE === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";
const watcherName = "Assurance | PROD | Alert recovery lifecycle | 2026-09-06";

test("File Watcher edit, alert, recovery and disable lifecycle remains auditable", async ({
  page,
}, testInfo) => {
  test.skip(!enabled || !slug, "Requires retained owner state and the PROD assurance tenant slug");
  await page.goto(`/${slug}/workspace?page=watchers`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();

  let row = page.getByRole("row").filter({ hasText: watcherName }).first();
  if ((await row.count()) === 0) {
    await page.getByRole("button", { name: "New watcher" }).click();
    const dialog = page.getByRole("dialog");
    const selects = dialog.getByRole("combobox");
    await dialog.getByRole("textbox").first().fill(watcherName);
    await selects.nth(0).click();
    await page.getByRole("option").first().click();
    await selects.nth(1).click();
    await page.getByRole("option", { name: "Duplicate file", exact: true }).click();
    await selects.nth(2).click();
    await page.getByRole("option", { name: "critical", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    row = page.getByRole("row").filter({ hasText: watcherName }).first();
    await expect(row).toBeVisible();
  }

  const evaluate = row.getByRole("button", { name: `Evaluate watcher ${watcherName}` });
  if (await evaluate.isEnabled()) {
    await evaluate.click();
    await expect(page.getByText("State: alert", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const selects = dialog.getByRole("combobox");
    await selects.nth(1).click();
    await page.getByRole("option", { name: "Freshness", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    row = page.getByRole("row").filter({ hasText: watcherName }).first();
    await row.getByRole("button", { name: `Evaluate watcher ${watcherName}` }).click();
    await expect(page.getByText("State: ok", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: `Disable watcher ${watcherName}` }).click();
    await expect(page.getByText("Disable watcher?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page.getByRole("row").filter({ hasText: watcherName }).first().getByRole("button", {
        name: `Evaluate watcher ${watcherName}`,
      }),
    ).toBeDisabled();
  }

  await page.screenshot({ path: testInfo.outputPath("watcher-lifecycle-disabled.png"), fullPage: true });
});
