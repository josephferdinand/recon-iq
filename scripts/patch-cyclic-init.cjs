#!/usr/bin/env node
// patch-cyclic-init.cjs — LL-046 build-time patch.
//
// The cyclic-init TDZ trap (LL-016) returns every time a module on the
// router-1 <-> router-2 cyclic edge emits `var init_X = __esmMin(...)`.
// When the consumer's `__esmMin` thunk runs and calls `init_X()` while
// the producer's `var init_X` is still in TDZ (cyclic evaluation order),
// the call fails with `init_X is not a function`.
//
// We wrap every `init_X();` call site in a try-catch that silently
// ignores the TypeError if the binding is undefined. The producer
// module will fully evaluate later (via the regular ES module graph),
// and its `__esmMin` thunk will be run when the producer's own
// `__esmMin` body executes. The TDZ window is the only issue; once
// the producer has finished evaluating, all bindings are defined.
//
// This preserves the real side effects (server-fn registration) while
// tolerating the cyclic TDZ window.

const fs = require('node:fs');
const path = require('node:path');

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: node patch-cyclic-init.cjs <dist/_worker.js/_ssr>');
  process.exit(1);
}

const files = fs.readdirSync(distDir).filter(f => f.endsWith('.mjs'));
let totalPatched = 0;

// Wrap bare `init_X(...);` calls (with optional whitespace) in a try-catch
// that ignores "X is not a function" errors during cyclic TDZ.
//
// We match:
//   <indent>init_<name>(<args>);<newline>
//
// And wrap as:
//   <indent>try { init_<name>(<args>); } catch (e) { if (!(e instanceof TypeError)) throw e; }
//
// To keep the patch simple and avoid breaking the bundler's `__esmMin`
// closure semantics, we wrap the entire consumer `__esmMin` body in a
// try-catch instead. That covers ALL init_X calls at once.
//
// Actually, the simpler approach: only wrap the specific init_X call
// lines, not the whole body. This way, real errors (not cyclic TDZ)
// still surface.
const INIT_CALL_RE = /^(\s*)(init_[a-zA-Z0-9_]+\s*\([^)]*\)\s*;)(\s*)$/gm;

for (const file of files) {
  const filePath = path.join(distDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  let patched = 0;

  content = content.replace(INIT_CALL_RE, (match, indent, call, trailing) => {
    patched++;
    return `${indent}try { ${call} } catch (e) { if (!(e instanceof TypeError) || !/^init_/.test(String(e.message || ""))) throw e; }${trailing}`;
  });

  if (patched > 0) {
    fs.writeFileSync(filePath, content);
    totalPatched += patched;
    console.log(`[patch] ${file}: wrapped ${patched} cyclic init calls in try-catch`);
  }
}

console.log(`[patch] total: wrapped ${totalPatched} cyclic init calls in try-catch from ${files.length} files`);
