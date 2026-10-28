import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RUN_BREAK_WRITE_OFF_UI === "YES";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const reconName = process.env.FVI_E2E_RECON_NAME ?? "Assurance S8 — Broker fees vs accruals vs payments";

test("live Break Manager routes write-off through independent approval", async ({ page }) => {
  test.skip(!enabled || !tenantSlug, "Requires authenticated Assurance Lab state and explicit UI gate");
  await page.addInitScript(() => localStorage.setItem("fvi-shortcuts-seen", "1"));
  await page.goto(`/${tenantSlug}/workspace?page=breaks`, { waitUntil: "domcontentloaded" });
  const finishTour = page.getByRole("button", { name: "Finish", exact: true });
  if (await finishTour.isVisible().catch(() => false)) await finishTour.click();
  const shortcutDialog = page.getByRole("dialog", { name: "Break Manager shortcuts" });
  if (await shortcutDialog.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(shortcutDialog).toBeHidden();
  }

  await page.getByPlaceholder(/Search reason, root cause, recon/u).fill(reconName);
  const card = page.locator("div.cursor-pointer").filter({ hasText: reconName }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  const detail = page.getByRole("dialog").last();
  await expect(detail.getByRole("button", { name: "Request write-off", exact: true })).toBeVisible();

  await detail.getByRole("button", { name: "Request write-off", exact: true }).click();

  const approval = page.getByRole("dialog", { name: "Break actions" });
  await expect(approval).toBeVisible();
  await approval.getByRole("tab", { name: "Write-off", exact: true }).click();
  await expect(approval.getByRole("button", { name: "Request write-off", exact: true })).toBeVisible();
  await expect(approval.getByText(/different active tenant administrator/u)).toBeVisible();
});
