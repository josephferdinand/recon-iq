#!/usr/bin/env node
// patch-dompurify-cycle.mjs — LL-053 post-build patch.
//
// The `isomorphic-dompurify@3.22.0` browser entry does this at module top level:
//
//   import { t as purify } from "./dompurify.mjs";
//   var browser_default = purify;
//   purify.sanitize.bind(purify);   // <-- TDZ: purify may be undefined here
//   purify.isSupported;
//   purify.addHook.bind(purify);
//   ...
//
// Rolldown/Vite SSR bundles a cyclic graph where `dompurify.mjs`'s body
// (which assigns `var purify = createDOMPurify(...)`) has not yet executed
// when `isomorphic-dompurify.mjs`'s eager `.bind(purify)` smoke-tests run.
// Result: `TypeError: Cannot read properties of undefined (reading 'bind')`
// at module-evaluation time inside the Pages worker.
//
// Fix: replace `var browser_default = purify;` with a Proxy that defers
// property access until first read, and no-op the eager `.bind()` calls
// (they are just smoke-tests — they prove the method exists and is a
// function; safe to drop).
//
// Idempotent: re-running on an already-patched file is a no-op.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = process.argv[2] || "dist/_worker.js/_libs";
const FILES = ["isomorphic-dompurify.mjs"];

const PROXY_PATCH = `var _ll053_p = null;
var browser_default = new Proxy({}, { get: function(_t, prop) {
  if (_ll053_p === null) { _ll053_p = (typeof purify !== "undefined") ? purify : null; }
  if (_ll053_p === null) return undefined;
  var v = _ll053_p[prop];
  return typeof v === "function" ? v.bind(_ll053_p) : v;
}, has: function(_t, prop) {
  if (_ll053_p === null) { _ll053_p = (typeof purify !== "undefined") ? purify : null; }
  return _ll053_p !== null && (prop in _ll053_p);
} });`;

let patchedCount = 0;
for (const f of FILES) {
  const p = join(TARGET, f);
  let src;
  try { src = readFileSync(p, "utf-8"); }
  catch { console.warn(`[patch-dompurify] ${p} not found — skipping`); continue; }

  // Idempotency check
  if (src.includes("_ll053_p = null")) {
    console.log(`[patch-dompurify] ${p} already patched — skipping`);
    continue;
  }

  // Replace `var browser_default = purify;` with Proxy wrapper
  const reAssign = /var\s+browser_default\s*=\s*purify\s*;/;
  if (!reAssign.test(src)) {
    console.warn(`[patch-dompurify] ${p} does not match assignment pattern — skipping`);
    continue;
  }
  src = src.replace(reAssign, PROXY_PATCH);

  // No-op the eager `.bind()` smoke-test calls. Two styles depending on the
  // bundler version: wrapped in try-catch, or bare statements. Match both.
  src = src.replace(/^\s*try\s*\{\s*purify\.[A-Za-z0-9_]+\.bind\(\s*purify\s*\)\s*;\s*\}\s*catch[^\n]*$/gm,
    (m) => `// LL-053: deferred .bind() smoke-test via Proxy`);
  src = src.replace(/^(\s*)purify\.[A-Za-z0-9_]+\.bind\(\s*purify\s*\)\s*;?\s*$/gm,
    (m, indent) => `${indent}// LL-053: deferred .bind() smoke-test via Proxy`);

  // Comment out direct `purify.X;` reads (purify.isSupported; etc.) since they
  // would still throw on undefined under cyclic TDZ. They are also smoke-tests.
  src = src.replace(/^\s*purify\.[A-Za-z0-9_]+\s*;?\s*$/gm,
    (m) => `// LL-053: removed eager purify read (TDZ defer via Proxy)`);

  writeFileSync(p, src);
  patchedCount++;
  console.log(`[patch-dompurify] patched ${p}`);
}
console.log(`[patch-dompurify] total: ${patchedCount} file(s) patched`);
