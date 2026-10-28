import { expect, test } from "@playwright/test";

import { TRANSFORM_CATALOG } from "../../src/lib/data-prep-transforms";

const enabled = process.env.FVI_DATA_PREP_CATALOG_CAPTURE === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";

test("Data Prep exposes all 42 transforms and complete DQ parameter editors", async ({
  page,
}, testInfo) => {
  test.skip(!enabled || !slug, "Requires retained owner state and the PROD assurance tenant slug");
  await page.goto(`/${slug}/workspace?page=prep`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Data Prep pipelines", { exact: true })).toBeVisible();
  await expect(page.getByText(/42-rule transformation catalog/u)).toBeVisible();
  await page.getByRole("button", { name: "New pipeline" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add step" }).click();
  const transformSelect = dialog.getByRole("combobox").nth(3);
  await transformSelect.click();
  await expect(page.getByRole("option")).toHaveCount(TRANSFORM_CATALOG.length);
  for (const definition of TRANSFORM_CATALOG) {
    await expect(page.getByRole("option", { name: definition.label, exact: true })).toHaveCount(1);
  }
  await page.getByRole("option", { name: "Regex replace", exact: true }).click();
  await expect(dialog.getByText("Regex *", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Add rule" }).click();
  const ruleType = dialog.getByLabel("DQ rule 1 type");
  await ruleType.click();
  await page.getByRole("option", { name: "regex", exact: true }).click();
  await expect(dialog.getByLabel("DQ rule 1 regex pattern")).toBeVisible();
  await ruleType.click();
  await page.getByRole("option", { name: "min", exact: true }).click();
  await expect(dialog.getByLabel("DQ rule 1 numeric limit")).toBeVisible();
  await ruleType.click();
  await page.getByRole("option", { name: "in_set", exact: true }).click();
  await expect(dialog.getByLabel("DQ rule 1 allowed values")).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("data-prep-42-rule-catalog.png"), fullPage: true });
});
