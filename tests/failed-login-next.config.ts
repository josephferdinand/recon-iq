import { defineConfig } from "vitest/config";
import path from "node:path";
// Tests compile only the selected NEXT auth modules; no app/global build.
export default defineConfig({
  test: { environment: "node", setupFiles: ["./vitest.setup.ts"], include: ["tests/auth/failed-login-current-password-integration.spec.ts", "tests/auth/failed-login-server-functions.spec.ts", "tests/auth/failed-login-next-flows.spec.tsx"], maxWorkers: 1, testTimeout: 30000, server: { deps: { inline: [/input-otp/, /@radix-ui/, /@tanstack\/react-query/, /^react(?:-dom)?(?:\/|$)/] } } },
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-start", "@tanstack/react-router", "@tanstack/react-query"], alias: { "@": "./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930/src", "cloudflare:workers": path.resolve("tests/stubs/cloudflare-workers.ts") } },
});
