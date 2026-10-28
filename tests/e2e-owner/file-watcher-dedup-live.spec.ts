import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_WATCHER_DEDUP_CAPTURE === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";
const watcherName = "Assurance | PROD | Duplicate file | 2026-09-06";

test("repeated alert evaluation remains visible and deduplicated", async ({ page }, testInfo) => {
  test.skip(!enabled || !slug, "Requires the retained PROD duplicate-file watcher");
  await page.goto(`/${slug}/workspace?page=watchers`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("table")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: watcherName }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Evaluate watcher ${watcherName}` }).click();
  await expect(page.getByText("State: alert", { exact: true })).toBeVisible();
  await expect(row.locator("td").nth(4)).toContainText("duplicate file detected");
  await page.screenshot({ path: testInfo.outputPath("duplicate-alert-deduplicated.png"), fullPage: true });
});
