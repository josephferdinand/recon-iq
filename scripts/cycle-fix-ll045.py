"""
LL-045 cycle-safe refactor for src/lib/tenants.functions.ts.

For each `export const NAME = createServerFn(...).handler(async (...) => { ... });`,
replace with a hoisted function declaration pattern that survives rolldown
__esmMin wrapping across cyclic router chunks:

    function NAME(...args) {
      if (!_NAME) { _NAME = createServerFn(...).handler(...); }
      return _NAME(...args);
    }
    var _NAME;
"""
import re

PATH = "src/lib/tenants.functions.ts"

with open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

pattern = re.compile(r'^export const (\w+) = createServerFn\(', re.MULTILINE)
matches = list(pattern.finditer(src))

def find_chain_end(src, start_of_export):
    """Find byte index just after the terminating `;` of the
    `export const X = createServerFn(...).handler(...);` block.
    The chain ends with `})` (closing the arrow body then the handler call),
    then optional whitespace, then `;`.
    Strategy: track paren+brace depth ignoring strings/templates. The chain
    terminates when we see `)` that brings paren depth to 0 AND the immediately
    preceding non-whitespace token is `}` that brought brace depth to 0.
    Easier: just walk forward, and after each `)`, if paren depth is 0 and
    next non-ws char is `;`, return.
    """
    eq_idx = src.find('=', start_of_export)
    paren = 0
    brace = 0
    i = eq_idx + 1
    in_str = None
    in_tmpl = 0
    while i < len(src):
        ch = src[i]
        if in_str is not None:
            if ch == '\\':
                i += 2
                continue
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if in_tmpl > 0:
            if ch == '\\':
                i += 2
                continue
            if ch == '`':
                in_tmpl -= 1
            elif ch == '$' and i + 1 < len(src) and src[i+1] == '{':
                in_tmpl += 1
                brace += 1
                i += 2
                continue
            i += 1
            continue
        if ch == '"' or ch == "'":
            in_str = ch
            i += 1
            continue
        if ch == '`':
            in_tmpl += 1
            i += 1
            continue
        if ch == '/' and i + 1 < len(src) and src[i+1] == '/':
            # line comment
            j = src.find('\n', i)
            i = len(src) if j == -1 else j
            continue
        if ch == '/' and i + 1 < len(src) and src[i+1] == '*':
            # block comment
            j = src.find('*/', i)
            i = len(src) if j == -1 else j + 2
            continue
        if ch == '(':
            paren += 1
        elif ch == ')':
            paren -= 1
            if paren == 0 and brace == 0:
                # Look for `;`
                j = i + 1
                while j < len(src) and src[j] in ' \t\r\n':
                    j += 1
                if j < len(src) and src[j] == ';':
                    return j + 1
                # If brace still > 0, keep going (we just closed an inner fn)
        elif ch == '{':
            brace += 1
        elif ch == '}':
            brace -= 1
        i += 1
    return None

blocks = []
for m in matches:
    name = m.group(1)
    eq_idx = src.find('=', m.end())
    body_start = eq_idx + 1
    while body_start < len(src) and src[body_start] in ' \t':
        body_start += 1
    chain_end = find_chain_end(src, m.start())
    if chain_end is None:
        print(f"WARN: could not find chain end for {name}")
        continue
    blocks.append((name, m.start(), chain_end, body_start))

# Capture the original bodies first.
orig_bodies = {}
for name, start, end, body_start in blocks:
    orig_bodies[name] = src[body_start:end].rstrip()
    if orig_bodies[name].endswith(';'):
        orig_bodies[name] = orig_bodies[name][:-1].rstrip()

new_src = src
for name, start, end, body_start in reversed(blocks):
    body = orig_bodies[name]
    replacement = (
        f"function {name}(...args) {{\n"
        f"  if (!__{name}) {{\n"
        f"    __{name} = {body};\n"
        f"  }}\n"
        f"  return __{name}(...args);\n"
        f"}}\n"
        f"var __{name};\n"
    )
    new_src = new_src[:start] + replacement + new_src[end:]

with open(PATH, "w", encoding="utf-8") as f:
    f.write(new_src)

print(f"Refactored {len(blocks)} declarations.")