// LL-039 helper: apply globalThis side-effect marker to all UI primitive
// .tsx files so they have a non-empty init body across the cyclic edge.
import * as fs from "node:fs";
import * as path from "node:path";

const UI_DIR = "src/components/ui";

function convertFile(filepath) {
  const src = fs.readFileSync(filepath, "utf8");
  if (!src.includes("React.forwardRef")) return false;
  const base = path.basename(filepath, ".tsx").replace(/[^a-zA-Z0-9]/g, "_");
  const MARKER = `
// LL-039 (Felix): LL-016 cyclic-router TDZ guard. This module sits on the
// marketing router-1 <-> router-2 cyclic edge; without an observable
// side effect rolldown collapses init_<module> to (() => {}) across
// the cycle, producing "init_<module> is not a function" at route
// registration. Writing to globalThis keeps the init body live.
globalThis.__fviUiMarker_${base} = (globalThis.__fviUiMarker_${base} ?? 0) + 1;
`;
  const lines = src.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^import\s/)) lastImportIdx = i;
  }
  if (lastImportIdx < 0) return false;
  if (src.includes(`__fviUiMarker_${base}`)) return false; // already patched
  lines.splice(lastImportIdx + 1, 0, MARKER);
  fs.writeFileSync(filepath, lines.join("\n"));
  return true;
}

function main() {
  const absDir = path.resolve(process.cwd(), UI_DIR);
  const files = fs.readdirSync(absDir).filter((f) => f.endsWith(".tsx"));
  let converted = 0;
  for (const f of files) {
    const fp = path.join(absDir, f);
    if (convertFile(fp)) {
      console.log("patched:", f);
      converted++;
    }
  }
  console.log(`done: ${converted}/${files.length} files patched`);
}

main();
