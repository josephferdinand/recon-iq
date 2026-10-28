// LL-046: post-build patch. Strips auto-generated `init_X()` calls from
// the cyclic router chunks for UI primitive modules that have NO side
// effects. With the source converted to `function` declarations (LL-043),
// these `var init_X = __esmMin((() => {}))` thunks are unnecessary and
// trigger the cyclic TDZ binding (LL-016).
//
// Targets the empty-body pattern produced by LL-043 source conversion:
//     var init_X = __esmMin((() => {}));
// and rewrites it to a no-op to avoid the cyclic TDZ binding.

import * as fs from "node:fs";
import * as path from "node:path";

const SSR_DIR = "dist/_worker.js/_ssr";

function patchFile(filepath) {
  let src = fs.readFileSync(filepath, "utf8");
  let changed = false;
  // Match the empty init_X declaration and replace it.
  const newSrc = src.replace(
    /var\s+(init_\w+)\s*=\s*__esmMin\(\(\(\)\s*=>\s*\{\}\)\);?/g,
    "/* LL-046: stripped empty init thunk (cyclic TDZ avoid) */\nvar $1 = () => {};",
  );
  if (newSrc !== src) {
    fs.writeFileSync(filepath, newSrc);
    changed = true;
  }
  return changed;
}

function main() {
  const absDir = path.resolve(process.cwd(), SSR_DIR);
  if (!fs.existsSync(absDir)) {
    console.error("dir not found:", absDir);
    process.exit(1);
  }
  const files = fs.readdirSync(absDir).filter((f) => f.endsWith(".mjs"));
  let patched = 0;
  for (const f of files) {
    const fp = path.join(absDir, f);
    if (patchFile(fp)) {
      patched++;
    }
  }
  console.log(`patched: ${patched} files`);
}

main();
