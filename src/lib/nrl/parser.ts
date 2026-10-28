/**
 * ReconIQ Natural Rule Language (NRL) — Parser & Compiler.
 *
 * Hand-rolled recursive-descent parser. Inputs are plain English-ish strings
 * authored by analysts; outputs are canonical CompiledNRLRule JSON consumed by
 * the deterministic reconciliation engine.
 *
 * Supported grammar (case-insensitive keywords; '|' = alternative):
 *
 *   rule        := matchStmt | rollupStmt
 *   matchStmt   := 'match' field 'to' field [tolClause] [whereClause] [passClause] [lookupClause]
 *   rollupStmt  := 'roll' 'up' side 'by' ident ('sum' | 'count' | 'avg' | 'min' | 'max')
 *                  '(' ident ')' [whereClause] [passClause]
 *   tolClause   := 'with' 'tolerance' number ['%']
 *   whereClause := 'where' predicate ('and' predicate)*
 *   predicate   := field ('=' | '!=' | '>' | '<' | '>=' | '<=' | 'like') value
 *   passClause  := 'pass' integer
 *   lookupClause:= 'lookup' field 'in' ident 'as' ident
 *   field       := side '.' ident
 *   side        := 'A' | 'B' | 'C'
 *   value       := number | string | field
 *
 * Examples:
 *   match A.amount to B.amount with tolerance 0.01 where A.currency = B.currency pass 1
 *   match A.trade_id to B.trade_ref where A.book = 'LON' and A.amount > 0 pass 2
 *   roll up A by trade_id sum(quantity) pass 1
 */

export type NRLSide = "A" | "B" | "C";
export type NRLOp = "=" | "!=" | ">" | "<" | ">=" | "<=" | "like";

export interface NRLField { side: NRLSide; column: string }
export interface NRLPredicate { left: NRLField; op: NRLOp; right: NRLField | string | number }
export interface NRLTolerance { type: "abs" | "pct"; value: number }

export interface CompiledMatchRule {
  kind: "match";
  pass: number;
  match: { left: NRLField; right: NRLField; tolerance?: NRLTolerance };
  where: NRLPredicate[];
  lookup?: { source: NRLField; table: string; alias: string };
}

export interface CompiledRollupRule {
  kind: "rollup";
  pass: number;
  side: NRLSide;
  groupBy: string;
  aggregate: { fn: "sum" | "count" | "avg" | "min" | "max"; column: string };
  where: NRLPredicate[];
}

export type CompiledNRLRule = CompiledMatchRule | CompiledRollupRule;

export interface NRLParseError { message: string; position: number }
export interface NRLParseResult { rule?: CompiledNRLRule; errors: NRLParseError[] }

// ---------------- Tokenizer ----------------

type Tok =
  | { type: "ident"; value: string; pos: number }
  | { type: "number"; value: number; pos: number }
  | { type: "string"; value: string; pos: number }
  | { type: "op"; value: string; pos: number }
  | { type: "punct"; value: string; pos: number }
  | { type: "eof"; pos: number };

const KEYWORDS = new Set([
  "match", "to", "with", "tolerance", "where", "and",
  "pass", "roll", "up", "by", "lookup", "in", "as", "like",
]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    // Strings
    if (c === "'" || c === '"') {
      const quote = c; const start = i; i++;
      let val = "";
      while (i < len && src[i] !== quote) { val += src[i++]; }
      if (i >= len) throw mkErr("Unterminated string", start);
      i++;
      toks.push({ type: "string", value: val, pos: start });
      continue;
    }
    // Numbers
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      const start = i;
      if (c === "-") i++;
      while (i < len && /[0-9.]/.test(src[i])) i++;
      const num = Number(src.slice(start, i));
      if (Number.isNaN(num)) throw mkErr("Invalid number", start);
      toks.push({ type: "number", value: num, pos: start });
      continue;
    }
    // Operators
    const two = src.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "!=") {
      toks.push({ type: "op", value: two, pos: i }); i += 2; continue;
    }
    if ("=<>".includes(c)) {
      toks.push({ type: "op", value: c, pos: i }); i++; continue;
    }
    if (c === "%" || c === "(" || c === ")" || c === ",") {
      toks.push({ type: "punct", value: c, pos: i }); i++; continue;
    }
    if (c === ".") {
      toks.push({ type: "punct", value: ".", pos: i }); i++; continue;
    }
    // Identifier
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < len && /[A-Za-z0-9_]/.test(src[i])) i++;
      const value = src.slice(start, i);
      toks.push({ type: "ident", value, pos: start });
      continue;
    }
    throw mkErr(`Unexpected character '${c}'`, i);
  }
  toks.push({ type: "eof", pos: len });
  return toks;
}

function mkErr(message: string, position: number): NRLParseError {
  return { message, position };
}

// ---------------- Parser ----------------

class Parser {
  private p = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok { return this.toks[this.p]; }
  private next(): Tok { return this.toks[this.p++]; }
  private eatKeyword(kw: string): boolean {
    const t = this.peek();
    if (t.type === "ident" && t.value.toLowerCase() === kw) { this.p++; return true; }
    return false;
  }
  private expectKeyword(kw: string): void {
    if (!this.eatKeyword(kw)) {
      const t = this.peek();
      throw mkErr(`Expected '${kw}'`, t.pos);
    }
  }
  private expectIdent(): string {
    const t = this.next();
    if (t.type !== "ident") throw mkErr("Expected identifier", t.pos);
    return t.value;
  }
  private expectPunct(p: string): void {
    const t = this.next();
    if (t.type !== "punct" || t.value !== p) throw mkErr(`Expected '${p}'`, t.pos);
  }

  parse(): CompiledNRLRule {
    const first = this.peek();
    if (first.type === "ident" && first.value.toLowerCase() === "match") return this.parseMatch();
    if (first.type === "ident" && first.value.toLowerCase() === "roll") return this.parseRollup();
    throw mkErr("Rule must start with 'match' or 'roll up'", first.pos);
  }

  private parseField(): NRLField {
    const sideTok = this.next();
    if (sideTok.type !== "ident") throw mkErr("Expected side (A/B/C)", sideTok.pos);
    const side = sideTok.value.toUpperCase();
    if (side !== "A" && side !== "B" && side !== "C") {
      throw mkErr("Side must be A, B or C", sideTok.pos);
    }
    this.expectPunct(".");
    const column = this.expectIdent();
    return { side: side as NRLSide, column };
  }

  private parseMatch(): CompiledMatchRule {
    this.expectKeyword("match");
    const left = this.parseField();
    this.expectKeyword("to");
    const right = this.parseField();

    let tolerance: NRLTolerance | undefined;
    if (this.eatKeyword("with")) {
      this.expectKeyword("tolerance");
      const numTok = this.next();
      if (numTok.type !== "number") throw mkErr("Expected tolerance value", numTok.pos);
      let type: "abs" | "pct" = "abs";
      const pk = this.peek();
      if (pk.type === "punct" && pk.value === "%") { this.next(); type = "pct"; }
      tolerance = { type, value: numTok.value };
    }

    const where = this.parseOptionalWhere();
    const pass = this.parseOptionalPass();
    const lookup = this.parseOptionalLookup();

    return { kind: "match", pass, match: { left, right, tolerance }, where, lookup };
  }

  private parseRollup(): CompiledRollupRule {
    this.expectKeyword("roll");
    this.expectKeyword("up");
    const sideTok = this.next();
    if (sideTok.type !== "ident") throw mkErr("Expected side", sideTok.pos);
    const side = sideTok.value.toUpperCase();
    if (side !== "A" && side !== "B" && side !== "C") throw mkErr("Side must be A/B/C", sideTok.pos);
    this.expectKeyword("by");
    const groupBy = this.expectIdent();
    const fnTok = this.next();
    if (fnTok.type !== "ident") throw mkErr("Expected aggregate function", fnTok.pos);
    const fn = fnTok.value.toLowerCase();
    if (!["sum", "count", "avg", "min", "max"].includes(fn)) {
      throw mkErr("Aggregate must be sum|count|avg|min|max", fnTok.pos);
    }
    this.expectPunct("(");
    const column = this.expectIdent();
    this.expectPunct(")");

    const where = this.parseOptionalWhere();
    const pass = this.parseOptionalPass();
    return {
      kind: "rollup",
      pass,
      side: side as NRLSide,
      groupBy,
      aggregate: { fn: fn as CompiledRollupRule["aggregate"]["fn"], column },
      where,
    };
  }

  private parseOptionalWhere(): NRLPredicate[] {
    if (!this.eatKeyword("where")) return [];
    const preds: NRLPredicate[] = [this.parsePredicate()];
    while (this.eatKeyword("and")) preds.push(this.parsePredicate());
    return preds;
  }

  private parsePredicate(): NRLPredicate {
    const left = this.parseField();
    const opTok = this.next();
    let op: NRLOp;
    if (opTok.type === "op" && ["=", "!=", ">", "<", ">=", "<="].includes(opTok.value)) {
      op = opTok.value as NRLOp;
    } else if (opTok.type === "ident" && opTok.value.toLowerCase() === "like") {
      op = "like";
    } else {
      throw mkErr("Expected comparison operator", opTok.pos);
    }
    const rTok = this.peek();
    let right: NRLPredicate["right"];
    if (rTok.type === "ident" && (rTok.value === "A" || rTok.value === "B" || rTok.value === "C")) {
      right = this.parseField();
    } else if (rTok.type === "string") { this.next(); right = rTok.value; }
    else if (rTok.type === "number") { this.next(); right = rTok.value; }
    else throw mkErr("Expected value or field on right side of predicate", rTok.pos);
    return { left, op, right };
  }

  private parseOptionalPass(): number {
    if (!this.eatKeyword("pass")) return 1;
    const t = this.next();
    if (t.type !== "number" || !Number.isInteger(t.value)) {
      throw mkErr("Pass requires integer", t.pos);
    }
    return t.value;
  }

  private parseOptionalLookup(): CompiledMatchRule["lookup"] {
    if (!this.eatKeyword("lookup")) return undefined;
    const source = this.parseField();
    this.expectKeyword("in");
    const table = this.expectIdent();
    this.expectKeyword("as");
    const alias = this.expectIdent();
    return { source, table, alias };
  }
}

// ---------------- Public API ----------------

export function parseNRL(src: string): NRLParseResult {
  const trimmed = src.trim();
  if (!trimmed) return { errors: [{ message: "Empty rule", position: 0 }] };
  try {
    const toks = tokenize(trimmed);
    const rule = new Parser(toks).parse();
    return { rule, errors: [] };
  } catch (e) {
    const err = e as NRLParseError | Error;
    if ("position" in err) return { errors: [err] };
    return { errors: [{ message: (err as Error).message, position: 0 }] };
  }
}

/** Render compiled rule back to canonical NRL (useful for diff / round-trip). */
export function renderNRL(rule: CompiledNRLRule): string {
  if (rule.kind === "match") {
    const tol = rule.match.tolerance
      ? ` with tolerance ${rule.match.tolerance.value}${rule.match.tolerance.type === "pct" ? "%" : ""}`
      : "";
    const where = rule.where.length
      ? " where " + rule.where.map(renderPred).join(" and ")
      : "";
    const lookup = rule.lookup
      ? ` lookup ${rule.lookup.source.side}.${rule.lookup.source.column} in ${rule.lookup.table} as ${rule.lookup.alias}`
      : "";
    return `match ${rule.match.left.side}.${rule.match.left.column} to ${rule.match.right.side}.${rule.match.right.column}${tol}${where} pass ${rule.pass}${lookup}`;
  }
  const where = rule.where.length ? " where " + rule.where.map(renderPred).join(" and ") : "";
  return `roll up ${rule.side} by ${rule.groupBy} ${rule.aggregate.fn}(${rule.aggregate.column})${where} pass ${rule.pass}`;
}

function renderPred(p: NRLPredicate): string {
  const r = typeof p.right === "object"
    ? `${p.right.side}.${p.right.column}`
    : typeof p.right === "string" ? `'${p.right}'` : String(p.right);
  return `${p.left.side}.${p.left.column} ${p.op} ${r}`;
}
