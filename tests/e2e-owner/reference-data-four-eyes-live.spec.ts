import path from "node:path";
import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_REFERENCE_DATA_FOUR_EYES === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const checkerState = process.env.FVI_REFERENCE_DATA_CHECKER_STATE ?? "";

async function selectFxTable(page: import("@playwright/test").Page) {
  await page.goto(`/${tenantSlug}/workspace?page=reference`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Reference data", exact: true })).toBeVisible();
  const catalogue = page.getByRole("table").first();
  const row = catalogue.getByRole("row").filter({ hasText: "fx_spot_rates" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText("Version governance", { exact: true })).toBeVisible();
  return row;
}

test("Reference Data enforces browser maker-checker publication", async ({ page, browser }) => {
  test.setTimeout(120_000);
  test.skip(!enabled || !tenantSlug || !checkerState, "Requires QA maker and owner checker storage states");
  await selectFxTable(page);

  const submit = page.getByRole("button", { name: "Submit for approval" });
  if (await submit.isVisible()) {
    await submit.click();
    await expect(page.getByText("Version submitted for independent approval", { exact: true })).toBeVisible();
    await selectFxTable(page);
  }
  await expect(page.getByText("pending approval", { exact: true })).toBeVisible();
  const makerDecision = page.getByRole("button", { name: "Approve" });
  await expect(makerDecision).toBeVisible();
  await makerDecision.click();
  await expect(page.getByText(/Maker cannot approve or reject their own version/u)).toBeVisible();
  await expect(page.getByText("pending approval", { exact: true })).toBeVisible();

  const checkerContext = await browser.newContext({
    baseURL: process.env.FVI_E2E_BASE_URL,
    storageState: checkerState,
  });
  try {
    const checkerPage = await checkerContext.newPage();
    const tableRow = await selectFxTable(checkerPage);
    await checkerPage.getByLabel(/Decision reason/u).fill("Independent browser review of the retained FX reference snapshot");
    await checkerPage.getByRole("button", { name: "Approve" }).click();
    await expect(checkerPage.getByText("Version published", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(checkerPage.getByText("published", { exact: true })).toBeVisible();
    await expect(tableRow).toContainText("3 rows");
    await checkerPage.screenshot({
      path: path.join(process.env.FVI_E2E_EVIDENCE_DIR ?? "_e2e_run/owner-session", "reference-data-four-eyes-published.png"),
      fullPage: true,
    });
  } finally {
    await checkerContext.close();
  }
});
