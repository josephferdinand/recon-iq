import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.live.setup.ts"],
    include: [
      "tests/rls/tenant-isolation-regression.spec.ts",
      "tests/tenant-isolation/end-to-end.spec.ts",
      "tests/rls/cross-tenant.spec.ts",
      "tests/rls/cross-tenant-endpoints.spec.ts",
      "tests/rls-admin-only-tables.spec.ts",
      "tests/rls-multi-tenant-regression.spec.ts",
      "tests/verify-audit-chain-rbac.spec.ts",
    ],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
