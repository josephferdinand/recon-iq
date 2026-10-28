#!/usr/bin/env node
/**
 * FVI · Diagram render-profile resolver.
 *
 * The render profile is every input that can change rendered pixel output for
 * a `.mmd` source WITHOUT changing the source itself:
 *
 *   - @mermaid-js/mermaid-cli version (controls the rendering pipeline)
 *   - puppeteer version (controls headless Chromium API surface)
 *   - bundled Chromium revision (the actual pixel-producing binary)
 *   - mermaid theme + background flag
 *   - Puppeteer launch args / executable path overrides
 *   - font family + CSS overrides supplied via the optional config file
 *
 * Every entry in `docs/diagrams/rendered/.manifest.json` stores the profile
 * SHA that produced it. The selective renderer treats a profile mismatch as
 * a cache miss (forces a real Puppeteer render). The verifier treats it as
 * drift. This guarantees that swapping the Chromium binary, changing the
 * theme, or adding a font is never silently re-used from stale PNG/SVGs.
 *
 *   import { getRenderProfile } from './diagram-render-profile.mjs';
 *   const profile = getRenderProfile();
 *   // -> { profile_sha256, mermaid_cli, puppeteer, chromium, theme, ... }
 *
 * Override via env (kept stable across local + CI):
 *   DIAGRAM_THEME           default | dark | forest | neutral   (default 'default')
 *   DIAGRAM_BACKGROUND      transparent | white | <hex>         (default 'transparent')
 *   DIAGRAM_FONT_FAMILY     CSS font-family string              (optional)
 *   DIAGRAM_PUPPETEER_CFG   path to JSON                        (default <OUT>/.puppeteer.json)
 *   DIAGRAM_MERMAID_CFG     path to mermaid config JSON         (optional)
 *   DIAGRAM_CSS             path to CSS file passed via --cssFile  (optional)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, parse } from 'node:path';

const OUT_DIR = 'docs/diagrams/rendered';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

function safeJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function packageMetadata(name) {
  try {
    const p = require.resolve(`${name}/package.json`, { paths: [process.cwd()] });
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    try {
      let cursor = dirname(require.resolve(name, { paths: [process.cwd()] }));
      const root = parse(cursor).root;
      while (cursor !== root) {
        const candidate = join(cursor, 'package.json');
        const metadata = safeJson(candidate);
        if (metadata?.name === name) return metadata;
        cursor = dirname(cursor);
      }
    } catch { /* unresolved */ }
    return null;
  }
}

function pkgVersion(name) {
  return packageMetadata(name)?.version ?? null;
}

// Note: in ESM `require` is not present; provide a shim.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function mermaidCliPuppeteerPin() {
  // mermaid-cli ships puppeteer as a direct dep — that pin is what actually
  // runs locally and in CI. Reading it makes the profile deterministic even
  // when puppeteer isn't installed at the project root.
  const pkg = packageMetadata('@mermaid-js/mermaid-cli');
  return pkg?.dependencies?.puppeteer
      ?? pkg?.devDependencies?.puppeteer
      ?? null;
}

function detectChromium() {
  // Puppeteer ≥ v20 reports the bundled Chromium build via PUPPETEER_REVISIONS.
  for (const path of ['puppeteer/lib/cjs/puppeteer/revisions.js', 'puppeteer-core/lib/cjs/puppeteer/revisions.js']) {
    try {
      const rev = require(path);
      const r = rev?.PUPPETEER_REVISIONS ?? {};
      const v = r.chromium || r.chrome || r['chromium-headless-shell'];
      if (v) return v;
    } catch { /* try next */ }
  }
  return null;
}


function fileFingerprint(path) {
  if (!path || !existsSync(path)) return null;
  const buf = readFileSync(path);
  return { path, sha256: sha256(buf), bytes: statSync(path).size };
}

export function getRenderProfile() {
  const puppeteerCfgPath = process.env.DIAGRAM_PUPPETEER_CFG || join(OUT_DIR, '.puppeteer.json');
  const mermaidCfgPath   = process.env.DIAGRAM_MERMAID_CFG || null;
  const cssPath          = process.env.DIAGRAM_CSS || null;

  const profile = {
    schema: 1,
    mermaid_cli:        pkgVersion('@mermaid-js/mermaid-cli') ?? 'unresolved',
    puppeteer:          pkgVersion('puppeteer') ?? mermaidCliPuppeteerPin() ?? 'unresolved',
    puppeteer_pinned_by_mermaid: mermaidCliPuppeteerPin(),
    chromium:           detectChromium() ?? 'bundled-by-mermaid-cli',
    theme:              process.env.DIAGRAM_THEME ?? 'default',
    background:         process.env.DIAGRAM_BACKGROUND ?? 'transparent',
    font_family:        process.env.DIAGRAM_FONT_FAMILY ?? null,
    puppeteer_cfg:      fileFingerprint(puppeteerCfgPath) ?? { path: puppeteerCfgPath, sha256: null },
    mermaid_cfg:        fileFingerprint(mermaidCfgPath),
    css:                fileFingerprint(cssPath),
  };


  // Canonical JSON → SHA. Sorted keys so the hash is stable.
  const canonical = JSON.stringify(profile, Object.keys(profile).sort());
  profile.profile_sha256 = sha256(canonical);
  return profile;
}

// CLI: `node scripts/diagram-render-profile.mjs` prints the current profile.
if (import.meta.url === `file://${process.argv[1]}`) {
  const p = getRenderProfile();
  console.log(JSON.stringify(p, null, 2));
}
