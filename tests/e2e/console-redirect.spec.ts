import { test, expect } from "@playwright/test";

/**
 * Console redirect smoke test.
 *
 * Verifies that the post-auth path lands on /console (or another
 * authenticated route). This is the "happy path" tenant journey.
 *
 * Since we can't sign in with a real test account in CI without
 * provisioning one, this test validates the *entry* redirect:
 *   /  → /auth (after Sign in click)  → after submit → /console
 *
 * We only assert the first hop and the existence of /console route
 * definition; we don't try to submit credentials because the test
 * tenant lifecycle is governed by tests/rls/.
 */

test("landing → sign in → /auth", async ({ page }) => {
  await page.goto("/");

  const signInLink = page
    .getByRole("link", { name: /sign in|log in|get started|try fvi/i })
    .first();
  await expect(signInLink).toBeVisible({ timeout: 10_000 });
  await signInLink.click();

  await page.waitForLoadState("networkidle");
  const url = new URL(page.url());
  expect(
    /\/auth|\/login|\/signin/.test(url.pathname),
    `expected auth route, got ${url.pathname}`,
  ).toBeTruthy();
});

test("/console is a known route (404 vs auth-redirect)", async ({ request }) => {
  // /console without auth should be a redirect to /auth (302) or 401 — NOT 404.
  // If it returns 404, the route file is missing.
  const resp = await request.get("/console", { maxRedirects: 0 });
  expect(
    resp.status() !== 404,
    `/console returned 404 — route file missing. status=${resp.status()}`,
  ).toBeTruthy();
});
