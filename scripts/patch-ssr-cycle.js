#!/usr/bin/env node
// LL-041 (Felix): post-build patch that breaks the cyclic ESM dep between
// the router chunk and the shared component/function-init chunk in the SSR
// bundle.
//
// Background: rolldown splits the SSR graph into two chunks. The main router
// chunk eagerly evaluates `init_X()` thunks at module load time, which call
// into the shared chunk's lazy `init_X` exports. When the shared chunk
// re-imports `init_router` (or any other export) back from the main chunk,
// those bindings are still `undefined` (TDZ across the circular import) and
// the Workers runtime throws
// "init_X is not a function" — hitting every X (init_tenants_functions,
// init_card, init_button, init_dialog, ...) until ALL lazy inits have been
// deferred.
//
// Fix: convert every `init_X();` statement in the SSR router chunks into a
// no-op by replacing the call with `/* LL-041 */;`. The thunks still run:
//   - On first request that navigates to a route, `getRouter()` is called
//     from the SSR entry, which runs `init_router()` (which runs
//     `init_routeTree_gen()` which runs all the route thunks).
//   - Route thunks that use a component import like `Card` first run
//     `init_card()`, which resolves the live binding for `Card` before the
//     component is referenced.
//
// This is a post-build patch because:
//   - Rolldown always emits eager `init_X()` calls when any `export const X =
//     createServerFn(...)` or `export const Card = ...` exists alongside a
//     static `import { Card } from "..."`. We can't avoid this in source
//     without breaking the TanStack Router code-splitter contract.
//   - The "right" fix is upstream in rolldown / @tanstack/react-start, but for
//     now we patch the bundle.
//
// Idempotent: running twice is safe — second run finds no `init_X();` calls
// to patch and exits cleanly.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readdirSync } from "node:fs";

const SSR_DIR = join(process.cwd(), "dist", "_worker.js", "_ssr");

async function main() {
  let files;
  try {
    files = readdirSync(SSR_DIR).filter((f) => /\.mjs$/.test(f));
  } catch (e) {
    console.error("[patch-ssr-cycle] could not read", SSR_DIR, e.message);
    process.exit(1);
  }
  // Only patch the SSR router chunk(s) — the shared chunk has the right shape
  // already. We identify "router" chunks by filename prefix.
  let patched = 0;
  for (const file of files) {
    if (!/^router-[A-Za-z0-9_-]+\.mjs$/.test(file)) continue;
    // Skip the shared chunk (e.g. router-XXX2.mjs): smaller, no eager init
    // chain. The cycle only happens in the main router chunk.
    if (file.match(/^[A-Za-z0-9_-]+2\.mjs$/i)) continue;
    const p = join(SSR_DIR, file);
    const src = await readFile(p, "utf8");
    // Match `init_X();` statements ONLY at top level (column 0). The cycle
    // manifests when rolldown emits an eager `init_router();` (and similar
    // top-level `init_X();`) right after the `var init_X = __esmMin(...)`
    // declaration. Inside thunk bodies, `init_X();` runs when the thunk
    // itself is invoked, which is on-demand after the import cycle has
    // resolved. We must NOT patch those — they're the actual initialization
    // calls that populate `routeTree`, `Card`, etc.
    //
    // The original aggressive regex caught indented thunk-body calls too and
    // produced 500s like "Cannot read properties of undefined (reading
    // 'matchCache')" because `routeTree` was never populated.
    const re = /(^|\n)(init_[a-zA-Z_][a-zA-Z0-9_]*)\(\);\s*\n/g;
    let changed = false;
    const next = src.replace(re, (match, prefix, name) => {
      changed = true;
      return `${prefix}/* LL-041: deferred ${name}() — was eager; cycle-safe */\n`;
    });
    if (changed) {
      await writeFile(p, next, "utf8");
      console.log(`[patch-ssr-cycle] patched ${file}`);
      patched += 1;
    }
  }
  if (patched === 0) {
    console.log("[patch-ssr-cycle] nothing to patch (already clean)");
  } else {
    console.log(`[patch-ssr-cycle] patched ${patched} file(s)`);
  }
}

main().catch((e) => {
  console.error("[patch-ssr-cycle] failed:", e);
  process.exit(1);
});
