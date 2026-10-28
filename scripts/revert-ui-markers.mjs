// LL-039: revert UI primitive globalThis markers (didn't fix the cycle).
import * as fs from "node:fs";
import * as path from "node:path";

const UI_DIR = "src/components/ui";

function revertFile(filepath) {
  const src = fs.readFileSync(filepath, "utf8");
  const base = path.basename(filepath, ".tsx").replace(/[^a-zA-Z0-9]/g, "_");
  const markerLine = `globalThis.__fviUiMarker_${base} = (globalThis.__fviUiMarker_${base} ?? 0) + 1;`;
  if (!src.includes(markerLine)) return false;
  // Find the marker comment block + marker line and remove them.
  const lines = src.split("\n");
  const out = [];
  let skipUntilBlank = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipUntilBlank) {
      if (line.trim() === "") {
        skipUntilBlank = false;
        out.push(line);
      }
      continue;
    }
    if (line.includes(markerLine)) {
      // Also skip the preceding 5-line comment block.
      // Walk back to remove preceding lines that are part of the marker comment.
      while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
      // Remove the preceding comment lines.
      while (
        out.length > 0 &&
        (out[out.length - 1].trim().startsWith("//") || out[out.length - 1].trim() === "")
      ) {
        out.pop();
      }
      skipUntilBlank = true;
      continue;
    }
    out.push(line);
  }
  fs.writeFileSync(filepath, out.join("\n"));
  return true;
}

function main() {
  const absDir = path.resolve(process.cwd(), UI_DIR);
  const files = fs.readdirSync(absDir).filter((f) => f.endsWith(".tsx"));
  let reverted = 0;
  for (const f of files) {
    const fp = path.join(absDir, f);
    if (revertFile(fp)) {
      console.log("reverted:", f);
      reverted++;
    }
  }
  console.log(`done: ${reverted} files reverted`);
}

main();
