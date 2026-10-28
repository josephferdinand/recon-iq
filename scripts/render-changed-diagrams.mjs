#!/usr/bin/env node
/**
 * FVI · Selective diagram renderer (used in CI on PRs).
 *
 * Given a git base ref (default: origin/main), find every `.mmd` source under
 * docs/diagrams that has changed in the working tree vs. base — and only
 * re-render those. After rendering, refresh the manifest entries and emit a
 * markdown report to `$DIAGRAM_REPORT_PATH` (default /tmp/diagram-report.md)
 * that the CI job posts as a PR comment.
 *
 *   node scripts/render-changed-diagrams.mjs [base-ref]
 *
 * Exit codes:
 *   0 — no changes OR all renders succeeded AND manifest verifies
 *   1 — render failure or post-render drift
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, dirname, extname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { getRenderProfile } from "./diagram-render-profile.mjs";

const SRC_DIR = "docs/diagrams";
const OUT_DIR = "docs/diagrams/rendered";
const MANIFEST = join(OUT_DIR, ".manifest.json");
const REPORT_PATH = process.env.DIAGRAM_REPORT_PATH || "/tmp/diagram-report.md";
const BASE_REF = process.argv[2] || process.env.DIAGRAM_BASE_REF || "origin/main";
if (!/^[A-Za-z0-9._/]+$/u.test(BASE_REF) || BASE_REF.startsWith("-")) {
  throw new Error("Diagram base ref must be a branch, tag, or commit identifier");
}
const FORCE = process.env.DIAGRAM_FORCE_RENDER === "1" || process.argv.includes("--force");
const DEFAULT_THEME = resolve("mermaid-fvi-theme.json");
const MMDC = resolve("node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");

mkdirSync(OUT_DIR, { recursive: true });

const puppeteerCfg = join(OUT_DIR, ".puppeteer.json");
writeFileSync(puppeteerCfg, JSON.stringify({ args: ["--no-sandbox"] }));
const mermaidCfg = process.env.DIAGRAM_MERMAID_CFG || DEFAULT_THEME;

// Resolve the active render profile ONCE; the manifest stamp on each entry is
// compared against this to decide whether cached SVG/PNGs are still valid.
const ACTIVE_PROFILE = getRenderProfile();

function git(args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
}
function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function sha8(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}
function fileSha8(p) {
  return existsSync(p) ? sha8(readFileSync(p)) : "------";
}

function loadManifest() {
  if (!existsSync(MANIFEST)) return { diagrams: {} };
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return { diagrams: {} };
  }
}

/**
 * Cache check: skip Puppeteer ONLY when ALL of the following hold:
 *   - manifest entry exists for this name
 *   - source `.mmd` SHA matches the manifest entry
 *   - both rendered outputs exist with matching SHAs
 *   - the manifest entry's render_profile.profile_sha256 matches the
 *     currently-active render profile (puppeteer + chromium + theme +
 *     fonts + css + puppeteer cfg). Any visual-config change invalidates.
 * Override with DIAGRAM_FORCE_RENDER=1 or --force.
 */
function cacheStatus(name, manifest) {
  const entry = manifest.diagrams?.[name];
  if (!entry) return { hit: false, reason: "no-manifest-entry" };
  const src = join(SRC_DIR, `${name}.mmd`);
  if (!existsSync(src)) return { hit: false, reason: "source-missing" };
  if (sha256Hex(readFileSync(src)) !== entry.mmd_sha256) {
    return { hit: false, reason: "source-changed" };
  }
  const entryProfile = entry.render_profile?.profile_sha256;
  if (!entryProfile || entryProfile !== ACTIVE_PROFILE.profile_sha256) {
    return {
      hit: false,
      reason: "profile-changed",
      detail: `${String(entryProfile).slice(0, 8) || "——"} → ${ACTIVE_PROFILE.profile_sha256.slice(0, 8)}`,
    };
  }
  for (const ext of ["svg", "png"]) {
    const out = join(OUT_DIR, `${name}.${ext}`);
    const expected = entry.outputs?.[ext]?.sha256;
    if (!expected || !existsSync(out)) return { hit: false, reason: `${ext}-missing` };
    if (sha256Hex(readFileSync(out)) !== expected) return { hit: false, reason: `${ext}-tampered` };
  }
  return { hit: true, reason: "profile+source+outputs match" };
}

function changedSources() {
  let names = [];
  try {
    // diff vs base ref, plus untracked, plus working-tree changes
    const tracked = git(["diff", "--name-only", `${BASE_REF}...HEAD`, "--", `${SRC_DIR}/*.mmd`]).trim();
    const worktree = git(["diff", "--name-only", "--", `${SRC_DIR}/*.mmd`]).trim();
    const staged = git(["diff", "--cached", "--name-only", "--", `${SRC_DIR}/*.mmd`]).trim();
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--", `${SRC_DIR}/*.mmd`]).trim();
    names = [tracked, worktree, staged, untracked].flatMap((s) => s.split("\n")).filter(Boolean);
  } catch (e) {
    // Base ref unavailable → fall back to all sources (safer for first PR).
    console.error(
      `WARN  could not diff against ${BASE_REF} (${e.message.split("\n")[0]}); rendering all.`,
    );
    return null;
  }
  return [...new Set(names)].map((p) => basename(p, extname(p)));
}

function renderOne(name) {
  const src = join(SRC_DIR, `${name}.mmd`);
  if (!existsSync(src)) return { name, ok: false, error: "source missing" };
  const before = {
    svg: fileSha8(join(OUT_DIR, `${name}.svg`)),
    png: fileSha8(join(OUT_DIR, `${name}.png`)),
  };
  for (const ext of ["svg", "png"]) {
    const out = join(OUT_DIR, `${name}.${ext}`);
    try {
      execFileSync(
        process.execPath,
        [MMDC, "-p", puppeteerCfg, "-C", mermaidCfg, "-i", src, "-o", out, "-b", "transparent"],
        { stdio: "pipe" },
      );
    } catch (e) {
      return { name, ok: false, error: e.message.split("\n")[0], before };
    }
  }
  const after = {
    svg: fileSha8(join(OUT_DIR, `${name}.svg`)),
    png: fileSha8(join(OUT_DIR, `${name}.png`)),
  };
  return {
    name,
    ok: true,
    cached: false,
    before,
    after,
    bytes: {
      svg: statSync(join(OUT_DIR, `${name}.svg`)).size,
      png: statSync(join(OUT_DIR, `${name}.png`)).size,
    },
  };
}

function cachedResult(name, reason) {
  const sha = {
    svg: fileSha8(join(OUT_DIR, `${name}.svg`)),
    png: fileSha8(join(OUT_DIR, `${name}.png`)),
  };
  return {
    name,
    ok: true,
    cached: true,
    before: sha,
    after: sha,
    reason,
    bytes: {
      svg: statSync(join(OUT_DIR, `${name}.svg`)).size,
      png: statSync(join(OUT_DIR, `${name}.png`)).size,
    },
  };
}

function listAllSources() {
  if (!existsSync(SRC_DIR)) return [];
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".mmd"))
    .map((name) => basename(name, extname(name)));
}

function writeReport(results, mode, drift) {
  const lines = [];
  const rendered = results.filter((r) => r.ok && !r.cached).length;
  const cached = results.filter((r) => r.ok && r.cached).length;
  lines.push("## Diagram render report");
  lines.push("");
  lines.push(`- Base ref: \`${BASE_REF}\``);
  lines.push(`- Mode: **${mode}**`);
  lines.push(
    `- Re-rendered: **${rendered}** · Cache hits: **${cached}** · Attempted: **${results.length}**`,
  );
  lines.push(
    `- Active render profile: \`${ACTIVE_PROFILE.profile_sha256.slice(0, 12)}\` · mermaid-cli ${ACTIVE_PROFILE.mermaid_cli} · puppeteer ${ACTIVE_PROFILE.puppeteer} · chromium ${ACTIVE_PROFILE.chromium} · theme ${ACTIVE_PROFILE.theme} · bg ${ACTIVE_PROFILE.background}${ACTIVE_PROFILE.font_family ? ` · font ${ACTIVE_PROFILE.font_family}` : ""}`,
  );
  lines.push(
    `- Drift after render: **${drift.length === 0 ? "none" : drift.length + " issue(s)"}**`,
  );
  lines.push("");

  if (results.length > 0) {
    lines.push(
      "| Diagram | Status | SVG sha (before → after) | PNG sha (before → after) | Notes |",
    );
    lines.push("|---|---|---|---|---|");
    for (const r of results) {
      if (r.ok) {
        const status = r.cached ? "cached" : "rendered";
        const svgChanged = r.before.svg !== r.after.svg ? " *(changed)*" : "";
        const pngChanged = r.before.png !== r.after.png ? " *(changed)*" : "";
        lines.push(
          `| \`${r.name}.mmd\` | ${status} | \`${r.before.svg}\` → \`${r.after.svg}\`${svgChanged} | \`${r.before.png}\` → \`${r.after.png}\`${pngChanged} | ${(r.bytes.svg / 1024).toFixed(1)} KiB / ${(r.bytes.png / 1024).toFixed(1)} KiB |`,
        );
      } else {
        lines.push(`| \`${r.name}.mmd\` | **FAIL** | — | — | ${r.error} |`);
      }
    }
    lines.push("");
  } else {
    lines.push("_No `.mmd` sources changed in this PR — nothing to render._");
    lines.push("");
  }
  if (drift.length > 0) {
    lines.push("### Drift detected after render");
    lines.push("");
    for (const d of drift) lines.push(`- \`${d.name}\`: ${d.reason} — ${d.detail}`);
    lines.push("");
    lines.push(
      "Run `npm run diagrams:render && node scripts/diagrams-checksum.mjs --seed` locally and commit the result.",
    );
  } else if (results.length > 0) {
    lines.push("All rendered outputs match their `.mmd` sources via SHA-256 manifest.");
  }
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
  console.log(`Report → ${REPORT_PATH}`);
}

async function main() {
  const list = changedSources();
  let mode, names;
  if (list === null) {
    mode = "full-fallback";
    names = listAllSources();
  } else if (list.length === 0) {
    mode = "no-op";
    names = [];
  } else {
    mode = "changed-only";
    names = list;
  }

  // Global render-profile drift: if the manifest's active_profile differs from
  // the current one, EVERY cached output is suspect — promote the run to a
  // full re-render so visual config changes propagate atomically.
  const manifest = loadManifest();
  const manifestProfile = manifest.active_profile?.profile_sha256;
  if (manifestProfile && manifestProfile !== ACTIVE_PROFILE.profile_sha256) {
    const all = listAllSources();
    const extras = all.filter((n) => !names.includes(n));
    console.log(
      `Render profile changed (${manifestProfile.slice(0, 8)} → ${ACTIVE_PROFILE.profile_sha256.slice(0, 8)}); expanding scope to all ${all.length} diagrams.`,
    );
    names = [...names, ...extras];
    mode = mode === "no-op" ? "profile-drift-full" : `${mode}+profile-drift`;
  }

  console.log(`Mode: ${mode}; targets: ${names.length === 0 ? "(none)" : names.join(", ")}`);

  const results = [];
  for (const n of names) {
    const cache = FORCE ? { hit: false, reason: "force" } : cacheStatus(n, manifest);
    if (cache.hit) {
      console.log(`  ${n} ... cached (${cache.reason})`);
      results.push(cachedResult(n, cache.reason));
      continue;
    }
    process.stdout.write(
      `  rendering ${n} (miss: ${cache.reason}${cache.detail ? " " + cache.detail : ""}) ... `,
    );
    const r = renderOne(n);
    console.log(r.ok ? "ok" : `FAIL (${r.error})`);
    results.push(r);
  }

  // Refresh manifest entries only for diagrams we actually re-rendered;
  // cached entries already match the manifest by definition.
  const renderedNames = results.filter((r) => r.ok && !r.cached).map((r) => r.name);
  if (renderedNames.length > 0) {
    execFileSync(process.execPath, ["scripts/diagrams-checksum.mjs", "--update", ...renderedNames], {
      stdio: "inherit",
    });
  }

  // Always verify the full manifest after render.
  let drift = [];
  try {
    execFileSync(process.execPath, ["scripts/diagrams-checksum.mjs", "--verify"], { stdio: "inherit" });
  } catch {
    // Re-run capturing details for the report.
    try {
      const out = execFileSync(process.execPath, ["scripts/diagrams-checksum.mjs", "--verify"], {
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
      console.log(out);
    } catch (e) {
      const text = (e.stderr?.toString() || e.stdout?.toString() || "").split("\n");
      drift = text
        .filter((l) => l.trim().startsWith("- "))
        .map((l) => {
          const m = l.match(/^\s*-\s+([^:]+):\s+([a-z-]+)\s+—\s+(.*)$/);
          return m
            ? { name: m[1], reason: m[2], detail: m[3] }
            : { name: "unknown", reason: "parse", detail: l };
        });
      if (drift.length === 0)
        drift = [{ name: "(suite)", reason: "verify-failed", detail: "see CI log" }];
    }
  }

  const failedRenders = results.filter((r) => !r.ok);
  writeReport(results, mode, drift);
  if (failedRenders.length > 0 || drift.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
