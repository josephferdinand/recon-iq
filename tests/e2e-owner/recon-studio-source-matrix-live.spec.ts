import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const enabled = process.env.FVI_RECON_SOURCE_MATRIX === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";
const dataPrepPipeline = "Assurance DP1 — Normalize Nostro internal cash ledger";
const existingSource = "Assurance S2A — Internal cash ledger";
const aidpDocumentId = process.env.FVI_AIDP_REVIEW_DOCUMENT_ID ?? "";
const aidpFilename = process.env.FVI_AIDP_REVIEW_FILENAME ?? "fvi-assurance-mixed-bank-statement.pdf";

test.describe.configure({ mode: "serial" });

async function seedTour(page: Page) {
  await page.addInitScript((id) => {
    const key = "fvi.prefs.v1";
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    current.tourSeen = { ...(current.tourSeen ?? {}), "ws.recons": true, [`workspace-${id}-v2`]: true };
    current.tourProgress = { ...(current.tourProgress ?? {}) };
    delete current.tourProgress["ws.recons"];
    localStorage.setItem(key, JSON.stringify(current));
  }, tenantId);
}

async function startWizard(page: Page, mode: "Single Side Reconciliation" | "Two-Sided Reconciliation" | "Tri-Party Reconciliation") {
  await page.goto(`/${tenantSlug}/workspace?page=recons`, { waitUntil: "networkidle" });
  await expect(page.locator(".driver-overlay")).toBeHidden();
  await page.getByRole("button", { name: "New reconciliation" }).click();
  const chooser = page.getByRole("dialog", { name: "New Reconciliation" });
  const card = chooser.getByText(mode, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  await card.getByRole("button", { name: "Select", exact: true }).click();
  const wizard = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: mode, exact: true }),
  });
  await expect(wizard).toBeVisible();
  return wizard;
}

async function chooseOption(page: Page, trigger: Locator, name?: string) {
  await trigger.click();
  const option = name
    ? page.getByRole("option", { name, exact: true })
    : page.getByRole("option").first();
  const selected = (await option.textContent())?.trim() ?? "";
  await option.click();
  return selected;
}

type MatrixSource = "upload" | "paste" | "refined" | "existing" | "aidp";

async function configureMatrixSource(page: Page, side: Locator, sideLabel: string, kind: MatrixSource) {
  if (kind === "upload") {
    await side.locator('input[type="file"]').setInputFiles(
      path.resolve("tests/fixtures/reconciliation/recon-studio-matrix-upload.csv"),
    );
  } else if (kind === "paste") {
    await side.getByRole("button", { name: `${sideLabel}: PASTE DATA` }).click();
    await side.getByLabel(`${sideLabel}: paste CSV or TSV data`).fill([
      "record_id,group_id,scenario,value_date,currency,amount,reference",
      `MX-${sideLabel}-001,MX-GRP-001,matrix-${sideLabel},2026-09-08,USD,125000.00,SWIFT-MX-001`,
      `MX-${sideLabel}-002,MX-GRP-002,matrix-${sideLabel},2026-09-08,EUR,87500.25,SWIFT-MX-002`,
    ].join("\n"));
  } else if (kind === "refined") {
    await side.getByRole("button", { name: `${sideLabel}: DATA PREP OUTPUT` }).click();
    await chooseOption(page, side.getByRole("combobox"), dataPrepPipeline);
  } else if (kind === "existing") {
    await side.getByRole("button", { name: `${sideLabel}: EXISTING DATA` }).click();
    await chooseOption(page, side.getByRole("combobox"), existingSource);
  } else {
    await chooseOption(page, side.getByLabel(`${sideLabel}: select AIDP extraction`), aidpFilename);
  }
  await expect(side.getByText(/\d+ cols · \d+ rows/u)).toBeVisible({ timeout: 30_000 });
}

async function assertAutoMapping(wizard: Locator) {
  await wizard.getByText("Auto-Detect Columns", { exact: true }).first().click();
  await expect(wizard.locator("table").filter({ hasText: "Canonical" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.skip(!enabled || !tenantSlug || !tenantId, "Requires retained PROD Assurance Lab state");
  await seedTour(page);
  await page.setViewportSize({ width: 1722, height: 900 });
});

test("Data Prep Output and Existing Data preview, test and auto-map together", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const wizard = await startWizard(page, "Two-Sided Reconciliation");
  const sideA = wizard.getByTestId("recon-source-SOURCE_A");
  const sideB = wizard.getByTestId("recon-source-SOURCE_B");
  await sideA.getByRole("button", { name: "Source A: DATA PREP OUTPUT" }).click();
  await chooseOption(page, sideA.getByRole("combobox"), dataPrepPipeline);
  await expect(sideA.getByText(/\d+ cols · \d+ rows/u)).toBeVisible({ timeout: 30_000 });
  await sideA.getByRole("button", { name: "Test connection" }).click();
  await expect(sideA.getByText(/Pipeline approved · refined dataset attached/u)).toBeVisible();

  await sideB.getByRole("button", { name: "Source B: EXISTING DATA" }).click();
  await chooseOption(page, sideB.getByRole("combobox"), existingSource);
  await expect(sideB.getByText(/\d+ cols · \d+ rows/u)).toBeVisible({ timeout: 30_000 });
  await sideB.getByRole("button", { name: "Test connection" }).click();
  await expect(sideB.getByText(/Linked · \d+ historical upload/u)).toBeVisible();

  await wizard.getByText("Auto-Detect Columns", { exact: true }).first().click();
  await expect(wizard.locator("table").filter({ hasText: "Canonical" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("data-prep-existing-auto-map.png"), fullPage: true });
});

test("Upload, Paste and Existing Data form a retained tri-party draft", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const definitionName = "Assurance | PROD | Upload Paste Existing Tri-Party | 2026-09-08";
  await page.goto(`/${tenantSlug}/workspace?page=recons`, { waitUntil: "networkidle" });
  const retained = page.getByText(definitionName, { exact: true }).first();
  if (await retained.isVisible().catch(() => false)) {
    await expect(retained).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("upload-paste-existing-tri-party-retained.png"), fullPage: true });
    return;
  }
  const wizard = await startWizard(page, "Tri-Party Reconciliation");
  const sideA = wizard.getByTestId("recon-source-SOURCE_A");
  const sideB = wizard.getByTestId("recon-source-SOURCE_B");
  const sideC = wizard.getByTestId("recon-source-SOURCE_C");

  await sideA.locator('input[type="file"]').setInputFiles(
    path.resolve("tests/fixtures/reconciliation/recon-studio-matrix-upload.csv"),
  );
  await expect(sideA.getByText("7 cols · 2 rows", { exact: true })).toBeVisible();

  await sideB.getByRole("button", { name: "Source B: PASTE DATA" }).click();
  await sideB.getByLabel("Source B: paste CSV or TSV data").fill([
    "record_id,group_id,scenario,value_date,currency,amount,reference",
    "MX-P-001,MX-GRP-001,custodian-versus-ledger,2026-09-08,USD,125000.00,SWIFT-MX-001",
    "MX-P-002,MX-GRP-002,custodian-versus-ledger,2026-09-08,EUR,87500.25,SWIFT-MX-002",
  ].join("\n"));
  await expect(sideB.getByText("7 cols · 2 rows", { exact: true })).toBeVisible();

  await sideC.getByRole("button", { name: "Source C: EXISTING DATA" }).click();
  await chooseOption(page, sideC.getByRole("combobox"), existingSource);
  await expect(sideC.getByText(/\d+ cols · \d+ rows/u)).toBeVisible({ timeout: 30_000 });

  await wizard.getByText("Auto-Detect Columns", { exact: true }).first().click();
  const mappingTable = wizard.locator("table").filter({ hasText: "Canonical" });
  await expect(mappingTable).toBeVisible();
  await expect(mappingTable.getByRole("row").filter({ hasText: "group_id" })).toBeVisible();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await expect(wizard.getByText("Review Results", { exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard.getByPlaceholder("e.g. Daily Custody vs Ledger").fill(definitionName);
  await wizard.getByRole("button", { name: "Save as draft" }).click();
  await expect(wizard).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(definitionName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("upload-paste-existing-tri-party.png"), fullPage: true });
});

test("approved AIDP output is selectable and exposes current extracted fields", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(!aidpDocumentId, "Requires a retained AIDP review document");
  const definitionName = "Assurance | PROD | Reviewed AIDP Outputs Completeness | 2026-09-08";
  await page.goto(`/${tenantSlug}/tenant?page=aidp-review`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Filter by document ID").fill(aidpDocumentId);
  const acceptButtons = page.getByTitle("Accept", { exact: true });
  await Promise.race([
    acceptButtons.first().waitFor({ state: "visible", timeout: 30_000 }),
    page.getByText("No pending reviews.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  let remaining = await acceptButtons.count();
  while (remaining > 0) {
    await acceptButtons.first().click();
    await expect.poll(() => acceptButtons.count(), { timeout: 20_000 }).toBeLessThan(remaining);
    remaining = await acceptButtons.count();
  }

  await page.goto(`/${tenantSlug}/workspace?page=aidp`, { waitUntil: "networkidle" });
  const documentRow = page.getByRole("row").filter({ hasText: aidpFilename }).first();
  await expect(documentRow).toBeVisible();
  if (!(await documentRow.getByText("approved", { exact: true }).isVisible().catch(() => false))) {
    await documentRow.getByRole("button", { name: "Approve", exact: true }).click();
  }
  await expect(documentRow.getByText("approved", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto(`/${tenantSlug}/workspace?page=recons`, { waitUntil: "networkidle" });
  const retained = page.getByText(definitionName, { exact: true }).first();
  if (await retained.isVisible().catch(() => false)) {
    const card = page.locator("div.rounded-lg.border").filter({ hasText: definitionName }).first();
    await card.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText(/Run complete · 1 matched, 0 exceptions/u)).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: testInfo.outputPath("aidp-reconciliation-retained-run.png"), fullPage: true });
    return;
  }

  const wizard = await startWizard(page, "Single Side Reconciliation");
  const sideA = wizard.getByTestId("recon-source-SOURCE_A");
  const selectedDocument = await chooseOption(page, sideA.getByLabel("Source A: select AIDP extraction"), aidpFilename);
  expect(selectedDocument.length).toBeGreaterThan(0);
  await expect(sideA.getByText(/\d+ cols · \d+ rows/u)).toBeVisible({ timeout: 30_000 });
  await sideA.getByRole("button", { name: "Test connection" }).click();
  await expect(sideA.getByText(/Extraction ready · \d+ record/u)).toBeVisible({ timeout: 30_000 });
  await wizard.getByText("Manually Configure", { exact: true }).first().click();
  await expect(wizard.locator("table").filter({ hasText: "Canonical" })).toBeVisible();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await expect(wizard.getByText("Review Results", { exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard.getByPlaceholder("e.g. Daily Custody vs Ledger").fill(definitionName);
  await wizard.getByRole("button", { name: "Save as draft" }).click();
  await expect(wizard).toBeHidden({ timeout: 30_000 });
  const created = page.getByText(definitionName, { exact: true }).first();
  await expect(created).toBeVisible({ timeout: 30_000 });
  const card = page.locator("div.rounded-lg.border").filter({ hasText: definitionName }).first();
  await card.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/Run complete · 1 matched, 0 exceptions/u)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("aidp-reconciliation-complete.png"), fullPage: true });
});

test("Describe in English returns only governed source-column mappings", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const wizard = await startWizard(page, "Two-Sided Reconciliation");
  const sideA = wizard.getByTestId("recon-source-SOURCE_A");
  const sideB = wizard.getByTestId("recon-source-SOURCE_B");
  await sideA.getByRole("button", { name: "Source A: EXISTING DATA" }).click();
  await chooseOption(page, sideA.getByRole("combobox"), existingSource);
  await expect(sideA.getByText(/\d+ cols · \d+ rows/u)).toBeVisible({ timeout: 30_000 });
  await sideB.getByRole("button", { name: "Source B: DATA PREP OUTPUT" }).click();
  await chooseOption(page, sideB.getByRole("combobox"), dataPrepPipeline);
  await expect(sideB.getByText(/\d+ cols · \d+ rows/u)).toBeVisible({ timeout: 30_000 });
  await wizard.getByText("Describe in English", { exact: true }).first().click();
  await wizard.getByPlaceholder(/Match Falcon trades by trade_id/u).fill(
    "Match the two sources using record_id and group_id. Compare amount and allow value_date as the business date.",
  );
  await wizard.getByRole("button", { name: "Generate mapping" }).click();
  await expect(page.getByText("AI mapping ready — review the diff", { exact: true })).toBeVisible({ timeout: 90_000 });
  const mappingTable = wizard.locator("table").filter({ hasText: "Canonical" });
  await expect(mappingTable.getByRole("row").filter({ hasText: "record_id" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("natural-language-governed-mapping.png"), fullPage: true });
});

test("pairwise source permutations reach deterministic mappings", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  const permutations: Array<[MatrixSource, MatrixSource]> = [
    ["upload", "refined"],
    ["upload", "existing"],
    ["paste", "refined"],
    ["paste", "existing"],
    ["aidp", "existing"],
    ["aidp", "refined"],
  ];
  for (const [left, right] of permutations) {
    const wizard = await startWizard(page, "Two-Sided Reconciliation");
    await configureMatrixSource(page, wizard.getByTestId("recon-source-SOURCE_A"), "Source A", left);
    await configureMatrixSource(page, wizard.getByTestId("recon-source-SOURCE_B"), "Source B", right);
    await assertAutoMapping(wizard);
    await page.screenshot({ path: testInfo.outputPath(`pair-${left}-${right}.png`), fullPage: true });
    await wizard.getByRole("button", { name: "Close" }).click();
    await expect(wizard).toBeHidden();
  }
});

test("remaining tri-party source permutations reach deterministic mappings", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  const permutations: Array<[MatrixSource, MatrixSource, MatrixSource]> = [
    ["upload", "refined", "existing"],
    ["paste", "refined", "existing"],
    ["upload", "paste", "refined"],
  ];
  for (const kinds of permutations) {
    const wizard = await startWizard(page, "Tri-Party Reconciliation");
    for (const [index, kind] of kinds.entries()) {
      const letter = String.fromCharCode(65 + index);
      await configureMatrixSource(
        page,
        wizard.getByTestId(`recon-source-SOURCE_${letter}`),
        `Source ${letter}`,
        kind,
      );
    }
    await assertAutoMapping(wizard);
    await page.screenshot({ path: testInfo.outputPath(`tri-${kinds.join("-")}.png`), fullPage: true });
    await wizard.getByRole("button", { name: "Close" }).click();
    await expect(wizard).toBeHidden();
  }
});
