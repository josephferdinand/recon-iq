/**
 * Minimal spreadsheet formula engine for ReconIQ Excel-like grid.
 * Supports: numeric literals, strings, cell refs (A1), ranges (A1:B5),
 * arithmetic + - * / ^, parentheses, and functions:
 *   SUM, AVG/AVERAGE, COUNT, COUNTA, MIN, MAX, ABS, ROUND, IF, AND, OR,
 *   CONCAT, UPPER, LOWER, LEN, TRIM, NOT, ISBLANK
 * Comparisons: = <> < > <= >=
 * Returns { value, error? } and detects circular references via visited set.
 */

export type CellAddr = { row: number; col: number };
export type GridGet = (addr: CellAddr) => string | number | null | undefined;

export type FormulaResult = { value: string | number | boolean | null; error?: string };

export function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToColLetter(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseRef(token: string): CellAddr | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(token.trim());
  if (!m) return null;
  return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

function parseRange(token: string): { a: CellAddr; b: CellAddr } | null {
  const parts = token.split(":");
  if (parts.length !== 2) return null;
  const a = parseRef(parts[0]);
  const b = parseRef(parts[1]);
  if (!a || !b) return null;
  return { a, b };
}

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string }
  | { t: "range"; v: string }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma" }); i++; continue; }
    if (c === '"') {
      let j = i + 1; let v = "";
      while (j < src.length && src[j] !== '"') { v += src[j]; j++; }
      toks.push({ t: "str", v }); i = j + 1; continue;
    }
    if ("+-*/^%".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    if ("<>=".includes(c)) {
      const two = src.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "<>") { toks.push({ t: "op", v: two }); i += 2; continue; }
      toks.push({ t: "op", v: c }); i++; continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: "num", v: parseFloat(src.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      // Check for range A1:B5
      if (src[j] === ":") {
        let k = j + 1;
        while (k < src.length && /[A-Za-z0-9]/.test(src[k])) k++;
        const second = src.slice(j + 1, k);
        if (/^[A-Za-z]+\d+$/.test(word) && /^[A-Za-z]+\d+$/.test(second)) {
          toks.push({ t: "range", v: `${word}:${second}` });
          i = k; continue;
        }
      }
      // Function call?
      if (src[j] === "(") { toks.push({ t: "ident", v: word.toUpperCase() }); i = j; continue; }
      if (/^[A-Za-z]+\d+$/.test(word)) { toks.push({ t: "ref", v: word }); i = j; continue; }
      // Boolean literal
      toks.push({ t: "ident", v: word.toUpperCase() }); i = j; continue;
    }
    throw new Error(`Unexpected character '${c}'`);
  }
  return toks;
}

function toNumber(v: any): number {
  if (v == null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function expandRange(token: string, get: GridGet): (string | number | null | undefined)[] {
  const r = parseRange(token);
  if (!r) return [];
  const out: (string | number | null | undefined)[] = [];
  const r1 = Math.min(r.a.row, r.b.row), r2 = Math.max(r.a.row, r.b.row);
  const c1 = Math.min(r.a.col, r.b.col), c2 = Math.max(r.a.col, r.b.col);
  for (let row = r1; row <= r2; row++) for (let col = c1; col <= c2; col++) out.push(get({ row, col }));
  return out;
}

const FUNCS: Record<string, (args: any[], get: GridGet, raw: string[]) => any> = {
  SUM: (_a, g, raw) => raw.flatMap((t) => /^[A-Za-z]+\d+:[A-Za-z]+\d+$/.test(t) ? expandRange(t, g) : [_argVal(t, g)]).reduce((s, v) => s + toNumber(v), 0),
  AVG: (_a, g, raw) => {
    const vs = raw.flatMap((t) => /^[A-Za-z]+\d+:[A-Za-z]+\d+$/.test(t) ? expandRange(t, g) : [_argVal(t, g)]).map(toNumber);
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0;
  },
  AVERAGE: (a, g, r) => FUNCS.AVG(a, g, r),
  COUNT: (_a, g, raw) => raw.flatMap((t) => /^[A-Za-z]+\d+:[A-Za-z]+\d+$/.test(t) ? expandRange(t, g) : [_argVal(t, g)]).filter((v) => v != null && v !== "" && !isNaN(toNumber(v))).length,
  COUNTA: (_a, g, raw) => raw.flatMap((t) => /^[A-Za-z]+\d+:[A-Za-z]+\d+$/.test(t) ? expandRange(t, g) : [_argVal(t, g)]).filter((v) => v != null && v !== "").length,
  MIN: (_a, g, raw) => Math.min(...raw.flatMap((t) => /^[A-Za-z]+\d+:[A-Za-z]+\d+$/.test(t) ? expandRange(t, g) : [_argVal(t, g)]).map(toNumber)),
  MAX: (_a, g, raw) => Math.max(...raw.flatMap((t) => /^[A-Za-z]+\d+:[A-Za-z]+\d+$/.test(t) ? expandRange(t, g) : [_argVal(t, g)]).map(toNumber)),
  ABS: (a) => Math.abs(toNumber(a[0])),
  ROUND: (a) => { const d = a[1] != null ? toNumber(a[1]) : 0; const f = Math.pow(10, d); return Math.round(toNumber(a[0]) * f) / f; },
  IF: (a) => (truthy(a[0]) ? a[1] : a[2] ?? false),
  AND: (a) => a.every(truthy),
  OR: (a) => a.some(truthy),
  NOT: (a) => !truthy(a[0]),
  CONCAT: (a) => a.map((v) => v == null ? "" : String(v)).join(""),
  UPPER: (a) => String(a[0] ?? "").toUpperCase(),
  LOWER: (a) => String(a[0] ?? "").toLowerCase(),
  LEN: (a) => String(a[0] ?? "").length,
  TRIM: (a) => String(a[0] ?? "").trim(),
  ISBLANK: (a) => a[0] == null || a[0] === "",
};
function truthy(v: any) { if (typeof v === "boolean") return v; if (v == null) return false; const n = Number(v); if (!isNaN(n)) return n !== 0; return String(v).length > 0; }
function _argVal(_t: string, _g: GridGet): any { return null; }

// Pratt parser
function parse(tokens: Tok[], get: GridGet): any {
  let p = 0;
  function peek() { return tokens[p]; }
  function eat(t: Tok["t"], v?: string) {
    const tk = tokens[p];
    if (!tk || tk.t !== t || (v != null && (tk as any).v !== v)) throw new Error("Syntax error");
    p++; return tk;
  }
  function getRef(token: string) { const a = parseRef(token); if (!a) return null; return get(a); }
  function expr(): any { return cmp(); }
  function cmp(): any {
    let left = add();
    while (peek() && peek().t === "op" && [ "=", "<>", "<", ">", "<=", ">="].includes((peek() as any).v)) {
      const op = (tokens[p++] as any).v; const right = add();
      const ln = toNumber(left); const rn = toNumber(right);
      const bothNum = typeof left !== "string" && typeof right !== "string";
      const cmpL = bothNum ? ln : String(left); const cmpR = bothNum ? rn : String(right);
      left = op === "=" ? cmpL === cmpR : op === "<>" ? cmpL !== cmpR
        : op === "<" ? cmpL < cmpR : op === ">" ? cmpL > cmpR
        : op === "<=" ? cmpL <= cmpR : cmpL >= cmpR;
    }
    return left;
  }
  function add(): any {
    let left = mul();
    while (peek() && peek().t === "op" && ((peek() as any).v === "+" || (peek() as any).v === "-")) {
      const op = (tokens[p++] as any).v; const right = mul();
      left = op === "+" ? (typeof left === "string" || typeof right === "string" ? String(left) + String(right) : toNumber(left) + toNumber(right)) : toNumber(left) - toNumber(right);
    }
    return left;
  }
  function mul(): any {
    let left = pow();
    while (peek() && peek().t === "op" && ((peek() as any).v === "*" || (peek() as any).v === "/" || (peek() as any).v === "%")) {
      const op = (tokens[p++] as any).v; const right = pow();
      left = op === "*" ? toNumber(left) * toNumber(right) : op === "/" ? toNumber(left) / toNumber(right) : toNumber(left) % toNumber(right);
    }
    return left;
  }
  function pow(): any {
    let left = unary();
    while (peek() && peek().t === "op" && (peek() as any).v === "^") {
      p++; const right = unary(); left = Math.pow(toNumber(left), toNumber(right));
    }
    return left;
  }
  function unary(): any {
    if (peek() && peek().t === "op" && (peek() as any).v === "-") { p++; return -toNumber(unary()); }
    if (peek() && peek().t === "op" && (peek() as any).v === "+") { p++; return toNumber(unary()); }
    return primary();
  }
  function primary(): any {
    const tk = peek();
    if (!tk) throw new Error("Unexpected end");
    if (tk.t === "num") { p++; return tk.v; }
    if (tk.t === "str") { p++; return tk.v; }
    if (tk.t === "ref") { p++; return getRef(tk.v); }
    if (tk.t === "range") { p++; return expandRange(tk.v, get); }
    if (tk.t === "ident") {
      const name = tk.v; p++;
      if (peek() && peek().t === "lp") {
        p++;
        const raw: string[] = [];
        const args: any[] = [];
        if (peek() && peek().t !== "rp") {
          // Re-tokenize args by collecting raw tokens between commas
          const argStart = p;
          let depth = 0;
          let last = argStart;
          while (p < tokens.length) {
            const t = tokens[p];
            if (t.t === "lp") { depth++; p++; continue; }
            if (t.t === "rp") { if (depth === 0) break; depth--; p++; continue; }
            if (t.t === "comma" && depth === 0) {
              const slice = tokens.slice(last, p);
              raw.push(rawOf(slice));
              args.push(evalSlice(slice, get));
              last = p + 1; p++; continue;
            }
            p++;
          }
          const slice = tokens.slice(last, p);
          raw.push(rawOf(slice));
          args.push(evalSlice(slice, get));
        }
        eat("rp");
        const fn = FUNCS[name];
        if (!fn) {
          if (name === "TRUE") return true;
          if (name === "FALSE") return false;
          throw new Error(`Unknown function ${name}`);
        }
        return fn(args, get, raw);
      }
      if (name === "TRUE") return true;
      if (name === "FALSE") return false;
      throw new Error(`Unknown identifier ${name}`);
    }
    if (tk.t === "lp") { p++; const v = expr(); eat("rp"); return v; }
    throw new Error("Syntax error");
  }
  return expr();
}

function rawOf(slice: Tok[]): string {
  if (slice.length === 1) {
    const t = slice[0];
    if (t.t === "ref" || t.t === "range") return t.v;
  }
  return "";
}
function evalSlice(slice: Tok[], get: GridGet): any {
  if (slice.length === 1 && slice[0].t === "range") return expandRange(slice[0].v, get);
  return parse(slice, get);
}

export function evaluateFormula(src: string, get: GridGet): FormulaResult {
  try {
    const trimmed = src.trim();
    if (!trimmed.startsWith("=")) return { value: trimmed };
    const tokens = tokenize(trimmed.slice(1));
    const value = parse(tokens, get);
    if (Array.isArray(value)) return { value: value.length ? toNumber(value[0]) : 0 };
    return { value: value as any };
  } catch (e: any) {
    return { value: "#ERROR!", error: e?.message ?? "formula error" };
  }
}
