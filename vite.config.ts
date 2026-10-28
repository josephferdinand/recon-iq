import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig(({ mode }) => {
  // Vite applies the standard mode-aware precedence (.env, .env.local,
  // .env.<mode>, .env.<mode>.local). Explicit shell variables remain highest.
  const shellEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"),
  );
  const loadedEnv: Record<string, string> = {
    ...loadEnv(mode, process.cwd(), ""),
    ...shellEnv,
  };
  const getEnv = (k: string, fallback = ""): string => loadedEnv[k] ?? fallback;
  const projectRef = getEnv("SUPABASE_PROJECT_REF", getEnv("VITE_SUPABASE_PROJECT_ID"));
  const supabaseUrl = getEnv("SUPABASE_URL", getEnv("VITE_SUPABASE_URL"));
  const publishableKey = getEnv(
    "SUPABASE_PUBLISHABLE_KEY",
    getEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
  );
  const publicPublishableKey = getEnv("VITE_SUPABASE_PUBLISHABLE_KEY", publishableKey);
  const placeholderPattern = /^(?:<)?(?:pending|populated|todo|replace[_ -]?me)(?:>)?$/iu;

  for (const [name, value] of [
    ["SUPABASE_PROJECT_REF", projectRef],
    ["SUPABASE_URL", supabaseUrl],
    ["SUPABASE_PUBLISHABLE_KEY", publishableKey],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", publicPublishableKey],
  ] as const) {
    if (!value || placeholderPattern.test(value.trim())) {
      throw new Error(`${name} must be populated from the selected protected environment`);
    }
  }
  if (publishableKey.length < 40 || publicPublishableKey.length < 40) {
    throw new Error("Supabase publishable keys do not have a valid credential shape");
  }
  const supabaseHost = new URL(supabaseUrl).hostname;
  if (supabaseHost !== `${projectRef}.supabase.co`) {
    throw new Error("Supabase URL and project reference identify different environments");
  }

  return {
  // Only intentionally public Supabase identifiers may be replaced at build
  // time. Service-role, JWT, database, cron, and mail credentials are runtime
  // Worker bindings and must never enter browser/server build artifacts.
  define: {
    "process.env.SUPABASE_URL": JSON.stringify(
      supabaseUrl
    ),
    "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      publishableKey
    ),
    "process.env.SUPABASE_PROJECT_REF": JSON.stringify(
      projectRef
    ),
  },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: mode === "production" ? "error" : "mock",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    react(),
    tailwindcss(),
    nitro({
      preset: "cloudflare-pages",
      output: { dir: "dist" },
      cloudflare: { nodeCompat: true, deployConfig: true },
      errorHandler: "src/lib/error-handler.ts",
    }),
  ],
  // LL-077 (Opus 4.8, 2026-08-23): The `ai` package (^7.0.2) is a direct
  // dependency used for prompt + zod schema helpers in the AIDP flow. It
  // has a runtime peer-dep on `@ai-sdk/gateway` which transitively imports
  // `node:fs` at module-init time. Cloudflare Workers with `nodeCompat: true`
  // does NOT polyfill `node:fs` in the SSR worker context (verified
  // empirically: 500 with "No such module node:fs" at startup).
  //
  // We don't use the gateway at runtime, so stub it with a no-op module
  // so the import graph still resolves. The `ai` package's own code paths
  // (generateText, streamText, etc.) are NOT called from SSR startup —
  // only the type declarations are imported.
  resolve: {
    // Vite 8 resolves the project's tsconfig path aliases natively. Avoid the
    // legacy crawler plugin so ignored continuity snapshots cannot be treated
    // as live TypeScript projects.
    tsconfigPaths: true,
    alias: [
      { find: "@ai-sdk/gateway", replacement: fileURLToPath(new URL("./src/lib/ai/gateway-stub.mjs", import.meta.url)) },
      { find: "@ai-sdk/mcp", replacement: fileURLToPath(new URL("./src/lib/ai/mcp-stub.mjs", import.meta.url)) },
    ],
  },
  build: {
    rolldownOptions: {
      external: ["cloudflare:workers"],
    },
  },
  };
});
