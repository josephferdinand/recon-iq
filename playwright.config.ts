import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for FVI marketing + app E2E coverage.
 *
 * Targets:
 *   - https://app.reconiq.example/   (app)
 *   - https://reconiq.example/       (marketing)
 *
 * Notes:
 *   - Worker count is pinned to 1 so tests stay fast on small CI runners.
 *   - `expect.toHaveStatus` defaults to 200. Marketing pages sometimes
 *     redirect to https://www.* which we also accept.
 *   - Screenshots captured on failure; traces retained for one retry.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  use: {
    baseURL: "https://app.reconiq.example",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
    headless: true,
  },
  projects: [
    {
      name: "marketing",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.FVI_MARKETING_BASE_URL ?? "https://reconiq.example",
      },
      testMatch: /marketing-pages\.spec\.ts/,
    },
    {
      name: "app",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "https://app.reconiq.example",
      },
      testMatch: /(tenant-signup|console-redirect|api-status|sitemap)\.spec\.ts/,
    },
  ],
});
