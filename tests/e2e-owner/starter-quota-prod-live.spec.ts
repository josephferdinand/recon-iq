import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RUN_STARTER_QUOTA_PROOF === "YES";
const origin = process.env.FVI_E2E_BASE_URL ?? "";
if (enabled && origin !== "https://app.reconiq.example") {
  throw new Error("This retained synthetic proof is restricted to canonical FVI PROD");
}
test.skip(!enabled, "Set FVI_RUN_STARTER_QUOTA_PROOF=YES with the protected QA session");
test.use({ channel: "chrome", viewport: { width: 1440, height: 960 }, trace: "off", video: "off" });

test("the retained Starter runs normally through the repaired authenticated quota gate", async ({
  page,
}, testInfo) => {
  await page.addLocatorHandler(page.locator(".driver-popover-close-btn"), async (close) =>
    close.click(),
  );
  await page.goto("/reconiq-assurance-lab-prod/workspace?page=recons");
  const heading = page.getByRole("heading", {
    name: "Assurance Starter Vostro — 2026-09-15 QA",
    exact: true,
  });
  await expect(heading).toBeVisible();
  const card = page.locator("div.rounded-lg.border.p-4").filter({ has: heading });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("FVI-GEN-2WAY-000009");
  await expect(card).toContainText("2 side(s) · 7 rule(s)");

  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === origin &&
        (response.request().postData() ?? "").includes("c939558c-23cf-4ffe-bf48-558cbb2ef457"),
    ),
    card.getByRole("button", { name: "Run", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.headers()["retry-after"]).toBeUndefined();
  expect(response.headers()["x-fvi-rate-limit-error"]).toBeUndefined();
  await expect(
    page.getByText("Run complete · 6 matched, 5 exceptions", { exact: true }),
  ).toBeVisible();
  await testInfo.attach("governed-run-response", {
    body: JSON.stringify({
      method: "POST",
      path: new URL(response.url()).pathname,
      status: response.status(),
    }),
    contentType: "application/json",
  });
  await page.screenshot({ path: testInfo.outputPath("starter-run-through-quota.png") });
});
