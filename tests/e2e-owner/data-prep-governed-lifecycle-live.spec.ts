import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const enabled = process.env.FVI_DATA_PREP_LIFECYCLE_BROWSER === "YES";
const baseURL = process.env.FVI_E2E_BASE_URL ?? "";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const tenantId = process.env.FVI_E2E_TENANT_ID ?? "";
const makerState = process.env.FVI_DATA_PREP_MAKER_STATE ?? "";
const checkerState = process.env.FVI_DATA_PREP_CHECKER_STATE ?? "";
const pipelineName =
  process.env.FVI_DATA_PREP_PIPELINE_NAME ??
  "Assurance | PROD | Data Prep Governed Lifecycle | 2026-09-08";
const stagingName = `${pipelineName} (staging)`;
const sourceName = "Assurance S2A — Internal cash ledger";
const outputName = "Assurance DP1 Output — Normalized Nostro internal cash ledger";

async function preparePage(context: BrowserContext) {
  const page = await context.newPage();
  await page.addInitScript((id) => {
    const key = "fvi.prefs.v1";
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    current.tourSeen = {
      ...(current.tourSeen ?? {}),
      "ws.prep": true,
      [`workspace-${id}-v2`]: true,
    };
    localStorage.setItem(key, JSON.stringify(current));
  }, tenantId);
  await page.goto(`/${tenantSlug}/workspace?page=prep`, { waitUntil: "networkidle" });
  return page;
}

async function chooseOption(page: Page, trigger: Locator, name: string) {
  await trigger.click();
  await page.getByRole("option", { name, exact: true }).click();
}

function pipelineRow(page: Page, name: string) {
  const matches = page.locator("table").first().getByRole("row").filter({ hasText: name });
  return name === pipelineName
    ? matches.filter({ hasNotText: "(staging)" }).first()
    : matches.first();
}

test("maker/checker approve, stage and promote a retained Data Prep pipeline", async ({
  browser,
}, testInfo) => {
  test.setTimeout(5 * 60_000);
  test.skip(
    !enabled || !baseURL || !tenantSlug || !tenantId || !makerState || !checkerState,
    "Requires retained PROD maker/checker states",
  );
  const makerContext = await browser.newContext({
    baseURL,
    storageState: path.resolve(makerState),
  });
  const checkerContext = await browser.newContext({
    baseURL,
    storageState: path.resolve(checkerState),
  });
  try {
    const maker = await preparePage(makerContext);
    let production = pipelineRow(maker, pipelineName);
    if (!(await production.isVisible().catch(() => false))) {
      await maker.getByRole("button", { name: "New pipeline" }).click();
      const dialog = maker.getByRole("dialog").filter({ hasText: "New pipeline" });
      await dialog.locator("input").first().fill(pipelineName);
      await dialog
        .locator("textarea")
        .first()
        .fill("Retained maker/checker, staging and promotion assurance pipeline.");
      await chooseOption(maker, dialog.getByRole("combobox").nth(1), sourceName);
      await chooseOption(maker, dialog.getByRole("combobox").nth(2), outputName);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      production = pipelineRow(maker, pipelineName);
    }
    await expect(production).toBeVisible();
    if (
      await production
        .getByRole("button", { name: "Approve", exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      await production.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(maker.getByText(/pipeline maker cannot approve/iu)).toBeVisible();
    }

    const checker = await preparePage(checkerContext);
    production = pipelineRow(checker, pipelineName);
    if (
      await production
        .getByRole("button", { name: "Approve", exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      await production.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(checker.getByText(/^Approved · DP-/u)).toBeVisible({ timeout: 30_000 });
    }
    await expect(production.getByText("Approved", { exact: true })).toBeVisible();

    await maker.reload({ waitUntil: "networkidle" });
    production = pipelineRow(maker, pipelineName);
    if (
      !(await pipelineRow(maker, stagingName)
        .isVisible()
        .catch(() => false))
    ) {
      await production.getByRole("button", { name: "Clone as staging" }).click();
      await expect(maker.getByText(/^Staging copy created · DP-/u)).toBeVisible({
        timeout: 30_000,
      });
    }
    let staging = pipelineRow(maker, stagingName);
    await expect(staging).toBeVisible();
    if (
      await staging
        .getByText("Archived", { exact: true })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await maker.screenshot({
        path: testInfo.outputPath("data-prep-governed-promotion-retained.png"),
        fullPage: true,
      });
      return;
    }
    if (
      await staging
        .getByRole("button", { name: "Approve", exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      await staging.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(maker.getByText(/pipeline maker cannot approve/iu)).toBeVisible();
    }

    await checker.reload({ waitUntil: "networkidle" });
    staging = pipelineRow(checker, stagingName);
    if (
      await staging
        .getByRole("button", { name: "Approve", exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      await staging.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(checker.getByText(/^Approved · DP-/u)).toBeVisible({ timeout: 30_000 });
    }

    await maker.reload({ waitUntil: "networkidle" });
    staging = pipelineRow(maker, stagingName);
    if (
      !(await staging
        .getByText("Promotion pending", { exact: true })
        .isVisible()
        .catch(() => false))
    ) {
      await staging.getByRole("button", { name: "Promote", exact: true }).click();
      const promotion = maker.getByRole("dialog", { name: "Request promotion" });
      await promotion
        .getByPlaceholder(/Loosened Falcon Nostro USD tolerance/u)
        .fill("Retained governed promotion after independent staging approval.");
      await promotion.getByRole("button", { name: "Request promotion", exact: true }).click();
      await expect(
        maker.getByText("Promotion requested — awaiting a second admin", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
    }
    staging = pipelineRow(maker, stagingName);
    await staging.getByTitle("Approve promotion (must be different admin)").click();
    await expect(maker.getByText(/promotion requester cannot decide/iu)).toBeVisible();

    await checker.reload({ waitUntil: "networkidle" });
    staging = pipelineRow(checker, stagingName);
    await staging.getByTitle("Approve promotion (must be different admin)").click();
    await expect(checker.getByText("Promoted to production", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      pipelineRow(checker, stagingName).getByText("Archived", { exact: true }).first(),
    ).toBeVisible();
    await checker.screenshot({
      path: testInfo.outputPath("data-prep-governed-promotion.png"),
      fullPage: true,
    });
  } finally {
    await makerContext.close();
    await checkerContext.close();
  }
});
