import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_FILE_UPLOAD_UX_CAPTURE === "YES";
const slug = process.env.FVI_TENANT_SLUG ?? "";
const phase = process.env.FVI_FILE_UPLOAD_UX_PHASE === "after" ? "after" : "before";

test("File Uploads remains compact and expandable", async ({ page }, testInfo) => {
  test.skip(!enabled || !slug, "Requires retained owner state and the PROD assurance tenant slug");
  await page.goto(`/${slug}/workspace?page=data`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Data sources", { exact: true })).toBeVisible();
  if (phase === "after") {
    await expect(page.getByText(/of \d+ sources? shown/u)).toBeVisible();
    const toggles = page.getByRole("button", { name: /details for/u });
    await expect(toggles.first()).toBeVisible();
    const count = await toggles.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(10);
    await page.screenshot({
      path: testInfo.outputPath(`01-file-uploads-${phase}.png`),
      fullPage: true,
    });
    await expect(page.getByText("Detected schema")).toHaveCount(0);
    await toggles.first().click();
    await expect(page.getByText("Detected schema").first()).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("02-file-upload-expanded.png"),
      fullPage: true,
    });
    const showMore = page.getByRole("button", { name: /Show \d+ more/u });
    if (await showMore.isVisible()) {
      await showMore.click();
      await expect(page.getByTestId("data-source-card")).toHaveCount(20);
      await expect(page.getByRole("button", { name: "Show fewer" })).toBeVisible();
    }
  } else {
    await page.screenshot({
      path: testInfo.outputPath(`01-file-uploads-${phase}.png`),
      fullPage: true,
    });
  }
});
