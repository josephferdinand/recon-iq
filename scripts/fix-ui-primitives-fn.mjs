// LL-043: convert UI primitives from
//   `const X = React.forwardRef(...)` + `X.displayName = "X"`
// to
//   `function X(props, ref) { return <... /> }` (hoisted)
// so the bundle emits a hoisted `function X()` instead of
// `var init_X = __esmMin(...)`. Removes the cyclic TDZ binding entirely.

import * as fs from "node:fs";
import * as path from "node:path";

const UI_DIR = "src/components/ui";

// match:  const X = React.forwardRef<Props, More>((args) => (...));
//   ...trailing `)` and subsequent `X.displayName = "X";`
const PATTERN = /const\s+(\w+)\s*=\s*React\.forwardRef[^{]*\{([\s\S]*?)\}\)\s*\)\s*;\s*\n\s*\1\.displayName\s*=\s*["']\1["']\s*;/g;

function convertFile(filepath) {
  let src = fs.readFileSync(filepath, "utf8");
  if (!src.includes("React.forwardRef")) return false;
  if (src.includes("// LL-043: already converted")) return false;

  // Strategy: drop the forwardRef wrapper. Replace with a function returning the
  //    rendered element with `ref` attached via React's special-casing for props.ref.
  // For simplicity (and to keep types), we still use `React.forwardRef` at runtime,
  //    but we wrap THAT in a hoisted function declaration.
  //
  //    function X(props, ref) { return React.forwardRef(/* handler */); }  <-- no,
  //    forwardRef must be called at construction time to register the component.
  //
  // Better strategy: drop forwardRef wrapping and use direct ref handling.
  //    A standard function component receives `props` and ref is forwarded via
  //    `React.createElement`'s special-cased `ref` prop.
  //
  // Simplest robust strategy: wrap each `const X = React.forwardRef(...); X.displayName = "X";`
  // in a hoisted function that LAZILY creates the component.
  //
  //    function X(props) {
  //      const F = React.forwardRef<...>((_, ref) => <element ref={ref} {...props} />);
  //      return React.createElement(F, props);
  //    }
  //
  // This wraps the inner forwardRef in a hoisted function, eliminating the cyclic
  // `var init_X = __esmMin(...)` binding.

  // Use regex to find each const X = React.forwardRef(...) block + displayName line.
  const regex = /const\s+(\w+)\s*=\s*React\.forwardRef[\s\S]*?\)\s*;\s*\n\s*\1\.displayName\s*=\s*["']\1["']\s*;/g;
  let changed = false;
  src = src.replace(regex, (match, name) => {
    changed = true;
    return `// LL-043: converted from React.forwardRef to hoisted function (cycles-break)
function ${name}(props) {
  return React.createElement(React.forwardRef((innerProps, ref) => (
    <div ref={ref} {...innerProps} />
  )), props);
}
${name}.displayName = "${name}";`;
  });
  if (!changed) return false;
  fs.writeFileSync(filepath, src);
  return true;
}

function main() {
  const absDir = path.resolve(process.cwd(), UI_DIR);
  const files = fs.readdirSync(absDir).filter((f) => f.endsWith(".tsx"));
  let converted = 0;
  for (const f of files) {
    const fp = path.join(absDir, f);
    if (convertFile(fp)) {
      console.log("converted:", f);
      converted++;
    }
  }
  console.log(`done: ${converted}/${files.length} files converted`);
}

main();
