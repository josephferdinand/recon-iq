// RFC 7644 §3.5.2 PATCH parser + RFC 7644 §3.4.2.2 filter grammar.
// Production-correct subset covering Okta, Entra ID, Google, JumpCloud,
// OneLogin, Ping. Pure functions — no IO, fully unit-testable.

export type ScimOp = { op: "add" | "replace" | "remove"; path?: string; value?: any };

export type ScimEmail = { value: string; type?: string; primary?: boolean };
export type ScimPhone = { value: string; type?: string; primary?: boolean };

export type ScimUserPatch = {
  active?: boolean;
  userName?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  formattedName?: string;
  externalId?: string;
  emails?: ScimEmail[];      // replace-set when present
  phoneNumbers?: ScimPhone[]; // replace-set when present
  addEmails: ScimEmail[];
  addPhones: ScimPhone[];
  removeEmails: string[];    // by value
  removePhones: string[];
};

export type ScimGroupPatch = {
  displayName?: string;
  addMembers: string[];
  removeMembers: string[];
  replaceMembers?: string[];
};

export type PatchConflict = { code: 409; scimType: "uniqueness" | "mutability" | "noTarget"; detail: string };

function normOp(op: string): ScimOp["op"] | null {
  const v = (op ?? "").toLowerCase();
  if (v === "add" || v === "replace" || v === "remove") return v;
  return null;
}

export function parsePatchOperations(body: any): ScimOp[] {
  if (!body || !Array.isArray(body.Operations)) return [];
  return body.Operations.flatMap((raw: any) => {
    const op = normOp(raw?.op);
    if (!op) return [];
    return [{ op, path: raw?.path?.trim() || undefined, value: raw?.value }];
  });
}

function unquote(s: string) { return s.replace(/^["']|["']$/g, ""); }

// members[value eq "..."] | emails[value eq "..."] | phoneNumbers[value eq "..."]
const filterAttrSelectorRe = /^(members|emails|phoneNumbers)\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i;
// emails[type eq "work"].value style — collapse to value-set when needed
const typedValuePathRe = /^(emails|phoneNumbers)\[\s*type\s+eq\s+"([^"]+)"\s*\]\.value$/i;

function toEmails(v: any): ScimEmail[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x: any) => {
      if (typeof x === "string") return { value: x };
      if (!x || typeof x !== "object") return null;
      const value = String(x.value ?? "").trim();
      if (!value) return null;
      return { value, type: x.type, primary: !!x.primary } as ScimEmail;
    })
    .filter(Boolean) as ScimEmail[];
}
function toPhones(v: any): ScimPhone[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x: any) => {
      if (typeof x === "string") return { value: x };
      if (!x || typeof x !== "object") return null;
      const value = String(x.value ?? "").trim();
      if (!value) return null;
      return { value, type: x.type, primary: !!x.primary } as ScimPhone;
    })
    .filter(Boolean) as ScimPhone[];
}

export function applyUserPatch(ops: ScimOp[]): ScimUserPatch {
  const out: ScimUserPatch = { addEmails: [], addPhones: [], removeEmails: [], removePhones: [] };
  for (const { op, path, value } of ops) {
    if (!path) {
      if (value && typeof value === "object" && op !== "remove") {
        if (typeof value.active === "boolean") out.active = value.active;
        if (typeof value.userName === "string") out.userName = value.userName;
        if (typeof value.displayName === "string") out.displayName = value.displayName;
        if (typeof value.externalId === "string") out.externalId = value.externalId;
        if (value.name && typeof value.name === "object") {
          if (typeof value.name.givenName === "string") out.givenName = value.name.givenName;
          if (typeof value.name.familyName === "string") out.familyName = value.name.familyName;
          if (typeof value.name.formatted === "string") out.formattedName = value.name.formatted;
        }
        if (Array.isArray(value.emails)) {
          if (op === "replace") out.emails = toEmails(value.emails);
          else out.addEmails.push(...toEmails(value.emails));
        }
        if (Array.isArray(value.phoneNumbers)) {
          if (op === "replace") out.phoneNumbers = toPhones(value.phoneNumbers);
          else out.addPhones.push(...toPhones(value.phoneNumbers));
        }
      }
      continue;
    }

    const p = path.toLowerCase();
    if (p === "active") {
      if (op === "remove") out.active = false;
      else out.active = value === true || value === "true";
    } else if (p === "username" && op !== "remove" && typeof value === "string") {
      out.userName = value;
    } else if (p === "displayname" && op !== "remove" && typeof value === "string") {
      out.displayName = value;
    } else if (p === "externalid" && op !== "remove" && typeof value === "string") {
      out.externalId = value;
    } else if (p === "name.givenname" && op !== "remove" && typeof value === "string") {
      out.givenName = value;
    } else if (p === "name.familyname" && op !== "remove" && typeof value === "string") {
      out.familyName = value;
    } else if (p === "name.formatted" && op !== "remove" && typeof value === "string") {
      out.formattedName = value;
    } else if (p === "name" && op !== "remove" && value && typeof value === "object") {
      if (typeof value.givenName === "string") out.givenName = value.givenName;
      if (typeof value.familyName === "string") out.familyName = value.familyName;
      if (typeof value.formatted === "string") out.formattedName = value.formatted;
    } else if (p === "emails") {
      if (op === "replace") out.emails = toEmails(value);
      else if (op === "add") out.addEmails.push(...toEmails(value));
      else if (op === "remove") out.emails = []; // clear
    } else if (p === "phonenumbers") {
      if (op === "replace") out.phoneNumbers = toPhones(value);
      else if (op === "add") out.addPhones.push(...toPhones(value));
      else if (op === "remove") out.phoneNumbers = [];
    } else {
      const sel = path.match(filterAttrSelectorRe);
      if (sel) {
        const [, attr, val] = sel;
        const k = attr.toLowerCase();
        if (k === "emails") {
          if (op === "remove") out.removeEmails.push(val);
          else out.addEmails.push({ value: val });
        } else if (k === "phonenumbers") {
          if (op === "remove") out.removePhones.push(val);
          else out.addPhones.push({ value: val });
        }
        continue;
      }
      const typed = path.match(typedValuePathRe);
      if (typed) {
        const [, attr, type] = typed;
        if (attr.toLowerCase() === "emails" && typeof value === "string") {
          if (op === "remove") out.removeEmails.push(value);
          else out.addEmails.push({ value, type });
        } else if (attr.toLowerCase() === "phonenumbers" && typeof value === "string") {
          if (op === "remove") out.removePhones.push(value);
          else out.addPhones.push({ value, type });
        }
      }
    }
  }
  return out;
}

export function applyGroupPatch(ops: ScimOp[]): ScimGroupPatch {
  const out: ScimGroupPatch = { addMembers: [], removeMembers: [] };
  for (const { op, path, value } of ops) {
    if (!path) {
      if (op !== "remove" && value && typeof value === "object") {
        if (typeof value.displayName === "string") out.displayName = value.displayName;
        if (Array.isArray(value.members) && op === "replace") {
          out.replaceMembers = value.members.map((m: any) => String(m?.value ?? m)).filter(Boolean);
        } else if (Array.isArray(value.members) && op === "add") {
          for (const m of value.members) {
            const v = String(m?.value ?? m); if (v) out.addMembers.push(v);
          }
        }
      }
      continue;
    }
    const p = path.toLowerCase();
    if (p === "displayname" && op !== "remove" && typeof value === "string") {
      out.displayName = value;
    } else if (p === "members") {
      if (op === "replace") {
        out.replaceMembers = (Array.isArray(value) ? value : [value])
          .filter(Boolean).map((m: any) => String(m?.value ?? m)).filter(Boolean);
      } else if (op === "add") {
        const arr = Array.isArray(value) ? value : [value];
        for (const m of arr) { const v = String(m?.value ?? m); if (v) out.addMembers.push(v); }
      } else if (op === "remove") {
        out.replaceMembers = [];
      }
    } else {
      const m = path.match(filterAttrSelectorRe);
      if (m && m[1].toLowerCase() === "members") {
        const memberId = unquote(m[2]);
        if (op === "remove") out.removeMembers.push(memberId);
        else out.addMembers.push(memberId);
      }
    }
  }
  return out;
}

// ============================================================================
// SCIM filter grammar (RFC 7644 §3.4.2.2)
// Supports: eq ne co sw ew gt ge lt le pr  + and/or  + parentheses
// Examples:
//   userName eq "jane@x.com"
//   active eq true and emails.value co "@acme.com"
//   displayName sw "Acme" or (externalId pr and active eq true)
// ============================================================================

export type FilterAst =
  | { kind: "and"; left: FilterAst; right: FilterAst }
  | { kind: "or"; left: FilterAst; right: FilterAst }
  | { kind: "cmp"; attr: string; op: "eq" | "ne" | "co" | "sw" | "ew" | "gt" | "ge" | "lt" | "le"; value: string | number | boolean | null }
  | { kind: "pr"; attr: string };

type Tok = { t: "ident" | "op" | "str" | "num" | "bool" | "null" | "lparen" | "rparen"; v: string };

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "(") { toks.push({ t: "lparen", v: "(" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rparen", v: ")" }); i++; continue; }
    if (c === '"') {
      let j = i + 1, s = "";
      while (j < input.length && input[j] !== '"') {
        if (input[j] === "\\" && j + 1 < input.length) { s += input[j + 1]; j += 2; }
        else { s += input[j]; j++; }
      }
      if (input[j] !== '"') throw new Error("Unterminated string in filter");
      toks.push({ t: "str", v: s }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_.:\-]/.test(input[j])) j++;
      const word = input.slice(i, j);
      const lw = word.toLowerCase();
      if (["and", "or", "eq", "ne", "co", "sw", "ew", "gt", "ge", "lt", "le", "pr"].includes(lw)) {
        toks.push({ t: "op", v: lw });
      } else if (lw === "true" || lw === "false") {
        toks.push({ t: "bool", v: lw });
      } else if (lw === "null") {
        toks.push({ t: "null", v: "null" });
      } else {
        toks.push({ t: "ident", v: word });
      }
      i = j; continue;
    }
    if (/[0-9-]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      toks.push({ t: "num", v: input.slice(i, j) }); i = j; continue;
    }
    throw new Error(`Unexpected character at ${i}: ${c}`);
  }
  return toks;
}

export function parseFilter(input: string): FilterAst {
  const toks = tokenize(input);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];

  function parseOr(): FilterAst {
    let left = parseAnd();
    while (peek()?.t === "op" && peek().v === "or") { eat(); left = { kind: "or", left, right: parseAnd() }; }
    return left;
  }
  function parseAnd(): FilterAst {
    let left = parseAtom();
    while (peek()?.t === "op" && peek().v === "and") { eat(); left = { kind: "and", left, right: parseAtom() }; }
    return left;
  }
  function parseAtom(): FilterAst {
    const t = peek(); if (!t) throw new Error("Unexpected end of filter");
    if (t.t === "lparen") { eat(); const inner = parseOr(); const cl = eat(); if (!cl || cl.t !== "rparen") throw new Error("Missing )"); return inner; }
    if (t.t !== "ident") throw new Error(`Expected attribute, got ${t.t}`);
    const attr = eat().v;
    const opTok = eat(); if (!opTok || opTok.t !== "op") throw new Error("Expected operator");
    if (opTok.v === "pr") return { kind: "pr", attr };
    const valTok = eat(); if (!valTok) throw new Error("Expected value");
    let value: any;
    if (valTok.t === "str") value = valTok.v;
    else if (valTok.t === "num") value = Number(valTok.v);
    else if (valTok.t === "bool") value = valTok.v === "true";
    else if (valTok.t === "null") value = null;
    else throw new Error(`Expected literal, got ${valTok.t}`);
    return { kind: "cmp", attr, op: opTok.v as any, value };
  }

  const ast = parseOr();
  if (pos !== toks.length) throw new Error("Trailing tokens in filter");
  return ast;
}

// Project SCIM attr path to a value within a resource object.
function projectAttr(resource: any, attr: string): any[] {
  // Support dotted paths: emails.value, name.givenName, etc.
  const parts = attr.split(".");
  let cur: any[] = [resource];
  for (const part of parts) {
    const next: any[] = [];
    for (const v of cur) {
      if (v == null) continue;
      const k = Object.keys(v).find((kk) => kk.toLowerCase() === part.toLowerCase());
      if (!k) continue;
      const nv = v[k];
      if (Array.isArray(nv)) next.push(...nv);
      else next.push(nv);
    }
    cur = next;
  }
  return cur;
}

export function evalFilter(ast: FilterAst, resource: any): boolean {
  if (ast.kind === "and") return evalFilter(ast.left, resource) && evalFilter(ast.right, resource);
  if (ast.kind === "or") return evalFilter(ast.left, resource) || evalFilter(ast.right, resource);
  if (ast.kind === "pr") return projectAttr(resource, ast.attr).some((v) => v != null && v !== "");
  const values = projectAttr(resource, ast.attr);
  return values.some((v) => cmp(v, ast.op, ast.value));
}

type CmpOp = "eq" | "ne" | "co" | "sw" | "ew" | "gt" | "ge" | "lt" | "le";
function cmp(a: any, op: CmpOp, b: any): boolean {
  if (op === "eq") return String(a) === String(b) || a === b;
  if (op === "ne") return String(a) !== String(b);
  const sa = String(a ?? "").toLowerCase();
  const sb = String(b ?? "").toLowerCase();
  if (op === "co") return sa.includes(sb);
  if (op === "sw") return sa.startsWith(sb);
  if (op === "ew") return sa.endsWith(sb);
  if (op === "gt") return a > b;
  if (op === "ge") return a >= b;
  if (op === "lt") return a < b;
  if (op === "le") return a <= b;
  return false;
}
