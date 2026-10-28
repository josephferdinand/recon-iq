#!/usr/bin/env node
/**
 * Renders every docs/diagrams/*.mmd to SVG + PNG under docs/diagrams/rendered/.
 * Used both locally (npm run diagrams:render) and in CI.
 *
 * Applies the FVI canonical Mermaid theme (see /mermaid-fvi-theme.json in repo
 * root) via --configFile. Override with the DIAGRAM_MERMAID_CFG env var.
 */
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, extname, resolve } from 'node:path';

const SRC = 'docs/diagrams';
const OUT = 'docs/diagrams/rendered';
const DEFAULT_THEME = resolve('mermaid-fvi-theme.json');
mkdirSync(OUT, { recursive: true });

const puppeteerCfg = join(OUT, '.puppeteer.json');
writeFileSync(puppeteerCfg, JSON.stringify({ args: ['--no-sandbox'] }));

const mermaidCfg = process.env.DIAGRAM_MERMAID_CFG || DEFAULT_THEME;
const mmdc = resolve('node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js');

const files = readdirSync(SRC).filter(f => f.endsWith('.mmd'));
let ok = 0, fail = 0;
for (const f of files) {
  const base = basename(f, extname(f));
  for (const ext of ['svg', 'png']) {
    const inPath = join(SRC, f);
    const outPath = join(OUT, `${base}.${ext}`);
    try {
      execFileSync(
        process.execPath,
        [mmdc, '-p', puppeteerCfg, '-C', mermaidCfg, '-i', inPath, '-o', outPath, '-b', 'transparent'],
        { stdio: 'pipe' },
      );
      ok++;
      console.log(`OK   ${outPath}`);
    } catch (e) {
      fail++;
      const stderr = e.stderr?.toString().trim();
      console.error(`FAIL ${outPath}: ${stderr || e.message.split('\n')[0]}`);
    }
  }
}
console.log(`\nRendered: ${ok} ok, ${fail} failed (of ${files.length} sources)`);
process.exit(fail > 0 ? 1 : 0);
