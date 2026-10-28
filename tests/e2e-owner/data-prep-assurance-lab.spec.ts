import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const enabled = process.env.FVI_RUN_DATA_PREP_ASSURANCE === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const pipelineName = "Assurance DP1 — Normalize Nostro internal cash ledger";
const sourceName = "Assurance S2A — Internal cash ledger";
const outputName = "Assurance DP1 Output — Normalized Nostro internal cash ledger";
const evidenceDir = path.resolve("_e2e_run/owner-session/data-prep-assurance");

async function finishTourIfPresent(page: Page) {
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (
    await finishTour
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await finishTour.click();
    await expect(page.locator(".driver-overlay")).toBeHidden();
  }
}

async function chooseOption(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

function sourceCard(page: Page, name: string) {
  return page
    .locator("h3")
    .filter({ hasText: name })
    .first()
    .locator(
      "xpath=ancestor::div[(contains(@class,'rounded-lg') or contains(@class,'rounded-xl')) and contains(@class,'bg-card')][1]",
    );
}

test.beforeEach(async ({ page }) => {
  test.skip(!enabled || !tenantSlug, "Requires the retained PROD Assurance Lab");
  await page.setViewportSize({ width: 1920, height: 1080 });
  page.setDefaultTimeout(30_000);
  await mkdir(evidenceDir, { recursive: true });
});

test("creates, runs, approves, and proves a retained refined Data Prep source", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  const networkEvidence: Array<{ method: string; path: string; status: number }> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === "https://app.reconiq.example" && response.request().method() !== "GET") {
      networkEvidence.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      });
    }
  });

  await page.goto(`/${tenantSlug}/workspace?page=data`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);

  let outputCard = sourceCard(page, outputName);
  if (!(await outputCard.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "New data source" }).click();
    const sourceDialog = page.getByRole("dialog", { name: "New data source" });
    await sourceDialog
      .getByPlaceholder("Bank statement — Falcon Nostro USD (Citi)")
      .fill(outputName);
    await sourceDialog
      .getByPlaceholder("Daily Falcon Nostro USD feed from Citi, T-1 settlement.")
      .fill("Retained refined output produced by the Assurance Lab DP1 normalization pipeline.");
    await chooseOption(page, sourceDialog.getByRole("combobox"), "JSON");
    await sourceDialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(sourceDialog).toBeHidden({ timeout: 20_000 });
    outputCard = sourceCard(page, outputName);
  }
  await expect(outputCard).toBeVisible();

  await page.goto(`/${tenantSlug}/workspace?page=prep`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);

  let pipelineRow = page.locator("table").first().getByRole("row").filter({ hasText: pipelineName });
  if (!(await pipelineRow.first().isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "New pipeline" }).click();
    const pipelineDialog = page.getByRole("dialog", { name: "New pipeline" });
    await pipelineDialog.locator("input").first().fill(pipelineName);
    await pipelineDialog
      .locator("textarea")
      .first()
      .fill(
        "Normalize references and amounts, then deduplicate the internal Nostro feed before reconciliation.",
      );
    await chooseOption(page, pipelineDialog.getByRole("combobox").nth(0), "Drop failing rows");
    await chooseOption(page, pipelineDialog.getByRole("combobox").nth(1), sourceName);
    await chooseOption(page, pipelineDialog.getByRole("combobox").nth(2), outputName);

    const addStep = pipelineDialog.getByRole("button", { name: "Add step" });
    await addStep.click();
    let steps = pipelineDialog.locator('div.rounded.border[class~="bg-muted/20"]');
    await steps.nth(0).locator("input").first().fill("reference");

    await addStep.click();
    steps = pipelineDialog.locator('div.rounded.border[class~="bg-muted/20"]');
    await chooseOption(page, steps.nth(1).getByRole("combobox"), "Uppercase");
    await steps.nth(1).locator("input").first().fill("reference");

    await addStep.click();
    steps = pipelineDialog.locator('div.rounded.border[class~="bg-muted/20"]');
    await chooseOption(page, steps.nth(2).getByRole("combobox"), "Normalize currency amount");
    await steps.nth(2).locator("input").first().fill("amount");

    await addStep.click();
    steps = pipelineDialog.locator('div.rounded.border[class~="bg-muted/20"]');
    await chooseOption(page, steps.nth(3).getByRole("combobox"), "Deduplicate rows");
    await steps.nth(3).locator("input").first().fill("record_id");

    const addRule = pipelineDialog.getByRole("button", { name: "Add rule" });
    await addRule.click();
    await addRule.click();
    await addRule.click();
    const ruleIds = pipelineDialog.getByPlaceholder("e.g. falcon-dq-001");
    const ruleFields = pipelineDialog.getByPlaceholder("e.g. falcon_account_number");
    const ruleRows = [0, 1, 2].map((index) => ruleIds.nth(index).locator("xpath=.."));

    await ruleIds.nth(0).fill("dp1-record-required");
    await ruleFields.nth(0).fill("record_id");
    await chooseOption(page, ruleRows[0].getByRole("combobox").nth(1), "critical");

    await ruleIds.nth(1).fill("dp1-record-unique");
    await ruleFields.nth(1).fill("record_id");
    await chooseOption(page, ruleRows[1].getByRole("combobox").nth(0), "unique");

    await ruleIds.nth(2).fill("dp1-currency-iso3");
    await ruleFields.nth(2).fill("currency");
    await chooseOption(page, ruleRows[2].getByRole("combobox").nth(0), "currency");
    await chooseOption(page, ruleRows[2].getByRole("combobox").nth(1), "critical");

    await pipelineDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(pipelineDialog).toBeHidden({ timeout: 20_000 });
    pipelineRow = page.locator("table").first().getByRole("row").filter({ hasText: pipelineName });
  }

  await expect(pipelineRow).toBeVisible();
  await pipelineRow.getByTitle("Run now").click();
  await expect(page.getByText(/^Pipeline success — P-/u)).toBeVisible({ timeout: 30_000 });
  await expect(pipelineRow.getByText("success", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator("table").nth(1).getByRole("row").filter({ hasText: pipelineName }).filter({ hasText: "6 → 6" }).first(),
  ).toBeVisible({ timeout: 20_000 });

  const approveButton = pipelineRow.getByRole("button", { name: /^Approve/u });
  await expect(approveButton).toBeVisible();
  await approveButton.click();
  await expect(page.getByText(/^Approved · DP-/u)).toBeVisible({ timeout: 20_000 });
  await expect(pipelineRow.getByText("Approved", { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.screenshot({
    path: path.join(evidenceDir, "dp1-pipeline-approved-and-run.png"),
    fullPage: true,
  });

  await page.goto(`/${tenantSlug}/workspace?page=data`, { waitUntil: "domcontentloaded" });
  outputCard = sourceCard(page, outputName);
  await expect(outputCard.getByText("6 rows · 14 columns", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(outputCard.getByText("record_id", { exact: true })).toBeVisible();
  await expect(outputCard.getByText("value_date", { exact: true })).toBeVisible();
  await expect(outputCard.getByText("amount", { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(evidenceDir, "dp1-refined-output-source.png"),
    fullPage: true,
  });

  await writeFile(
    path.join(evidenceDir, "dp1-sanitized-browser-api-evidence.json"),
    `${JSON.stringify(
      {
        pipeline: pipelineName,
        source: sourceName,
        output: outputName,
        expected_rows_in: 6,
        expected_rows_out: 6,
        browser_assertions: [
          "pipeline run success",
          "approved for Rekon Studio",
          "refined output ready",
          "14-column schema visible",
        ],
        network: networkEvidence,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
