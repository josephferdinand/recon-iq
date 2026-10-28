import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = ["/", "/auth", "/support"];

for (const route of routes) {
  test(`${route} is reachable, hardened, and free of serious accessibility violations`, async ({ page }) => {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    const headers = response?.headers() ?? {};
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");

    const unnoncedScripts = await page.locator("script:not([nonce])").evaluateAll((scripts) =>
      scripts
        .map((script) => script.getAttribute("src") ?? "inline")
        .filter((src) => !src.startsWith("/cdn-cgi/")),
    );
    expect(unnoncedScripts).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  });
}

test("public cron endpoints reject missing credentials", async ({ request }) => {
  for (const path of [
    "/api/public/cron/audit-anchor-write",
    "/api/public/cron/audit-anchor-verify",
  ]) {
    const response = await request.post(path);
    expect(response.status()).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  }
});

test("navigation performance stays within the owner-session smoke budget", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return {
      domContentLoaded: nav.domContentLoadedEventEnd,
      load: nav.loadEventEnd,
      transferSize: nav.transferSize,
    };
  });
  expect(timing.domContentLoaded).toBeLessThan(10_000);
  expect(timing.load).toBeLessThan(15_000);
  expect(timing.transferSize).toBeGreaterThan(0);
});
