import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RECON_UX_AUDIT === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";

test("capture Recon Studio list, mode selection and source selection", async ({ page }, testInfo) => {
  test.skip(!enabled || !slug, "Requires retained PROD owner state");
  await page.goto(`/${slug}/workspace?page=recons`, { waitUntil: "networkidle" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (await finishTour.isVisible()) await finishTour.click();
  await expect(page.locator("#main-content").getByText("Rekon Studio", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-recon-studio-list.png"), fullPage: true });

  await page.getByRole("button", { name: "New reconciliation" }).click();
  const modeDialog = page.getByRole("dialog", { name: "New Reconciliation" });
  await expect(modeDialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("02-reconciliation-mode.png"), fullPage: true });

  const twoSided = modeDialog.locator("div.rounded-xl").filter({ hasText: "Two-Sided Reconciliation" });
  await twoSided.getByRole("button", { name: "Select", exact: true }).click();
  const wizard = page.getByRole("dialog").filter({ hasText: "Two-Sided Reconciliation" });
  await expect(wizard.getByText("Source A", { exact: true })).toBeVisible();
  await expect(wizard.getByText("Source B", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("03-source-selection.png"), fullPage: true });
});
