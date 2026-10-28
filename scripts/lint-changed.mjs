import { execFileSync } from "node:child_process";
import { ESLint } from "eslint";

const ROOT = process.cwd();
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/i;

function git(...args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function listChangedFiles() {
  const tracked = git("diff", "--name-only", "--diff-filter=ACMR", "HEAD")
    .split(/\r?\n/)
    .filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard")
    .split(/\r?\n/)
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter((file) => SOURCE_EXT.test(file));
}

function addedRanges(file, untracked) {
  if (untracked.has(file)) return [{ start: 1, end: Number.POSITIVE_INFINITY }];
  const patch = git("diff", "--unified=0", "--no-color", "HEAD", "--", file);
  const ranges = [];
  for (const line of patch.split(/\r?\n/)) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) ranges.push({ start, end: start + count - 1 });
  }
  return ranges;
}

const files = listChangedFiles();
if (files.length === 0) {
  console.log("lint:changed PASS (no changed source files)");
  process.exit(0);
}

const untracked = new Set(
  git("ls-files", "--others", "--exclude-standard").split(/\r?\n/).filter(Boolean),
);
const rangeMap = new Map(files.map((file) => [file, addedRanges(file, untracked)]));
const eslint = new ESLint({
  overrideConfig: { rules: { "prettier/prettier": "off" } },
});
const results = await eslint.lintFiles(files);
const violations = [];

for (const result of results) {
  const relative = result.filePath.replaceAll("\\", "/").replace(`${ROOT.replaceAll("\\", "/")}/`, "");
  const ranges = rangeMap.get(relative) ?? [];
  for (const message of result.messages) {
    if (!message.line) continue;
    if (ranges.some(({ start, end }) => message.line >= start && message.line <= end)) {
      violations.push({ file: relative, ...message });
    }
  }
}

if (violations.length > 0) {
  for (const item of violations) {
    console.error(`${item.file}:${item.line}:${item.column} ${item.severity === 2 ? "error" : "warning"} ${item.ruleId ?? "parse"} ${item.message}`);
  }
  console.error(`lint:changed FAIL (${violations.length} changed-line finding(s))`);
  process.exit(1);
}

console.log(`lint:changed PASS (${files.length} changed source file(s))`);
