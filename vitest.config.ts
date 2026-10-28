import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "tests/**/*.spec.ts",
      "tests/**/**/*.spec.ts",
      "tests/**/*.spec.tsx",
      "tests/**/**/*.spec.tsx",
    ],
    // Default is deterministic and secret-free. Live Supabase, RLS, local-API,
    // and browser suites are explicit gates so a developer cannot mutate PROD
    // merely by running `bun test` with an inherited .env file.
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
      "tests/e2e-owner/**",
      "tests/api/**",
      "tests/auth/ui-flows.spec.ts",
      "tests/rls/**",
      "tests/rls-*.spec.ts",
      "tests/tenant-isolation/**",
      "tests/data-prep-staging/**",
      "tests/retention/**",
      "tests/vault/rls.spec.ts",
      "tests/phase8/digital-twin-scale.spec.ts",
      "tests/aidp/idempotency.spec.ts",
      "tests/agentic/**",
      "tests/agentic-closed-loop.spec.ts",
      "tests/copilot/needs-approval.spec.ts",
      "tests/invitation-token-hashing.spec.ts",
      "tests/verify-audit-chain-rbac.spec.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "cloudflare:workers": path.resolve(__dirname, "./tests/stubs/cloudflare-workers.ts"),
    },
  },
});
