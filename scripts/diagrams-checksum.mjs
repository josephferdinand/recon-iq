#!/usr/bin/env node
/**
 * FVI · Diagram checksum + drift gate.
 *
 *   node scripts/diagrams-checksum.mjs --seed       # write manifest from current files
 *   node scripts/diagrams-checksum.mjs --verify     # fail if any output is stale
 *   node scripts/diagrams-checksum.mjs --update <names...>  # refresh entries after re-render
 *   node scripts/diagrams-checksum.mjs --report     # print human-readable status table
 *
 * The manifest (docs/diagrams/rendered/.manifest.json) is the single source of
 * truth for "the rendered SVG + PNG correspond to this .mmd content". The
 * pre-commit hook and the CI `diagrams` job both invoke `--verify`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getRenderProfile } from './diagram-render-profile.mjs';

const SRC_DIR   = 'docs/diagrams';
const OUT_DIR   = 'docs/diagrams/rendered';
const MANIFEST  = join(OUT_DIR, '.manifest.json');
const EXTS      = ['svg', 'png'];


function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function normalizeDiagramSource(buf) {
  return Buffer.from(buf.toString('utf8').replace(/\r\n?/gu, '\n'), 'utf8');
}

export function sha256DiagramSource(buf) {
  return sha256(normalizeDiagramSource(buf));
}

export function sha256DiagramOutput(buf, extension) {
  return extension === 'svg' ? sha256DiagramSource(buf) : sha256(buf);
}

function listSources() {
  if (!existsSync(SRC_DIR)) return [];
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.mmd'))
    .map((f) => basename(f, extname(f)))
    .sort();
}

function readManifest() {
  if (!existsSync(MANIFEST)) {
    return { version: 1, generated_at: null, diagrams: {} };
  }
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${MANIFEST}: ${e.message}`);
    return { version: 1, generated_at: null, diagrams: {} };
  }
}

function writeManifest(m) {
  m.generated_at = new Date().toISOString();
  // Deterministic key order so diffs are clean.
  const sorted = {};
  for (const k of Object.keys(m.diagrams).sort()) sorted[k] = m.diagrams[k];
  m.diagrams = sorted;
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}

function entryFor(name, profile) {
  const src = join(SRC_DIR, `${name}.mmd`);
  if (!existsSync(src)) return null;
  const entry = {
    source: src,
    mmd_sha256: sha256DiagramSource(readFileSync(src)),
    outputs: {},
    rendered_at: new Date().toISOString(),
    render_profile: profile, // full profile snapshot — keeps the sha self-auditable
  };
  for (const ext of EXTS) {
    const out = join(OUT_DIR, `${name}.${ext}`);
    entry.outputs[ext] = existsSync(out)
      ? { path: out, sha256: sha256DiagramOutput(readFileSync(out), ext), bytes: statSync(out).size }
      : { path: out, sha256: null, bytes: 0, missing: true };
  }
  return entry;
}


function cmdSeed() {
  const profile = getRenderProfile();
  const manifest = { version: 1, generated_at: null, active_profile: profile, diagrams: {} };
  let missing = 0;
  for (const name of listSources()) {
    const e = entryFor(name, profile);
    manifest.diagrams[name] = e;
    for (const ext of EXTS) {
      if (e.outputs[ext].missing) {
        console.warn(`WARN  ${name}.${ext} missing on disk`);
        missing++;
      }
    }
  }
  writeManifest(manifest);
  console.log(`Seeded ${Object.keys(manifest.diagrams).length} diagrams → ${MANIFEST}`);
  console.log(`Active render profile: ${profile.profile_sha256.slice(0, 12)}  (mermaid-cli ${profile.mermaid_cli}, puppeteer ${profile.puppeteer}, chromium ${profile.chromium}, theme ${profile.theme})`);
  if (missing > 0) console.warn(`WARN  ${missing} rendered file(s) missing — run npm run diagrams:render`);
  return 0;
}

function cmdUpdate(names) {
  const manifest = readManifest();
  const profile = getRenderProfile();
  manifest.active_profile = profile;
  for (const name of names) {
    const e = entryFor(name, profile);
    if (!e) {
      console.error(`No source for ${name}`);
      return 1;
    }
    manifest.diagrams[name] = e;
    console.log(`Updated ${name}  (profile ${profile.profile_sha256.slice(0, 12)})`);
  }
  writeManifest(manifest);
  return 0;
}


function cmdVerify() {
  const manifest = readManifest();
  const sources = listSources();
  const activeProfile = getRenderProfile();
  const strictProfile = process.env.DIAGRAM_STRICT_PROFILE !== '0';
  const drift = [];

  // 1. Every source must have a manifest entry whose mmd_sha256 + render_profile match.
  for (const name of sources) {
    const currentMmd = sha256DiagramSource(readFileSync(join(SRC_DIR, `${name}.mmd`)));
    const entry = manifest.diagrams[name];
    if (!entry) {
      drift.push({ name, reason: 'missing-manifest-entry', detail: 'no entry in manifest' });
      continue;
    }
    if (entry.mmd_sha256 !== currentMmd) {
      drift.push({
        name,
        reason: 'source-changed',
        detail: `mmd sha mismatch — re-render required (was ${entry.mmd_sha256.slice(0, 8)}, now ${currentMmd.slice(0, 8)})`,
      });
      continue;
    }
    // Render-profile drift: visual config changed (puppeteer, chromium, theme, fonts, css).
    const entryProfile = entry.render_profile?.profile_sha256;
    if (strictProfile && entryProfile && entryProfile !== activeProfile.profile_sha256) {
      drift.push({
        name,
        reason: 'profile-changed',
        detail: `render profile shifted (was ${entryProfile.slice(0, 8)}, now ${activeProfile.profile_sha256.slice(0, 8)}) — re-render required`,
      });
      continue;
    }

    for (const ext of EXTS) {
      const out = join(OUT_DIR, `${name}.${ext}`);
      if (!existsSync(out)) {
        drift.push({ name, reason: 'output-missing', detail: `${out} not on disk` });
        continue;
      }
      const currentOut = sha256DiagramOutput(readFileSync(out), ext);
      const expected = entry.outputs?.[ext]?.sha256;
      if (currentOut !== expected) {
        drift.push({
          name,
          reason: 'output-tampered',
          detail: `${ext} sha mismatch (expected ${String(expected).slice(0, 8)}, got ${currentOut.slice(0, 8)})`,
        });
      }
    }
  }

  // 2. Manifest entries with no source are stale → block too.
  const sourceSet = new Set(sources);
  for (const name of Object.keys(manifest.diagrams)) {
    if (!sourceSet.has(name)) {
      drift.push({ name, reason: 'orphan-entry', detail: 'manifest references deleted source' });
    }
  }

  if (drift.length === 0) {
    console.log(`OK  ${sources.length} diagrams in sync with manifest.`);
    return 0;
  }
  console.error(`DRIFT  ${drift.length} issue(s):`);
  for (const d of drift) {
    console.error(`  - ${d.name}: ${d.reason} — ${d.detail}`);
  }
  console.error('\nFix: run `npm run diagrams:render` then `node scripts/diagrams-checksum.mjs --seed`,');
  console.error('     then stage docs/diagrams/rendered/ and re-run the commit.');
  return 1;
}

function cmdReport() {
  const manifest = readManifest();
  const rows = Object.entries(manifest.diagrams).map(([name, e]) => ({
    name,
    mmd: e.mmd_sha256.slice(0, 8),
    svg: e.outputs?.svg?.sha256?.slice(0, 8) ?? '------',
    png: e.outputs?.png?.sha256?.slice(0, 8) ?? '------',
    rendered_at: e.rendered_at,
  }));
  console.table(rows);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = args[0];
  let code = 0;
  switch (flag) {
    case '--seed':   code = cmdSeed(); break;
    case '--verify': code = cmdVerify(); break;
    case '--update': code = cmdUpdate(args.slice(1)); break;
    case '--report': code = cmdReport(); break;
    default:
      console.error('Usage: diagrams-checksum.mjs --seed | --verify | --update <names...> | --report');
      code = 2;
  }
  process.exit(code);
}
