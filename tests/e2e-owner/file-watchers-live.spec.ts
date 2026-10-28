import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_WATCHER_UX_CAPTURE === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";
const watcherName =
  process.env.FVI_WATCHER_TEST_NAME ?? "Assurance | PROD | Daily feed freshness | 2026-09-06";

const watcherTypes = [
  "Freshness",
  "Raw-data volume",
  "Row-count delta",
  "Schema change",
  "Data-quality failure",
  "No upload",
  "Late file",
  "Duplicate file",
  "Filename / sequence",
  "Control total",
  "Checksum integrity",
];

test("File Watchers exposes the full catalogue and retains a browser-created evaluation", async ({
  page,
}, testInfo) => {
  test.skip(!enabled || !slug, "Requires retained owner state and the PROD assurance tenant slug");

  await page.goto(`/${slug}/workspace?page=watchers`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Data watchers", { exact: true })).toBeVisible();
  await expect(page.getByText(/Freshness, volume, schema, DQ/u)).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();

  const existing = page.getByText(watcherName, { exact: true });
  if ((await existing.count()) === 0) {
    await page.getByRole("button", { name: "New watcher" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("New watcher", { exact: true })).toBeVisible();

    const selects = dialog.getByRole("combobox");
    await expect(selects).toHaveCount(3);
    await selects.nth(1).click();
    for (const type of watcherTypes) {
      await expect(page.getByRole("option", { name: type, exact: true })).toBeVisible();
    }
    await page.getByRole("option", { name: "Freshness", exact: true }).click();

    await dialog.getByRole("textbox").first().fill(watcherName);
    await selects.nth(0).click();
    await page.getByRole("option").first().click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(watcherName, { exact: true })).toBeVisible();
  }

  const row = page.getByRole("row").filter({ hasText: watcherName }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Evaluate watcher ${watcherName}` }).click();
  await expect(page.getByText(/^State:/u)).toBeVisible();
  await expect(row.locator("td").nth(4)).not.toHaveText(/^never$/u);
  await page.screenshot({
    path: testInfo.outputPath("file-watchers-retained-evaluation.png"),
    fullPage: true,
  });
});
