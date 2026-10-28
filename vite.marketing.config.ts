import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// Marketing build: ships ONLY public-facing pages to the reconiq.example
// Pages project. Excludes every app-only route + every server-only subtree
// (api/*, _authenticated/*, /t/$slug.* tenant app pages) so the worker stays
// under the Cloudflare Pages 25 MiB per-worker limit.
//
// `routeFileIgnorePattern` matches against the basename of each directory
// entry during route-tree generation. We pass a regex that matches both
// top-level entries (e.g. `_authenticated`, `api`) and entry subtrees that
// contain app code (e.g. `auth.tsx`, `console.tsx`, `m.approvals.tsx`,
// `reset-password.tsx`, `mkt-admin`, `t.$slug.auth.tsx`, `t.$slug.index.tsx`).
//
// Generated route tree is written to `src/routeTree.marketing.gen.ts` so
// the app build (which uses `src/routeTree.gen.ts`) is not disturbed.
export default defineConfig(({ mode }) => ({
  plugins: [
    tanstackStart({
      server: { entry: "server" },
      router: {
        // LL-046: point the SSR router entry at src/router.marketing.tsx
        // (which imports from routeTree.marketing.gen — the filtered tree)
        // instead of the default src/router.tsx (which imports the full
        // 654-route tree). This is what actually keeps the app-only
        // server-side imports out of the marketing bundle.
        entry: "router.marketing",
        // LL-046: write the marketing route tree to a separate file so the
        // app build's src/routeTree.gen.ts is not disturbed. We pass an
        // absolute path (resolved from process.cwd()) to avoid the
        // src/<src>/ double-prefix bug seen when generatedRouteTree is
        // relative and the TanStack Start plugin's `root` collapses.
        generatedRouteTree: `${process.cwd()}/src/routeTree.marketing.gen.ts`,
        // Excludes every app-only route file/directory basename at every
        // depth. The regex matches:
        //   - Top-level app-only dirs: _authenticated, api, mkt-admin
        //   - Top-level app-only files: auth.tsx, console.tsx, m.approvals.tsx,
        //     reset-password.tsx
        //   - Tenant subdomain routes: t.$slug.auth.tsx, t.$slug.index.tsx
        routeFileIgnorePattern:
          "^(?:_authenticated|api|mkt-admin|auth(?:\\.tsx)?|console\\.tsx|m\\.approvals\\.tsx|reset-password\\.tsx|confirm-auth\\.tsx|mfa-challenge\\.tsx|oauth(?:\\..*)?|t\\.\\$slug\\.(?:auth|index)\\.tsx)$",
        disableLogging: true,
      },
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
      // LL-016: separate output dir so we don't collide with `dist/` which
      // the app build uses.
      output: { dir: "dist-marketing", inlineDynamicImports: true },
      cloudflare: { nodeCompat: true, deployConfig: true },
      errorHandler: "src/lib/error-handler.ts",
    }),
  ],
  resolve: {
    // Vite 8 resolves the project's tsconfig aliases natively. Keeping both
    // build surfaces on the same resolver avoids crawling ignored snapshots.
    tsconfigPaths: true,
    alias: [
      {
        find: "@ai-sdk/gateway",
        replacement: fileURLToPath(
          new URL("./src/lib/ai/gateway-stub.mjs", import.meta.url),
        ),
      },
      {
        find: "@ai-sdk/mcp",
        replacement: fileURLToPath(new URL("./src/lib/ai/mcp-stub.mjs", import.meta.url)),
      },
    ],
  },
  // Preserve the LL-046 single-chunk SSR boundary. Applying this to the
  // browser too produces an invalid Zod initialization (`config` undefined)
  // in Rolldown's flattened client output. Browser modules keep normal splits.
  environments: {
    ssr: {
      build: {
        rolldownOptions: { output: { codeSplitting: false } },
      },
    },
  },
  build: {
    rolldownOptions: {
      external: ["cloudflare:workers"],
    },
  },
}));
