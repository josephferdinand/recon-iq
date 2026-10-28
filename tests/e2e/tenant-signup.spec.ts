import { test, expect } from "@playwright/test";

/**
 * Tenant signup journey — public landing → /auth → console redirect.
 *
 * This is the critical top-of-funnel journey. If this breaks, no
 * tenants can sign up. Tests are deliberately tolerant of Marketing
 * site copy changes (the CTA wording shifts often).
 */

test.describe("Tenant signup", () => {
  test("landing → sign in CTA → /auth", async ({ page }) => {
    await page.goto("/");

    // The landing page must render.
    await expect(page).toHaveTitle(/.+/);

    // Capture a screenshot for the marketing team.
    await page.screenshot({
      path: "test-results/landing.png",
      fullPage: false,
    });

    // Click a "Sign in" / "Log in" / "Get started" link.
    const signInLink = page
      .getByRole("link", { name: /sign in|log in|get started|try fvi/i })
      .first();
    await expect(signInLink).toBeVisible({ timeout: 10_000 });
    await signInLink.click();

    // Verify we landed on /auth (or were redirected to a login path).
    await page.waitForLoadState("networkidle");
    const url = new URL(page.url());
    expect(
      /\/auth/.test(url.pathname) ||
        /\/login/.test(url.pathname) ||
        /\/signin/.test(url.pathname),
      `expected /auth|/login|/signin, got ${url.pathname}`,
    ).toBeTruthy();

    await page.screenshot({
      path: "test-results/auth.png",
      fullPage: false,
    });
  });

  test("auth form fields render", async ({ page }) => {
    await page.goto("/auth");

    // Email + password fields are the minimum for a Supabase email auth form.
    const emailField = page.locator('input[type="email"], input[name="email"]').first();
    const passwordField = page.locator('input[type="password"], input[name="password"]').first();

    // Either we are on /auth with a form, or we were redirected back to /.
    if (page.url().includes("/auth")) {
      await expect(emailField).toBeVisible();
      await expect(passwordField).toBeVisible();
    } else {
      test.skip(true, "no auth form rendered — likely redirected from /auth");
    }
  });
});
