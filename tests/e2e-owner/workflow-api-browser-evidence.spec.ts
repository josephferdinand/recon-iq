import { expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const enabled = process.env.FVI_RUN_WORKFLOW_API_BROWSER_EVIDENCE === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const dataPrepRunUid = process.env.FVI_WORKFLOW_API_DATA_PREP_RUN_UID ?? "";
const reconRunPrefix = process.env.FVI_WORKFLOW_API_RECON_RUN_PREFIX ?? "";

test("shows API-created Data Prep and reconciliation runs in the authenticated UI", async ({ page }) => {
  test.skip(!enabled || !tenantSlug || !dataPrepRunUid || !reconRunPrefix, "Requires retained workflow API run IDs");
  const evidenceDir = path.resolve("_e2e_run/owner-session/workflow-api-assurance");
  await mkdir(evidenceDir, { recursive: true });

  await page.goto(`/${tenantSlug}/workspace?page=prep`, { waitUntil: "domcontentloaded" });
  const prepRow = page.getByRole("row").filter({ hasText: dataPrepRunUid });
  await expect(prepRow).toContainText("Assurance DP1 — Normalize Nostro internal cash ledger");
  await expect(prepRow).toContainText("success");
  await expect(prepRow).toContainText("6 → 6");
  await expect(prepRow).toContainText("0 failures");
  await page.screenshot({ path: path.join(evidenceDir, "api-created-data-prep-run.png"), fullPage: true });

  await page.goto(`/${tenantSlug}/workspace?page=runs`, { waitUntil: "domcontentloaded" });
  const reconRow = page.getByRole("row").filter({ hasText: reconRunPrefix });
  await expect(reconRow).toContainText("Assurance S2 — Nostro cash ledger vs bank");
  await expect(reconRow).toContainText("completed");
  await expect(reconRow.getByRole("cell").nth(3)).toHaveText("4");
  await expect(reconRow.getByRole("cell").nth(4)).toHaveText("3");
  await expect(reconRow.getByRole("cell").nth(5)).toHaveText("12");
  await page.screenshot({ path: path.join(evidenceDir, "api-created-reconciliation-run.png"), fullPage: true });
});
