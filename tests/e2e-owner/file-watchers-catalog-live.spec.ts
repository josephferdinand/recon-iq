import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_WATCHER_CATALOG_CAPTURE === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";

const watcherTypes = [
  ["freshness", "Freshness"],
  ["raw-data", "Raw-data volume"],
  ["row-count-delta", "Row-count delta"],
  ["schema-change", "Schema change"],
  ["dq-failure", "Data-quality failure"],
  ["no-upload", "No upload"],
  ["late-file", "Late file"],
  ["duplicate-file", "Duplicate file"],
  ["filename-sequence", "Filename / sequence"],
  ["control-total", "Control total"],
  ["checksum-integrity", "Checksum integrity"],
] as const;

test.describe.serial("retained File Watcher catalogue", () => {
  for (const [key, label] of watcherTypes) {
    test(`${label} can be configured and evaluated through the browser`, async ({ page }, testInfo) => {
      test.skip(
        !enabled || !slug,
        "Requires retained owner state and the PROD assurance tenant slug",
      );
      const watcherName = `Assurance | PROD | ${label} | 2026-09-06`;

      await page.goto(`/${slug}/workspace?page=watchers`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Data watchers", { exact: true })).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("row").nth(1)).toBeVisible();

      let row = page.getByRole("row").filter({ hasText: watcherName }).first();
      if ((await row.count()) === 0) {
        await page.getByRole("button", { name: "New watcher" }).click();
        const dialog = page.getByRole("dialog");
        const selects = dialog.getByRole("combobox");
        await expect(selects).toHaveCount(3);
        await dialog.getByRole("textbox").first().fill(watcherName);
        await selects.nth(0).click();
        await page.getByRole("option").first().click();
        await selects.nth(1).click();
        await page.getByRole("option", { name: label, exact: true }).click();
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        row = page.getByRole("row").filter({ hasText: watcherName }).first();
        await expect(row).toBeVisible();
      }

      const evaluate = row.getByRole("button", { name: `Evaluate watcher ${watcherName}` });
      await expect(evaluate).toBeEnabled();
      await evaluate.click();
      await expect(page.getByText(/^State:/u)).toBeVisible();
      await expect(row.locator("td").nth(4)).not.toHaveText(/^never$/u);
      await page.screenshot({ path: testInfo.outputPath(`${key}.png`), fullPage: true });
    });
  }
});
