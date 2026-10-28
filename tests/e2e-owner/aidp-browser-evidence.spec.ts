import { expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const enabled = process.env.FVI_RUN_AIDP_BROWSER_EVIDENCE === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const documentId = process.env.FVI_AIDP_DOCUMENT_ID ?? "";
const filename = process.env.FVI_AIDP_FILENAME ?? "fvi-assurance-bank-statement.png";

test("shows the provider-backed AIDP extraction and audit timeline", async ({ page }) => {
  test.skip(!enabled || !tenantSlug || !documentId, "Requires retained PROD AIDP evidence IDs");
  const evidenceDir = path.resolve("_e2e_run/owner-session/aidp-assurance", tenantSlug);
  await mkdir(evidenceDir, { recursive: true });

  await page.goto(`/${tenantSlug}/workspace?page=aidp`, { waitUntil: "domcontentloaded" });
  const row = page.getByRole("row").filter({ hasText: filename }).first();
  await expect(row).toContainText("review");
  await expect(row.getByRole("button", { name: "Audit" })).toBeVisible();
  if (filename.toLowerCase().endsWith(".pdf")) {
    await expect(row.getByRole("link", { name: "Annotate" })).toBeVisible();
  }
  await page.screenshot({ path: path.join(evidenceDir, "provider-backed-aidp-document.png"), fullPage: true });

  await row.getByRole("button", { name: "Audit" }).click();
  await expect(page.getByRole("heading", { name: "Extraction audit timeline" })).toBeVisible();
  await expect(page.getByText("Document uploaded")).toBeVisible();
  await expect(page.getByText("Model prediction")).toBeVisible();
  await expect(page.getByText(/confidence (?:9[5-9]|100)%/i)).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "provider-backed-aidp-audit.png"), fullPage: true });
});
