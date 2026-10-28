import { expect, test } from "@playwright/test";

const enabled = process.env.FVI_RUN_PROFILE_SECURITY === "YES";

test("Profile Change password opens the interactive security form", async ({ page }) => {
  test.skip(!enabled, "Requires an authenticated owner browser state");
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  const changePassword = page.getByRole("link", { name: "Change password" });
  await expect(changePassword).toBeVisible({ timeout: 30_000 });
  await changePassword.click();
  await expect(page).toHaveURL(/\/profile\/security$/u);
  await expect(page.getByRole("heading", { name: "Change password", exact: true })).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Confirm new password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update password" })).toBeDisabled();
});
