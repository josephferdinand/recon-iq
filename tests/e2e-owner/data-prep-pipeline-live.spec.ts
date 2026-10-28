import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_DATA_PREP_PIPELINE_CAPTURE === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";
const pipelineName = "Assurance | PROD | Validated Data Prep and DQ | 2026-09-06";

test("browser creates and runs a retained parameterized Data Prep pipeline", async ({
  page,
}, testInfo) => {
  test.skip(!enabled || !slug, "Requires retained owner state and PROD Assurance Lab sources");
  await page.goto(`/${slug}/workspace?page=prep`, { waitUntil: "networkidle" });
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();
  let row = page.getByRole("row").filter({ hasText: pipelineName }).first();

  if ((await row.count()) === 0) {
    await page.getByRole("button", { name: "New pipeline" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").nth(0).fill(pipelineName);
    const baseSelects = dialog.getByRole("combobox");
    await baseSelects.nth(1).click();
    await page.getByRole("option").first().click();
    await baseSelects.nth(2).click();
    await page.getByRole("option").nth(1).click();

    await dialog.getByRole("button", { name: "Add step" }).click();
    await dialog.getByRole("textbox").nth(2).fill("reference");
    await dialog.getByRole("button", { name: "Add step" }).click();
    await dialog.getByRole("combobox").nth(4).click();
    await page.getByRole("option", { name: "Normalize currency amount", exact: true }).click();
    await dialog.getByRole("textbox").nth(3).fill("amount");

    await dialog.getByRole("button", { name: "Add rule" }).click();
    await dialog.getByLabel("DQ rule 1 field").fill("currency");
    await dialog.getByLabel("DQ rule 1 type").click();
    await page.getByRole("option", { name: "regex", exact: true }).click();
    await dialog.getByLabel("DQ rule 1 regex pattern").fill("^[A-Z]{3}$");

    await dialog.getByRole("button", { name: "Add rule" }).click();
    await dialog.getByLabel("DQ rule 2 field").fill("amount");
    await dialog.getByLabel("DQ rule 2 type").click();
    await page.getByRole("option", { name: "min", exact: true }).click();
    await dialog.getByLabel("DQ rule 2 numeric limit").fill("0");

    await dialog.getByRole("button", { name: "Add rule" }).click();
    await dialog.getByLabel("DQ rule 3 field").fill("currency");
    await dialog.getByLabel("DQ rule 3 type").click();
    await page.getByRole("option", { name: "in_set", exact: true }).click();
    await dialog.getByLabel("DQ rule 3 allowed values").fill("USD, EUR, GBP");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    row = page.getByRole("row").filter({ hasText: pipelineName }).first();
    await expect(row).toBeVisible();
  }

  await expect(row).toContainText("2");
  await expect(row).toContainText("3");
  await row.getByTitle("Run now").click();
  await expect(row).toContainText(/success|warn|failed/u);
  const recentRun = page.getByRole("table").nth(1).getByRole("row").filter({ hasText: pipelineName }).first();
  await expect(recentRun).toBeVisible();
  await expect(recentRun).toContainText(/success|warn|failed/u);
  await page.screenshot({ path: testInfo.outputPath("data-prep-pipeline-run.png"), fullPage: true });
});
