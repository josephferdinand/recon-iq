import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const storageState = process.env.FVI_OWNER_STORAGE_STATE;
const baseURL =
  process.env.FVI_E2E_BASE_URL ??
  process.env.FVI_OWNER_BASE_URL ??
  "https://dev.app.reconiq.example";
const evidenceRoot = path.resolve(process.env.FVI_E2E_EVIDENCE_DIR ?? "_e2e_run/owner-session");

export default defineConfig({
  testDir: "./tests/e2e-owner",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidenceRoot, "results.json") }],
    ["html", { outputFolder: path.join(evidenceRoot, "html"), open: "never" }],
  ],
  outputDir: path.join(evidenceRoot, "artifacts"),
  use: {
    baseURL,
    storageState: storageState && existsSync(storageState) ? storageState : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: "owner-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
