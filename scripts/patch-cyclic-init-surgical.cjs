#!/usr/bin/env node
// patch-cyclic-init-surgical.cjs — SURGICAL LL-046 build-time patch.
//
// Replaces the previous blanket patch. The previous version wrapped every
// `init_X()` call in try-catch — including the calls inside the
// `init___23tanstack_start_server_fn_resolver` thunk. That thunk builds
// the serverFn manifest by calling `importer()` for every server function.
// When the importer's init call throws (cyclic TDZ) and the patch swallows
// the throw, the manifest is incomplete — every server-fn lookup returns
// "Server function info not found".
//
// This surgical version:
//   1. Finds every `var init_X = __esmMin((() => { ... }));` thunk body
//   2. Inside those bodies, wraps each `init_Y(...);` call in try-catch
//   3. EXCLUDES the body of `init___23tanstack_start_server_fn_resolver`
//      (the manifest builder) and any thunk whose body contains
//      `manifest = {` (heuristic for manifest population)
//   4. ALSO does NOT wrap init calls at the TOP LEVEL outside of any thunk
//
// Per LL-068 / LL-070 (Zoe QA 2026-08-22): this surgical patch is what
// makes both (a) the dompurify bind TDZ survive and (b) the server-fn
// manifest populate correctly.

const fs = require('node:fs')
const path = require('node:path')

const distDir = process.argv[2]
if (!distDir) {
  console.error('Usage: node patch-cyclic-init-surgical.cjs <dist/_worker.js/_ssr>')
  process.exit(1)
}

const files = fs.readdirSync(distDir).filter(f => f.endsWith('.mjs'))
let totalPatched = 0
let totalSkipped = 0

for (const file of files) {
  const filePath = path.join(distDir, file)
  const src = fs.readFileSync(filePath, 'utf8')

  // Find every thunk: var init_X = __esmMin((() => { ... }));
  // Capture: var init_X = __esmMin((() => { BODY }));
  const thunkRe = /(var\s+(init_[a-zA-Z0-9_]+)\s*=\s*__esmMin\(\s*\(\(\)\s*=>\s*\{)([\s\S]*?)\}\)\)\);/g
  let newSrc = src
  let patched = 0
  let skipped = 0
  let match
  const replacements = []

  while ((match = thunkRe.exec(src)) !== null) {
    const [fullMatch, initName, thunkHeader, body] = match
    const fullStart = match.index
    const bodyStart = fullStart + thunkHeader.length
    const bodyEnd = bodyStart + body.length

    // Skip the manifest builder thunk and any thunk whose body
    // contains `manifest = {` (heuristic for any module that
    // populates a manifest map).
    if (
      initName === 'init___23tanstack_start_server_fn_resolver' ||
      /\bmanifest\s*=\s*\{/.test(body) ||
      /\bmanifest\s*=\s*\(\s*\(\s*\)\s*=>\s*\{/.test(body)
    ) {
      skipped++
      continue
    }

    // Wrap each init_Y(...); inside the body in try-catch.
    const initCallRe = /^(\s*)(init_[a-zA-Z0-9_]+\s*\([^)]*\)\s*;)(\s*)$/gm
    let newBody = body
    let bodyPatched = 0
    newBody = newBody.replace(
      initCallRe,
      (m, indent, initCall, ws) => {
        // Skip if already wrapped
        if (/try\s*\{\s*$/.test(newBody.substring(Math.max(0, newBody.indexOf(m) - 200), newBody.indexOf(m)))) {
          return m
        }
        bodyPatched++
        return `${indent}try { ${initCall} } catch (e) { if (!(e instanceof TypeError) || !/^init_/.test(String(e.message || ""))) throw e; }${ws}`
      },
    )

    if (bodyPatched > 0) {
      replacements.push({
        start: bodyStart,
        end: bodyEnd,
        replacement: newBody,
      })
      patched += bodyPatched
    }
  }

  // Apply replacements in reverse order so offsets remain valid
  for (const r of replacements.reverse()) {
    newSrc = newSrc.slice(0, r.start) + r.replacement + newSrc.slice(r.end)
  }

  if (newSrc !== src) {
    fs.writeFileSync(filePath, newSrc, 'utf8')
    console.log(`[patch] ${file}: wrapped ${patched} cyclic init calls in try-catch (skipped ${skipped} manifest thunks)`)
  }
  totalPatched += patched
  totalSkipped += skipped
}

console.log(`[patch] total: wrapped ${totalPatched} cyclic init calls in ${files.length} files, skipped ${totalSkipped} manifest thunks`)