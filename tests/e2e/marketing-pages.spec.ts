import { test, expect } from "@playwright/test";

/**
 * Marketing-pages smoke test.
 *
 * Covers the canonical 6 marketing routes. Each must return 200 and
 * contain at least one expected piece of content (so we know we're not
 * seeing a Cloudflare error page or a generic 404).
 */

const PAGES: Array<{ path: string; expect: RegExp }> = [
  { path: "/", expect: /falcon|veritas|reconciliation|recon|fvi/i },
  { path: "/pricing", expect: /price|plan|tier|stripe|month|year/i },
  { path: "/security", expect: /security|soc|iso|encryption|compli/i },
  { path: "/support", expect: /support|help|contact|docs|category/i },
  { path: "/solutions", expect: /solution|industry|bank|finance|fintech/i },
  { path: "/developers", expect: /developer|api|sdk|webhook|integration/i },
];

for (const { path, expect: bodyPattern } of PAGES) {
  test(`marketing ${path} returns 200`, async ({ page, request }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    const url = `${path}`;
    const resp = await request.get(url, { maxRedirects: 2 });
    expect(
      resp.status(),
      `${url} expected 200, got ${resp.status()}`,
    ).toBeGreaterThanOrEqual(200);
    expect(resp.status()).toBeLessThan(400);
    const headers = resp.headers();
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");

    // Also navigate via the browser to verify the SPA hydrates without runtime errors.
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "This page didn't load" })).toHaveCount(0);
    const text = await page.locator("body").innerText();
    expect(
      bodyPattern.test(text),
      `marketing ${path}: body did not match ${bodyPattern}; got first 200 chars: ${text.slice(0, 200)}`,
    ).toBeTruthy();
    expect(runtimeErrors, `${path} must remain usable after client hydration`).toEqual([]);
    if (path === "/") {
      await expect(page.getByRole("link", { name: "Sign in", exact: true }).first())
        .toHaveAttribute("href", "https://app.reconiq.example/auth");
    }
  });
}
