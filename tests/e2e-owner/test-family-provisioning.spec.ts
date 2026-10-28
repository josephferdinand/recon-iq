import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_PROVISION_TEST_FAMILY === "YES";
const familyName = process.env.FVI_TEST_TENANT_FAMILY ?? "ReconIQ Assurance Group";

test("platform owner provisions a persistent validation family", async ({ page }, testInfo) => {
  test.skip(!enabled, "Requires FVI_PROVISION_TEST_FAMILY=YES");

  await page.goto("/platform?page=families", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/u);

  const existing = page.getByText(familyName, { exact: true }).first();
  if (
    await existing
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await page.screenshot({ path: testInfo.outputPath("validation-family-existing.png") });
    return;
  }

  await page.getByRole("button", { name: "New family" }).click();
  const dialog = page.getByRole("dialog", { name: "Create family" });
  await dialog.getByPlaceholder("Falcon Bank NA").fill(familyName);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(familyName, { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.screenshot({ path: testInfo.outputPath("validation-family-created.png") });
});
