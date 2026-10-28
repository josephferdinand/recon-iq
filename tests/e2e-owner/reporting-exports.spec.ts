import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const enabled = process.env.FVI_RUN_REPORT_EXPORTS === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";

test("retained DEV reconciliation results flow into browser reports and exports", async ({ page }) => {
  test.skip(!enabled || !tenantSlug, "Requires FVI_RUN_REPORT_EXPORTS=YES and the DEV validation tenant");

  await page.goto(`/${tenantSlug}/workspace?page=reports`, { waitUntil: "domcontentloaded" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (await finishTour.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)) {
    await finishTour.click();
    await expect(page.locator(".driver-overlay")).toBeHidden();
  }

  await expect(page.getByText("Flight-Deck Analytics", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Runs", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Match rates", { exact: true })).toBeVisible();

  const evidenceDir = path.resolve("_e2e_run/owner-session/downloads");
  await mkdir(evidenceDir, { recursive: true });
  const [brief] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export brief" }).click(),
  ]);
  expect(brief.suggestedFilename()).toMatch(/^fvi-reports-30d-\d{4}-\d{2}-\d{2}\.json$/u);
  const briefPath = await brief.path();
  expect(briefPath).toBeTruthy();
  const report = JSON.parse(await readFile(briefPath!, "utf8"));
  expect(report).toHaveLength(1);
  expect(report[0].operations).toMatchObject({ runs: 3, matched: 8, exceptions: 6 });
  await brief.saveAs(path.join(evidenceDir, brief.suggestedFilename()));

  const [operationsCsv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "CSV", exact: true }).first().click(),
  ]);
  const csvPath = await operationsCsv.path();
  expect(csvPath).toBeTruthy();
  const csv = await readFile(csvPath!, "utf8");
  expect(csv).toMatch(/matched|exceptions|runs/iu);
  await operationsCsv.saveAs(path.join(evidenceDir, operationsCsv.suggestedFilename()));
});
