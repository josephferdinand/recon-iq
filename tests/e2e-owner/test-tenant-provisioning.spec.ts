import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_PROVISION_TEST_TENANT === "YES";
const tenantName = process.env.FVI_TEST_TENANT_NAME ?? "FVI Validation Lab 2026-09-04";
const tenantSlug = process.env.FVI_TEST_TENANT_SLUG ?? "fvi-validation-lab-20260904";
const familyName = process.env.FVI_TEST_TENANT_FAMILY ?? "Acme Bank Family";
const tenantEnvironment = process.env.FVI_TEST_TENANT_ENV ?? "dev";

test("platform owner provisions a persistent validation tenant", async ({ page }, testInfo) => {
  test.skip(!enabled, "Requires FVI_PROVISION_TEST_TENANT=YES");

  await page.addInitScript(() => {
    const key = "fvi.prefs.v1";
    const current = JSON.parse(localStorage.getItem(key) || "{}");
    current.tourSeen = { ...(current.tourSeen ?? {}), "pl.tenants": true };
    current.tourProgress = { ...(current.tourProgress ?? {}) };
    delete current.tourProgress["pl.tenants"];
    localStorage.setItem(key, JSON.stringify(current));
  });

  await page.goto("/platform?page=tenants", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/u);

  const guidedTourOverlay = page.locator(".driver-overlay");
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (
    await finishTour
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await finishTour.click();
    await expect(guidedTourOverlay).toBeHidden();
  }

  const existingTenant = page.getByText(tenantName, { exact: true });
  if (
    await existingTenant
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await page.screenshot({
      path: testInfo.outputPath("validation-tenant-existing.png"),
      fullPage: true,
    });
    return;
  }

  if (await guidedTourOverlay.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(guidedTourOverlay).toBeHidden();
  }

  await page.getByRole("button", { name: "New tenant" }).click();
  const dialog = page.getByRole("dialog", { name: "Create tenant" });
  await expect(dialog).toBeVisible();
  if (await guidedTourOverlay.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(guidedTourOverlay).toBeHidden();
  }

  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: familyName, exact: true }).click();
  await dialog.getByPlaceholder("Falcon Bank — Production").fill(tenantName);
  await dialog.getByPlaceholder("falconbank-prod").fill(tenantSlug);
  await dialog.getByRole("combobox").nth(1).click();
  const environmentLabel =
    tenantEnvironment === "prod" ? "Production" : tenantEnvironment === "uat" ? "UAT" : "Dev";
  await page.getByRole("option", { name: environmentLabel, exact: true }).click();
  await dialog.getByRole("switch").click();
  await dialog.getByRole("button", { name: "Create tenant", exact: true }).click();

  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(tenantName, { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.screenshot({
    path: testInfo.outputPath("validation-tenant-created.png"),
    fullPage: true,
  });
});
