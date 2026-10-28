import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RUN_HYDRATION_CONSOLE === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";

test("representative authenticated routes remain mounted without React hydration errors", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!enabled || !tenantSlug, "Requires retained authenticated tenant state");
  let hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/hydration|react error #?418|minified react error 418/i.test(text)) hydrationErrors.push(text);
  });
  page.on("pageerror", (error) => {
    if (/hydration|react error #?418|minified react error 418/i.test(error.message)) {
      hydrationErrors.push(error.message);
    }
  });

  const routes = [
    `/${tenantSlug}/workspace`,
    `/${tenantSlug}/tenant`,
    `/${tenantSlug}/tenant/admin`,
    `/${tenantSlug}/recon/evidence`,
    "/profile",
    "/platform",
  ];
  for (const route of routes) {
    hydrationErrors = [];
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body"), `${route} body before hydration`).toBeVisible();
    await page.waitForTimeout(5_000);
    await expect(page.locator("body"), `${route} body after hydration`).toBeVisible();
    expect(hydrationErrors, `${route} hydration errors`).toEqual([]);
  }
});
