import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
const root = path.resolve("./LOCAL_USER/OneDrive - 8gsp1y/Documents/ChatGPT/ReconIQ");
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(root, "_e2e_run/interpreter-runid/html") }]],
  outputDir: path.join(root, "tests/e2e/interpreter-runid-pill-trace/test-results"),
  use: {
    trace: "on-first-retry",
    screenshot: "on",
    video: "off",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
