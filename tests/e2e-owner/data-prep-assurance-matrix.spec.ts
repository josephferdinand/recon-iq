import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const enabled = process.env.FVI_RUN_DATA_PREP_ASSURANCE === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const scenarioFilter = process.env.FVI_DATA_PREP_SCENARIO_FILTER ?? "";
const evidenceDir = path.resolve(
  "_e2e_run/owner-session/data-prep-assurance",
  tenantSlug || "unscoped",
);

const scenarios = [
  ["DP2", "Standardize bank Nostro statement", "Assurance S2B — Bank nostro statement", 6],
  ["DP3", "Normalize broker executions", "Assurance S3A — Broker executions", 7],
  ["DP4", "Standardize custodian settlements", "Assurance S3B — Custodian settlements", 8],
  [
    "DP5",
    "Normalize fund administrator positions",
    "Assurance S4A — Fund administrator positions",
    7,
  ],
  ["DP6", "Standardize custody positions", "Assurance S4B — Custodian positions", 6],
  ["DP7", "Normalize internal trade capture", "Assurance S5A — Internal trades", 6],
  ["DP8", "Normalize broker confirmations", "Assurance S5B — Broker confirmations", 5],
  ["DP9", "Standardize custodian trade settlement", "Assurance S5C — Custodian settlement", 6],
  ["DP10", "Validate general ledger controls", "Assurance S1 — General ledger journal control", 12],
  [
    "DP11",
    "Normalize intercompany counter-entry signs",
    "Assurance S9B — Entity B intercompany ledger",
    5,
  ],
] as const;

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

async function ensureOutputSource(page: Page, outputName: string, code: string) {
  let card = sourceCard(page, outputName);
  if (await card.isVisible().catch(() => false)) return;

  await page.getByRole("button", { name: "New data source" }).click();
  const dialog = page.getByRole("dialog", { name: "New data source" });
  await dialog.getByPlaceholder("Bank statement — Falcon Nostro USD (Citi)").fill(outputName);
  await dialog
    .getByPlaceholder("Daily Falcon Nostro USD feed from Citi, T-1 settlement.")
    .fill(`Retained refined output produced by the Assurance Lab ${code} pipeline.`);
  await chooseOption(page, dialog.getByRole("combobox"), "JSON");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  card = sourceCard(page, outputName);
  await expect(card).toBeVisible();
}

async function addStep(page: Page, dialog: Locator, label: string, field: string) {
  await dialog.getByRole("button", { name: "Add step" }).click();
  const steps = dialog.locator('div.rounded.border[class~="bg-muted/20"]');
  const step = steps.last();
  if (label !== "Trim whitespace") {
    await chooseOption(page, step.getByRole("combobox"), label);
  }
  await step.locator("input").first().fill(field);
}

async function addCounterEntrySignStep(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: "Add step" }).click();
  const step = dialog.locator('div.rounded.border[class~="bg-muted/20"]').last();
  await chooseOption(page, step.getByRole("combobox"), "Flip sign by indicator");
  await step.locator("input").nth(0).fill("amount");
  await step.locator("input").nth(1).fill("source_status");
  await step.locator("input").nth(2).fill("COUNTERENTRY");
}

async function configureDataQuality(page: Page, dialog: Locator, code: string) {
  const addRule = dialog.getByRole("button", { name: "Add rule" });
  await addRule.click();
  await addRule.click();
  await addRule.click();

  const ruleIds = dialog.getByPlaceholder("e.g. falcon-dq-001");
  const ruleFields = dialog.getByPlaceholder("e.g. falcon_account_number");
  const rows = [0, 1, 2].map((index) => ruleIds.nth(index).locator("xpath=.."));

  await ruleIds.nth(0).fill(`${code.toLowerCase()}-record-required`);
  await ruleFields.nth(0).fill("record_id");
  await chooseOption(page, rows[0].getByRole("combobox").nth(1), "critical");

  await ruleIds.nth(1).fill(`${code.toLowerCase()}-record-unique`);
  await ruleFields.nth(1).fill("record_id");
  await chooseOption(page, rows[1].getByRole("combobox").nth(0), "unique");

  await ruleIds.nth(2).fill(`${code.toLowerCase()}-currency-iso3`);
  await ruleFields.nth(2).fill("currency");
  await chooseOption(page, rows[2].getByRole("combobox").nth(0), "currency");
  await chooseOption(page, rows[2].getByRole("combobox").nth(1), "critical");
}

test.beforeEach(async ({ page }) => {
  test.skip(!enabled || !tenantSlug, "Requires the retained PROD Assurance Lab");
  await page.setViewportSize({ width: 1920, height: 1080 });
  page.setDefaultTimeout(30_000);
  await mkdir(evidenceDir, { recursive: true });
});

test("creates and executes the retained DP2–DP11 assurance matrix", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const selected = scenarios.filter(([code]) => !scenarioFilter || code === scenarioFilter);
  expect(
    selected.length,
    "Data Prep scenario filter must select at least one scenario",
  ).toBeGreaterThan(0);
  const networkEvidence: Array<{ method: string; path: string; status: number }> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/_serverFn/") && response.request().method() === "POST") {
      networkEvidence.push({ method: "POST", path: url.pathname, status: response.status() });
    }
  });

  await page.goto(`/${tenantSlug}/workspace?page=data`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);
  for (const [code, title] of selected) {
    await ensureOutputSource(page, `Assurance ${code} Output — ${title}`, code);
  }

  await page.goto(`/${tenantSlug}/workspace?page=prep`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);

  const results: Array<Record<string, unknown>> = [];
  for (const [code, title, sourceName, expectedRows] of selected) {
    const pipelineName = `Assurance ${code} — ${title}`;
    const outputName = `Assurance ${code} Output — ${title}`;
    let row = page.locator("table").first().getByRole("row").filter({ hasText: pipelineName });

    if (
      !(await row
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByRole("button", { name: "New pipeline" }).click();
      const dialog = page.getByRole("dialog", { name: "New pipeline" });
      await dialog.locator("input").first().fill(pipelineName);
      await dialog
        .locator("textarea")
        .first()
        .fill(
          `Retained ${code} production-realistic normalization and DQ pipeline for reconciliation assurance.`,
        );
      await chooseOption(page, dialog.getByRole("combobox").nth(0), "Drop failing rows");
      await chooseOption(page, dialog.getByRole("combobox").nth(1), sourceName);
      await chooseOption(page, dialog.getByRole("combobox").nth(2), outputName);

      await addStep(page, dialog, "Trim whitespace", "reference");
      await addStep(page, dialog, "Uppercase", "reference");
      await addStep(page, dialog, "Normalize currency amount", "amount");
      await addStep(page, dialog, "Cast to ISO date", "value_date");
      await addStep(page, dialog, "Deduplicate rows", "record_id");
      if (code === "DP11") await addCounterEntrySignStep(page, dialog);
      await configureDataQuality(page, dialog, code);

      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      row = page.locator("table").first().getByRole("row").filter({ hasText: pipelineName });
    }

    await expect(row).toBeVisible();
    await row.getByTitle("Run now").click();
    await expect(page.getByText(/^Pipeline success — P-/u).last()).toBeVisible({ timeout: 30_000 });
    const runRow = page
      .locator("table")
      .nth(1)
      .getByRole("row")
      .filter({ hasText: pipelineName })
      .first();
    await expect(runRow).toContainText(`${expectedRows} → ${expectedRows}`, { timeout: 20_000 });
    await expect(runRow).toContainText("0 failures");

    const approve = row.getByRole("button", { name: /^Approve/u });
    if (await approve.isVisible().catch(() => false)) {
      await approve.click();
      await expect(page.getByText(/^Approved · DP-/u).last()).toBeVisible({ timeout: 20_000 });
    }
    await expect(row.getByText("Approved", { exact: true })).toBeVisible({ timeout: 20_000 });
    await row.screenshot({
      path: path.join(evidenceDir, `${code.toLowerCase()}-approved-run-row.png`),
    });
    results.push({
      code,
      pipeline: pipelineName,
      source: sourceName,
      output: outputName,
      rows: expectedRows,
    });
  }

  await writeFile(
    path.join(evidenceDir, "dp2-dp10-sanitized-browser-api-evidence.json"),
    `${JSON.stringify({ results, network: networkEvidence }, null, 2)}\n`,
    "utf8",
  );
});
