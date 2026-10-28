import { expect, test } from "@playwright/test";
import path from "node:path";

const enabled = process.env.FVI_RUN_SWIFT_PARSER === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const fixture =
  process.env.FVI_E2E_SWIFT_FILE ??
  "outputs/fvi-e2e-validation-20260904/swift-mt940-validation.txt";

test("platform owner parses and deduplicates a retained SWIFT MT940 file", async ({ page }) => {
  test.skip(
    !enabled || !tenantSlug,
    "Requires FVI_RUN_SWIFT_PARSER=YES and the DEV validation tenant",
  );

  await page.goto(`/${tenantSlug}/workspace?page=ingest`, { waitUntil: "domcontentloaded" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (
    await finishTour
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await finishTour.click();
    await expect(page.locator(".driver-overlay")).toBeHidden();
  }

  await expect(page.getByText(/Native parsers — SWIFT MT/u)).toBeVisible({ timeout: 20_000 });
  const fileInput = page.locator("#parser-file");
  await fileInput.setInputFiles(path.resolve(fixture));
  await page.getByRole("button", { name: "Parse file" }).click();
  await expect(
    page.getByText(/(?:Parsed \d+ messages? as swift_mt|Already parsed — \d+ messages)/u),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("swift-mt940-validation.txt", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("succeeded", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Parse file" }).click();
  await expect(page.getByText(/Already parsed — \d+ messages/u)).toBeVisible({ timeout: 30_000 });
});
