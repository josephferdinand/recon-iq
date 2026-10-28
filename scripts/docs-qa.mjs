#!/usr/bin/env node
/**
 * FVI Documentation QA — release-gate script.
 *
 * Checks every doc cluster for:
 *   1. presence of a "v2 Updates (June 2026)" section
 *   2. at least one cross-reference to docs/CHANGELOG_v2.md
 *   3. no broken relative markdown links
 *
 * Exit code 0 = pass, 1 = fail. Designed for CI.
 *
 * Usage:
 *   node scripts/docs-qa.mjs              # full audit
 *   node scripts/docs-qa.mjs --quiet      # only summary + failures
 *   node scripts/docs-qa.mjs --json       # machine-readable
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const CHANGELOG = "docs/CHANGELOG_v2.md";
const SECTION_RE = /v2 Updates \(June 2026\)/i;
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

const CLUSTERS = [
  { dir: "docs", required: true },
  { dir: "docs/architecture", required: true },
  { dir: "docs/architecture/legal", required: true },
  { dir: "docs/research", required: true },
];

const args = new Set(process.argv.slice(2));
const QUIET = args.has("--quiet");
const JSON_MODE = args.has("--json");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) continue; // cluster-level only; sub-dirs handled separately
    if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function checkLinks(file, body) {
  const broken = [];
  for (const m of body.matchAll(LINK_RE)) {
    const href = m[1].split("#")[0].split(" ")[0].trim();
    if (!href) continue;
    if (/^(https?:|mailto:|mem:|tel:)/.test(href)) continue;
    const target = resolve(ROOT, dirname(file), href);
    if (!existsSync(target)) broken.push(href);
    else {
      try { statSync(target); } catch { broken.push(href); }
    }
  }
  return broken;
}

const findings = [];
const summary = { files: 0, missing_section: 0, missing_changelog: 0, broken_links: 0 };

for (const cluster of CLUSTERS) {
  if (!existsSync(join(ROOT, cluster.dir))) continue;
  const files = await walk(cluster.dir);
  for (const f of files) {
    if (f === CHANGELOG) continue;
    if (/RELEASE_NOTES_v2|AUDIT_EXPORT_MANIFEST/i.test(f)) continue;
    summary.files += 1;
    const body = readFileSync(join(ROOT, f), "utf8");
    const hasSection = SECTION_RE.test(body);
    const hasChangelogRef = body.includes("CHANGELOG_v2.md") || body.includes("CHANGELOG_v2");
    const broken = checkLinks(f, body);
    if (!hasSection || !hasChangelogRef || broken.length) {
      if (!hasSection) summary.missing_section += 1;
      if (!hasChangelogRef) summary.missing_changelog += 1;
      summary.broken_links += broken.length;
      findings.push({ file: f, hasSection, hasChangelogRef, broken });
    }
  }
}

if (JSON_MODE) {
  console.log(JSON.stringify({ summary, findings }, null, 2));
} else {
  if (!QUIET) {
    console.log(`Docs QA — scanned ${summary.files} files across ${CLUSTERS.length} clusters.`);
  }
  for (const f of findings) {
    console.log(`\n✖ ${f.file}`);
    if (!f.hasSection) console.log("   • missing 'v2 Updates (June 2026)' section");
    if (!f.hasChangelogRef) console.log("   • missing CHANGELOG_v2.md reference");
    for (const b of f.broken) console.log(`   • broken link: ${b}`);
  }
  console.log(
    `\nSummary: ${summary.missing_section} missing sections, ` +
    `${summary.missing_changelog} missing changelog refs, ` +
    `${summary.broken_links} broken links.`,
  );
}

process.exit(findings.length ? 1 : 0);
