import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const enabled = process.env.FVI_RUN_ASSURANCE_RECONS === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const fixtureDir = process.env.FVI_ASSURANCE_FIXTURE_DIR ?? "";
const reconciliationFilter = process.env.FVI_ASSURANCE_RECON_FILTER ?? "";
const evidenceRoot = path.resolve(
  "_e2e_run/owner-session/reconciliation-assurance",
  tenantSlug || "unscoped",
);
const expectedReportTotals = {
  runs: Number(process.env.FVI_ASSURANCE_EXPECTED_RUNS ?? 0),
  matched: Number(process.env.FVI_ASSURANCE_EXPECTED_MATCHES ?? 0),
  exceptions: Number(process.env.FVI_ASSURANCE_EXPECTED_EXCEPTIONS ?? 0),
};

const sources = [
  {
    name: "Assurance S1 — General ledger journal control",
    file: "s1-general-ledger-controls.csv",
    rows: 12,
  },
  { name: "Assurance S2A — Internal cash ledger", file: "s2-internal-cash-ledger.csv", rows: 6 },
  { name: "Assurance S2B — Bank nostro statement", file: "s2-bank-nostro-statement.csv", rows: 6 },
  { name: "Assurance S3A — Broker executions", file: "s3-broker-executions.csv", rows: 7 },
  { name: "Assurance S3B — Custodian settlements", file: "s3-custodian-settlements.csv", rows: 8 },
  {
    name: "Assurance S4A — Fund administrator positions",
    file: "s4-fund-admin-positions.csv",
    rows: 7,
  },
  { name: "Assurance S4B — Custodian positions", file: "s4-custodian-positions.csv", rows: 6 },
  { name: "Assurance S5A — Internal trades", file: "s5-internal-trades.csv", rows: 6 },
  { name: "Assurance S5B — Broker confirmations", file: "s5-broker-confirmations.csv", rows: 5 },
  { name: "Assurance S5C — Custodian settlement", file: "s5-custodian-settlement.csv", rows: 6 },
  {
    name: "Assurance S6A — Issuer corporate-action announcements",
    file: "s6-issuer-corporate-actions.csv",
    rows: 4,
  },
  {
    name: "Assurance S6B — Custodian entitlements",
    file: "s6-custodian-entitlements.csv",
    rows: 5,
  },
  {
    name: "Assurance S6C — Internal corporate-action accruals",
    file: "s6-internal-corporate-action-accruals.csv",
    rows: 5,
  },
  { name: "Assurance S7A — Internal FX trades", file: "s7-internal-fx-trades.csv", rows: 6 },
  {
    name: "Assurance S7B — Counterparty FX confirmations",
    file: "s7-counterparty-fx-confirmations.csv",
    rows: 6,
  },
  { name: "Assurance S8A — Broker fee invoices", file: "s8-broker-fee-invoices.csv", rows: 6 },
  { name: "Assurance S8B — Internal fee accruals", file: "s8-internal-fee-accruals.csv", rows: 5 },
  { name: "Assurance S8C — Fee payments", file: "s8-fee-payments.csv", rows: 5 },
  {
    name: "Assurance S9A — Entity A intercompany ledger",
    file: "s9-entity-a-intercompany.csv",
    rows: 6,
  },
  {
    name: "Assurance S9B — Entity B intercompany ledger",
    file: "s9-entity-b-intercompany.csv",
    rows: 5,
  },
  {
    name: "Assurance S9C — Treasury intercompany settlement",
    file: "s9-treasury-intercompany-settlement.csv",
    rows: 5,
  },
  { name: "Assurance S10A — CCP margin statement", file: "s10-ccp-margin-statement.csv", rows: 7 },
  {
    name: "Assurance S10B — Internal margin ledger",
    file: "s10-internal-margin-ledger.csv",
    rows: 9,
  },
] as const;

const reconciliations = [
  {
    name: "Assurance S1 — General ledger integrity",
    mode: "Single Side Reconciliation",
    sources: [sources[0].name],
    expectedMatches: 8,
    expectedExceptions: 4,
  },
  {
    name: "Assurance S2 — Nostro cash ledger vs bank",
    mode: "Two-Sided Reconciliation",
    sources: [sources[1].name, sources[2].name],
    expectedMatches: 4,
    expectedExceptions: 3,
  },
  {
    name: "Assurance S3 — Broker executions vs custody settlement",
    mode: "Two-Sided Reconciliation",
    sources: [sources[3].name, sources[4].name],
    expectedMatches: 3,
    expectedExceptions: 3,
  },
  {
    name: "Assurance S4 — Fund administrator vs custody positions",
    mode: "Two-Sided Reconciliation",
    sources: [sources[5].name, sources[6].name],
    expectedMatches: 3,
    expectedExceptions: 1,
  },
  {
    name: "Assurance S5 — Internal vs broker vs custodian",
    mode: "Tri-Party Reconciliation",
    sources: [sources[7].name, sources[8].name, sources[9].name],
    expectedMatches: 2,
    expectedExceptions: 7,
  },
  {
    name: "Assurance S6 — Issuer vs custodian vs internal corporate actions",
    mode: "Tri-Party Reconciliation",
    sources: [sources[10].name, sources[11].name, sources[12].name],
    expectedMatches: 2,
    expectedExceptions: 3,
  },
  {
    name: "Assurance S7 — Internal vs counterparty FX trades",
    mode: "Two-Sided Reconciliation",
    sources: [sources[13].name, sources[14].name],
    expectedMatches: 3,
    expectedExceptions: 3,
  },
  {
    name: "Assurance S8 — Broker fees vs accruals vs payments",
    mode: "Tri-Party Reconciliation",
    sources: [sources[15].name, sources[16].name, sources[17].name],
    expectedMatches: 2,
    expectedExceptions: 6,
  },
  {
    name: "Assurance S9 — Entity A vs Entity B vs Treasury intercompany",
    mode: "Tri-Party Reconciliation",
    sources: [sources[18].name, sources[19].name, sources[20].name],
    expectedMatches: 2,
    expectedExceptions: 5,
  },
  {
    name: "Assurance S10 — CCP vs internal derivatives margin",
    mode: "Two-Sided Reconciliation",
    sources: [sources[21].name, sources[22].name],
    expectedMatches: 4,
    expectedExceptions: 3,
  },
  {
    name: "Assurance S9R — Intercompany after learned sign normalization",
    mode: "Tri-Party Reconciliation",
    sources: [
      "Assurance S9A — Entity A intercompany ledger",
      "Assurance DP11 Output — Normalize intercompany counter-entry signs",
      "Assurance S9C — Treasury intercompany settlement",
    ],
    expectedMatches: 3,
    expectedExceptions: 4,
  },
] as const;

async function finishTourIfPresent(page: Page) {
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (
    await finishTour
      .waitFor({ state: "visible", timeout: 20_000 })
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
  test.skip(
    !enabled || !tenantSlug || !fixtureDir,
    "Requires the retained PROD Assurance Lab and fixture directory",
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  page.setDefaultTimeout(30_000);
  await page.addInitScript(() => localStorage.setItem("fvi-shortcuts-seen", "1"));
});

test("schedules and executes the selected Assurance Lab reconciliation", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const selected = reconciliationFilter
    ? reconciliations.filter((reconciliation) => reconciliation.name.includes(reconciliationFilter))
    : reconciliations;
  expect(
    selected.length,
    "reconciliation filter must select at least one scenario",
  ).toBeGreaterThan(0);
  const executed: Array<Record<string, unknown>> = [];

  await page.goto(`/${tenantSlug}/workspace?page=schedules`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);

  for (const reconciliation of selected) {
    const scheduleName = `${reconciliation.name} — Manual QA schedule`;
    let row = page.getByRole("row").filter({ hasText: scheduleName });
    if (
      !(await row
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByRole("button", { name: "New schedule" }).click();
      const dialog = page.getByRole("dialog", { name: "New schedule" });
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option").filter({ hasText: reconciliation.name }).click();
      await dialog.getByPlaceholder("Hourly nostro rekon").fill(scheduleName);
      await dialog.getByRole("button", { name: "Create schedule" }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      row = page.getByRole("row").filter({ hasText: scheduleName });
    }

    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Run now" }).click();
    await expect(
      page.getByText(
        `Ran: ${reconciliation.expectedMatches} matched · ${reconciliation.expectedExceptions} exceptions`,
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("OK", { exact: true })).toBeVisible({ timeout: 20_000 });
    console.log(
      `[assurance-recon] executed ${reconciliation.name}: ${reconciliation.expectedMatches} matched, ${reconciliation.expectedExceptions} exceptions`,
    );
    executed.push({
      reconciliation: reconciliation.name,
      matched_groups: reconciliation.expectedMatches,
      exceptions: reconciliation.expectedExceptions,
    });
  }

  const evidenceDir = evidenceRoot;
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDir, "s1-s10-schedules-and-latest-results.png"),
    fullPage: true,
  });
  await writeFile(
    path.join(evidenceDir, "s1-s10-browser-reprocessing-evidence.json"),
    `${JSON.stringify({ executed }, null, 2)}\n`,
    "utf8",
  );
});

test("investigates and resolves the retained S2 fee break", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  test.skip(reconciliationFilter !== "S2", "Run this controlled mutation only with the S2 filter");

  await page.goto(`/${tenantSlug}/workspace?page=breaks`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);
  const shortcutDialog = page.getByRole("dialog", { name: "Break Manager shortcuts" });
  if (await shortcutDialog.isVisible().catch(() => false)) await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page
    .getByPlaceholder(/Search reason, root cause, recon/u)
    .fill("Assurance S2 — Nostro cash ledger vs bank");

  const reason = page.getByText(/^Sum mismatch for key .*NOSTRO-1003:/u).first();
  await expect(reason).toBeVisible({ timeout: 20_000 });
  await reason.click();

  const detail = page.getByRole("dialog", { name: /^Sum mismatch for key .*NOSTRO-1003:/u });
  await expect(detail).toBeVisible();
  const alreadyResolved = await detail
    .getByRole("combobox")
    .nth(0)
    .getByText("Resolved", { exact: true })
    .isVisible()
    .catch(() => false);
  if (alreadyResolved) {
    const auditComment =
      "Post-resolution control check completed; fee evidence and tenant audit linkage verified.";
    await detail
      .getByText(/Fee verified against|Post-resolution control check|No comments yet/u)
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    if (
      !(await detail
        .getByText(auditComment, { exact: true })
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      await detail.getByPlaceholder(/Confirmed with Falcon Treasury/u).fill(auditComment);
      await detail.getByRole("button", { name: "Post", exact: true }).click();
      await expect(detail.getByText(auditComment, { exact: true })).toBeVisible({
        timeout: 20_000,
      });
    }

    const notesGrid = detail
      .getByText("Notes grid", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]");
    const noteText = "USD 25 correspondent fee recorded as the reconciling item.";
    const noteInputs = notesGrid.locator(
      'input[placeholder="Investigation note for Falcon Bank…"]',
    );
    let noteExists = false;
    for (let index = 0; index < (await noteInputs.count()); index += 1) {
      if ((await noteInputs.nth(index).inputValue()) === noteText) noteExists = true;
    }
    if (!noteExists) {
      await notesGrid.getByRole("button", { name: "Row", exact: true }).click();
      const noteRow = notesGrid.getByRole("row").last();
      await noteRow.locator("select").nth(0).selectOption("fees");
      await noteRow.locator("select").nth(1).selectOption("resolved");
      await noteRow.locator('input[type="number"]').fill("25");
      await noteRow
        .locator('input[placeholder="Investigation note for Falcon Bank…"]')
        .fill(noteText);
      await notesGrid.getByRole("button", { name: "Save all", exact: true }).click();
      await expect(page.getByText("Saved 1 note", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
    }

    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await expect(detail).toBeHidden();
    return;
  }
  await chooseOption(page, detail.getByRole("combobox").nth(0), "Investigating");
  await expect(page.getByText("Updated", { exact: true }).last()).toBeVisible();
  await chooseOption(page, detail.getByRole("combobox").nth(1), "P1");
  await expect(page.getByText("Updated", { exact: true }).last()).toBeVisible();

  const rootCause = "Bank deducted a USD 25 correspondent fee from the incoming client receipt.";
  await detail.getByPlaceholder("Describe root cause").fill(rootCause);
  await detail.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Updated", { exact: true }).last()).toBeVisible();

  const comment =
    "Fee verified against the bank statement. Book a USD 25 charge and retain this break for audit review.";
  await detail.getByPlaceholder(/Confirmed with Falcon Treasury/u).fill(comment);
  await detail.getByRole("button", { name: "Post", exact: true }).click();
  await expect(detail.getByText(comment, { exact: true })).toBeVisible({ timeout: 20_000 });

  await detail.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByText("Updated", { exact: true }).last()).toBeVisible();
  await expect(
    detail.getByRole("combobox").nth(0).getByText("Resolved", { exact: true }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(detail).toBeHidden();
});

test("reviews representative retained breaks across S6 through S10", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  test.skip(
    reconciliationFilter !== "BREAK-MATRIX",
    "Run break-matrix evidence only with the BREAK-MATRIX filter",
  );
  const evidenceDir = path.join(evidenceRoot, "break-matrix");
  await mkdir(evidenceDir, { recursive: true });
  await page.goto(`/${tenantSlug}/workspace?page=breaks`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);
  const shortcutDialog = page.getByRole("dialog", { name: "Break Manager shortcuts" });
  if (await shortcutDialog.isVisible().catch(() => false)) await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "Kanban", exact: true }).click();

  const cases = [
    [
      "Assurance S6 — Issuer vs custodian vs internal corporate actions",
      /Sum mismatch for key .*CA-6003:/u,
      "s6-corporate-action-break.png",
    ],
    [
      "Assurance S7 — Internal vs counterparty FX trades",
      /Sum mismatch for key .*FX-7004:/u,
      "s7-fx-break.png",
    ],
    [
      "Assurance S8 — Broker fees vs accruals vs payments",
      /Sum mismatch for key .*FEE-8005:/u,
      "s8-fee-break.png",
    ],
    [
      "Assurance S9 — Entity A vs Entity B vs Treasury intercompany",
      /Sum mismatch for key .*IC-9003:/u,
      "s9-intercompany-break.png",
    ],
    [
      "Assurance S10 — CCP vs internal derivatives margin",
      /Sum mismatch for key .*MAR-10005:/u,
      "s10-margin-break.png",
    ],
  ] as const;

  for (const [reconciliation, reasonPattern, screenshot] of cases) {
    const search = page.getByPlaceholder(/Search reason, root cause, recon/u);
    await search.fill(reconciliation);
    const reason = page.getByText(reasonPattern).first();
    await expect(reason).toBeVisible({ timeout: 20_000 });
    await reason.locator("xpath=ancestor::div[contains(@class,'cursor-pointer')][1]").click();
    const detail = page.getByRole("dialog").last();
    await expect(detail).toBeVisible();
    await expect(detail.getByText(reasonPattern).first()).toBeVisible();
    await expect(detail.getByText("Notes grid", { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Resolve", exact: true })).toBeVisible();
    await detail.screenshot({ path: path.join(evidenceDir, screenshot) });
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await expect(detail).toBeHidden();
  }
});

test("classifies, documents, and resolves one retained S8 fee break", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  test.skip(
    reconciliationFilter !== "S8-BREAK",
    "Run this controlled mutation only with the S8-BREAK filter",
  );
  await page.goto(`/${tenantSlug}/workspace?page=breaks`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);
  const shortcutDialog = page.getByRole("dialog", { name: "Break Manager shortcuts" });
  if (await shortcutDialog.isVisible().catch(() => false)) await page.keyboard.press("Escape");
  await page
    .getByPlaceholder(/Search reason, root cause, recon/u)
    .fill("Assurance S8 — Broker fees vs accruals vs payments");
  const reasonPattern = /Sum mismatch for key .*FEE-8005:/u;
  const reason = page.getByText(reasonPattern).first();
  await expect(reason).toBeVisible({ timeout: 20_000 });
  await reason.locator("xpath=ancestor::div[contains(@class,'cursor-pointer')][1]").click();
  const detail = page.getByRole("dialog").last();
  await expect(detail).toBeVisible();
  await expect(detail.getByText(reasonPattern).first()).toBeVisible();

  const isResolved = await detail
    .getByRole("combobox")
    .nth(0)
    .getByText("Resolved", { exact: true })
    .isVisible()
    .catch(() => false);
  if (!isResolved) {
    await chooseOption(page, detail.getByRole("combobox").nth(0), "Investigating");
    await chooseOption(page, detail.getByRole("combobox").nth(1), "P1");
    const rootCause =
      "Broker invoice exceeded both the approved accrual and settled payment by USD 2,000.";
    await detail.getByPlaceholder("Describe root cause").fill(rootCause);
    await detail.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Updated", { exact: true }).last()).toBeVisible();

    const comment =
      "Validated invoice, accrual, and payment evidence. The USD 2,000 excess requires broker credit-note recovery.";
    await detail.getByPlaceholder(/Confirmed with Falcon Treasury/u).fill(comment);
    await detail.getByRole("button", { name: "Post", exact: true }).click();
    await expect(detail.getByText(comment, { exact: true })).toBeVisible({ timeout: 20_000 });

    const notesGrid = detail
      .getByText("Notes grid", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]");
    await notesGrid.getByRole("button", { name: "Row", exact: true }).click();
    const noteRow = notesGrid.getByRole("row").last();
    await noteRow.locator("select").nth(0).selectOption("fees");
    await noteRow.locator("select").nth(1).selectOption("resolved");
    await noteRow.locator('input[type="number"]').fill("2000");
    await noteRow
      .locator('input[placeholder="Investigation note for Falcon Bank…"]')
      .fill("Credit-note receivable recorded for the invoice-to-accrual variance.");
    await notesGrid.getByRole("button", { name: "Save all", exact: true }).click();
    await expect(page.getByText("Saved 1 note", { exact: true })).toBeVisible({ timeout: 20_000 });

    await detail.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(page.getByText("Updated", { exact: true }).last()).toBeVisible();
  }
  await expect(
    detail.getByRole("combobox").nth(0).getByText("Resolved", { exact: true }),
  ).toBeVisible();
  await detail.screenshot({
    path: path.join(evidenceRoot, "break-matrix", "s8-resolved-fee-break.png"),
  });
});

test("validates every Reports tab and retained Assurance exports", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  test.skip(reconciliationFilter !== "REPORTS", "Run report evidence only with the REPORTS filter");

  await page.goto(`/${tenantSlug}/workspace?page=reports`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);
  await expect(page.getByText("Flight-Deck Analytics", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const tabs = [
    ["Operations", "Runs"],
    ["Match rates", "Match rate over time"],
    ["Trend analysis", "Exceptions WoW"],
    ["Risk", "Top root causes"],
    ["AI usage", "Total spend"],
    ["Security", "Security events"],
    ["Compliance", "Control readiness"],
    ["Audit", "Audit events"],
    ["Custom", "Custom report builder"],
  ] as const;
  for (const [tab, evidence] of tabs) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByText(evidence, { exact: true }).first()).toBeVisible();
  }

  const evidenceDir = path.resolve("_e2e_run/owner-session/downloads/assurance-lab", tenantSlug);
  await mkdir(evidenceDir, { recursive: true });

  const [brief] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export brief", exact: true }).click(),
  ]);
  const briefPath = await brief.path();
  expect(briefPath).toBeTruthy();
  const report = JSON.parse(await readFile(briefPath!, "utf8"));
  expect(report).toHaveLength(1);
  expect(expectedReportTotals.runs).toBeGreaterThan(0);
  expect(report[0].operations).toMatchObject(expectedReportTotals);
  await brief.saveAs(path.join(evidenceDir, brief.suggestedFilename()));

  await page.getByRole("tab", { name: "Operations", exact: true }).click();
  const [operationsCsv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "CSV", exact: true }).click(),
  ]);
  const csvPath = await operationsCsv.path();
  expect(csvPath).toBeTruthy();
  const csv = await readFile(csvPath!, "utf8");
  expect(csv).toMatch(/matched|exceptions|runs/iu);
  await operationsCsv.saveAs(path.join(evidenceDir, operationsCsv.suggestedFilename()));

  await page.getByRole("tab", { name: "Custom", exact: true }).click();
  await page.getByLabel("Report title").fill("Assurance Lab reconciliation controls");
  const [customJson] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "JSON", exact: true }).last().click(),
  ]);
  const customPath = await customJson.path();
  expect(customPath).toBeTruthy();
  const custom = JSON.parse(await readFile(customPath!, "utf8"));
  expect(custom[0]).toMatchObject({
    title: "Assurance Lab reconciliation controls",
    window_days: 30,
  });
  expect(custom[0].metrics.length).toBeGreaterThan(0);
  await customJson.saveAs(path.join(evidenceDir, customJson.suggestedFilename()));
});

test("uploads and previews twenty-three production-realistic source files", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await page.goto(`/${tenantSlug}/workspace?page=data`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);

  for (const source of sources) {
    let card = sourceCard(page, source.name);
    const exists = await card
      .waitFor({ state: "attached", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      await page.getByRole("button", { name: "New data source" }).click();
      const dialog = page.getByRole("dialog", { name: "New data source" });
      await dialog.getByPlaceholder("Bank statement — Falcon Nostro USD (Citi)").fill(source.name);
      await dialog
        .getByPlaceholder("Daily Falcon Nostro USD feed from Citi, T-1 settlement.")
        .fill(
          "Synthetic Assurance Lab source using public financial-industry message and reporting conventions.",
        );
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      card = sourceCard(page, source.name);
    }

    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    const fileInput = card.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
    await fileInput.setInputFiles(path.join(fixtureDir, source.file));
    await expect(card.getByText(`${source.rows} rows · 14 columns`, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(card.getByText(/ready|uploaded/iu).first()).toBeVisible();
  }
});

test("creates eleven governed reconciliation definitions through every wizard mode", async ({
  page,
}) => {
  test.setTimeout(15 * 60_000);
  await page.goto(`/${tenantSlug}/workspace?page=recons`, { waitUntil: "domcontentloaded" });
  await finishTourIfPresent(page);
  await expect(
    page.locator("#main-content").getByText("Rekon Studio", { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });

  const selected = reconciliationFilter
    ? reconciliations.filter((reconciliation) => reconciliation.name.includes(reconciliationFilter))
    : reconciliations;
  expect(
    selected.length,
    "reconciliation filter must select at least one scenario",
  ).toBeGreaterThan(0);

  for (const reconciliation of selected) {
    console.log(`[assurance-recon] start ${reconciliation.name}`);
    const existing = page.getByText(reconciliation.name, { exact: true }).first();
    if (
      await existing
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      console.log(`[assurance-recon] retained ${reconciliation.name}`);
      continue;
    }

    await page.getByRole("button", { name: "New reconciliation" }).click();
    const modeDialog = page.getByRole("dialog", { name: "New Reconciliation" });
    const modeCard = modeDialog
      .locator("div.rounded-xl")
      .filter({ hasText: reconciliation.mode })
      .first();
    await modeCard.getByRole("button", { name: "Select", exact: true }).click();
    console.log(`[assurance-recon] selected mode ${reconciliation.mode}`);

    const wizard = page.getByRole("dialog").filter({ hasText: reconciliation.mode });
    await expect(wizard).toBeVisible();
    for (const [index, sourceName] of reconciliation.sources.entries()) {
      const sideLabel = `Source ${String.fromCharCode(65 + index)}`;
      const card = wizard.locator("div.rounded-xl").filter({ hasText: sideLabel }).first();
      await card.getByRole("button", { name: "EXISTING DATA", exact: true }).click();
      await chooseOption(page, card.getByRole("combobox"), sourceName);
      await expect(card.getByText(/14 cols · \d+ rows/u)).toBeVisible({ timeout: 20_000 });
      await card.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(card.getByText(/Showing \d+ of \d+ rows/u)).toBeVisible();
      await card.getByRole("button", { name: "Hide", exact: true }).click();
      await card.getByRole("button", { name: "Test connection", exact: true }).click();
      await expect(card.getByText(/Linked · \d+ historical upload/u)).toBeVisible();
      console.log(`[assurance-recon] source ready ${sourceName}`);
    }

    await wizard.getByText("Manually Configure", { exact: true }).first().click();
    const mappingTable = wizard.locator("table").filter({ hasText: "Canonical" });
    for (const field of [
      "record_id",
      "group_id",
      "scenario",
      "value_date",
      "currency",
      "amount",
      "reference",
    ]) {
      const row = mappingTable.getByRole("row").filter({ hasText: field });
      const selectors = row.getByRole("combobox");
      for (let sideIndex = 1; sideIndex < reconciliation.sources.length; sideIndex += 1) {
        await chooseOption(page, selectors.nth(sideIndex), field);
      }
    }
    await mappingTable
      .getByRole("row")
      .filter({ hasText: "group_id" })
      .getByRole("checkbox")
      .check();
    console.log(`[assurance-recon] mappings ready ${reconciliation.name}`);

    const mappingControls = wizard
      .locator("div.grid.grid-cols-2")
      .filter({ hasText: "Amount field" });
    await chooseOption(page, mappingControls.getByRole("combobox").nth(0), "amount");
    await chooseOption(page, mappingControls.getByRole("combobox").nth(1), "value_date");

    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard.getByText(/Review Results|Run Validation/u, { exact: true })).toBeVisible();
    await wizard.getByRole("button", { name: "Continue" }).click();
    await wizard.getByPlaceholder("e.g. Daily Custody vs Ledger").fill(reconciliation.name);
    await wizard.getByRole("button", { name: "Save as draft" }).click();
    await expect(wizard).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(reconciliation.name, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    console.log(`[assurance-recon] saved ${reconciliation.name}`);
  }
});
