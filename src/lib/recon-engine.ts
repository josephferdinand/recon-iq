// Deterministic recon matching engine. Pure functions, no IO.
// Supports 1-sided / 2-sided / 3-sided recons with 20+ rule predicates.
import Decimal from "decimal.js";
import { assertSafeRegex } from "@/lib/safe-regex.server";

function safeRx(pattern: string | undefined | null, flags?: string): RegExp | null {
  if (!pattern) return null;
  try { const r = assertSafeRegex(pattern); return flags ? new RegExp(r.source, flags) : r; }
  catch { return null; }
}

export type RecordRow = Record<string, any>;


export type RuleKind =
  | "exact_match"
  | "case_insensitive_match"
  | "trimmed_match"
  | "numeric_equals"
  | "numeric_tolerance_abs"
  | "numeric_tolerance_pct"
  | "amount_sign_flip"
  | "date_equals"
  | "date_tolerance_days"
  | "date_within_range"
  | "date_age_days"
  | "string_contains"
  | "string_starts_with"
  | "string_ends_with"
  | "regex_match"
  | "fuzzy_levenshtein"
  | "phonetic_soundex"
  | "currency_equals"
  | "boolean_equals"
  | "non_null"
  | "unique"
  | "in_set"
  | "sum_to_match"
  | "many_to_one_sum"
  | "one_to_many_sum"
  | "value_range"
  // Batch A — Duco-parity additions
  | "multiply"                // a * factor ≈ b within tolerance (e.g. price * qty = notional)
  | "ignore_day_portion"      // date equality ignoring the time-of-day component
  | "conditional_set"         // applies one rule kind if a side-condition matches, else another
  | "roll_up"                 // aggregates by a group key then matches roll-up totals
  | "reference_lookup"        // resolves a value via reference_data_tables, then compares
  | "multi_pass"              // tries an ordered list of rules; first to match wins
  | "quick_fix";              // inline transform (trim, upper, regex_replace) then compare

export interface SideBinding {
  side_id: string;                 // "A", "B", "C"
  label: string;
  data_source_id: string;
  upload_id?: string;              // optional: pin a specific upload, else latest
}

export interface RuleSpec {
  id: string;
  kind: RuleKind;
  description?: string;
  fields: Record<string, string>;  // per-side field names: { A: "amount", B: "amt" }
  params?: {
    tolerance?: number;
    pct?: number;
    days?: number;
    as_of?: string;
    pattern?: string;
    set?: string[];
    threshold?: number;
    min?: number;
    max?: number;
    sign_invert?: boolean;
    reference_table_id?: string;
    reference_value_column?: string;
    reference_as_of?: string;
    reference_key_fields?: Record<string, string[]>;
    managed_lookup?: Record<string, unknown>;
    reference_key_columns?: string[];
    reference_version_id?: string;
    reference_content_sha256?: string;
  };
  is_key?: boolean;                // used to join records across sides
}

export interface ReconSpec {
  recon_type: "one_sided" | "two_sided" | "three_sided";
  sides: SideBinding[];
  rules: RuleSpec[];
}

export interface SideData {
  side_id: string;
  rows: RecordRow[];
}

export interface MatchGroup {
  rule_id: string;
  cardinality: string;
  members: Record<string, RecordRow[]>;
  score: number;
}

export interface ExceptionItem {
  side?: string;
  reason: string;
  severity: "low" | "medium" | "high" | "critical";
  payload: Record<string, any>;
}

export interface RunResult {
  matches: MatchGroup[];
  exceptions: ExceptionItem[];
  stats: {
    total_rows: number;
    matched_records: number;
    exception_count: number;
    by_rule: Record<string, number>;
    as_of?: string;
    reference_versions?: Array<{
      rule_id: string;
      table_id: string;
      version_id: string;
      version_number: number;
      content_sha256: string;
      as_of: string;
    }>;
  };
}

// ---------- predicate helpers ----------
const toStr = (v: any) => (v == null ? "" : String(v));
const toNum = (v: any) => {
  if (v == null || v === "") return NaN;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const toDate = (v: any) => {
  if (v == null || v === "") return NaN;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
};

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function soundex(s: string): string {
  s = (s || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  const f = s[0];
  const map: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3", L: "4", M: "5", N: "5", R: "6",
  };
  let out = f;
  let prev = map[f] ?? "";
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = map[s[i]] ?? "";
    if (c && c !== prev) out += c;
    if (c !== "") prev = c;
    else prev = "";
  }
  return (out + "000").slice(0, 4);
}

function managedReferenceValue(
  rule: RuleSpec,
  row: RecordRow,
  side: string,
): { configured: boolean; found: boolean; key: string; value?: unknown } {
  const params = rule.params ?? {};
  if (!params.reference_table_id) return { configured: false, found: false, key: "" };
  const fields = params.reference_key_fields?.[side];
  const lookup = params.managed_lookup;
  if (!fields?.length || !lookup) return { configured: true, found: false, key: "" };
  const key = JSON.stringify(fields.map((field) => row[field] ?? null));
  if (!Object.prototype.hasOwnProperty.call(lookup, key)) {
    return { configured: true, found: false, key };
  }
  return { configured: true, found: true, key, value: lookup[key] };
}

function withinDateAge(value: unknown, days: number | undefined, asOf: string | undefined): boolean {
  const posted = toDate(value);
  const valuation = asOf ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(posted) || !Number.isFinite(valuation) || days == null || !Number.isFinite(days) || days < 0) return false;
  // A business-date threshold is measured in UTC calendar days, consistently
  // across browser, API and scheduler execution, including the exact boundary.
  const age = Math.floor(valuation / 86400000) - Math.floor(posted / 86400000);
  return age >= 0 && age <= days;
}

function pairEval(rule: RuleSpec, a: RecordRow, b: RecordRow, sideA: string, sideB: string): boolean {
  const fA = rule.fields[sideA];
  const fB = rule.fields[sideB];
  const va = fA ? a[fA] : undefined;
  const vb = fB ? b[fB] : undefined;
  const p = rule.params ?? {};
  switch (rule.kind) {
    case "exact_match": return toStr(va) === toStr(vb);
    case "case_insensitive_match": return toStr(va).toLowerCase() === toStr(vb).toLowerCase();
    case "trimmed_match": return toStr(va).trim() === toStr(vb).trim();
    case "numeric_equals": return toNum(va) === toNum(vb);
    case "numeric_tolerance_abs": {
      const na = toNum(va), nb = toNum(vb);
      return Number.isFinite(na) && Number.isFinite(nb)
        && new Decimal(na).minus(nb).abs().lte(p.tolerance ?? 0);
    }
    case "numeric_tolerance_pct": {
      const na = toNum(va), nb = toNum(vb);
      if (!Number.isFinite(na) || !Number.isFinite(nb) || nb === 0) return false;
      return new Decimal(na).minus(nb).abs().div(new Decimal(nb).abs())
        .lte(new Decimal(p.pct ?? 0).div(100));
    }
    case "amount_sign_flip": {
      const na = toNum(va), nb = toNum(vb);
      return Number.isFinite(na) && Number.isFinite(nb)
        && new Decimal(na).plus(nb).abs().lte(p.tolerance ?? 0);
    }
    case "date_equals": return toDate(va) === toDate(vb);
    case "date_tolerance_days": {
      const da = toDate(va), db = toDate(vb);
      if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
      return Math.abs(da - db) / 86400000 <= (p.days ?? 0);
    }
    case "date_within_range": {
      const da = toDate(va);
      if (!Number.isFinite(da)) return false;
      const min = p.min ? Date.parse(String(p.min)) : -Infinity;
      const max = p.max ? Date.parse(String(p.max)) : Infinity;
      return da >= min && da <= max;
    }
    case "date_age_days": return withinDateAge(va, p.days, p.as_of) && withinDateAge(vb, p.days, p.as_of);
    case "string_contains": return toStr(va).toLowerCase().includes(toStr(vb).toLowerCase());
    case "string_starts_with": return toStr(va).toLowerCase().startsWith(toStr(vb).toLowerCase());
    case "string_ends_with": return toStr(va).toLowerCase().endsWith(toStr(vb).toLowerCase());
    case "regex_match": {
      const rx = safeRx(p.pattern);
      return !!rx && rx.test(toStr(va)) && rx.test(toStr(vb));
    }
    case "fuzzy_levenshtein": {
      const sa = toStr(va), sb = toStr(vb);
      if (!sa || !sb) return false;
      const dist = levenshtein(sa.toLowerCase(), sb.toLowerCase());
      const maxLen = Math.max(sa.length, sb.length);
      const sim = 1 - dist / maxLen;
      return sim >= (p.threshold ?? 0.85);
    }
    case "phonetic_soundex": return soundex(toStr(va)) === soundex(toStr(vb));
    case "currency_equals": return toStr(va).toUpperCase() === toStr(vb).toUpperCase();
    case "boolean_equals": return String(va).toLowerCase() === String(vb).toLowerCase();
    case "non_null": return va != null && va !== "" && vb != null && vb !== "";
    case "unique": return false; // unique is valid only for one-sided reconciliations
    case "in_set": {
      const set = (p.set ?? []).map((s) => s.toLowerCase());
      return set.includes(toStr(va).toLowerCase()) && set.includes(toStr(vb).toLowerCase());
    }
    case "value_range": {
      const na = toNum(va), nb = toNum(vb);
      const min = p.min ?? -Infinity, max = p.max ?? Infinity;
      return na >= min && na <= max && nb >= min && nb <= max;
    }
    case "sum_to_match":
    case "many_to_one_sum":
    case "one_to_many_sum":
      return true; // handled at group level
    case "multiply": {
      const na = toNum(va), nb = toNum(vb);
      const factor = Number(p.threshold ?? p.tolerance ?? 1);
      const tol = Number((p as any).abs_tolerance ?? 0.01);
      return Number.isFinite(na) && Number.isFinite(nb) && Number.isFinite(factor)
        && new Decimal(na).times(factor).minus(nb).abs().lte(tol);
    }
    case "ignore_day_portion": {
      const da = toDate(va), db = toDate(vb);
      if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
      const sa = new Date(da).toISOString().slice(0, 10);
      const sb = new Date(db).toISOString().slice(0, 10);
      return sa === sb;
    }
    case "conditional_set": {
      // params: { when: { side: 'A', field: 'type', equals: 'CASH' }, then_kind, else_kind }
      const cond = (p as any).when ?? {};
      const condVal = cond.side === sideA ? a[cond.field] : b[cond.field];
      const useKind = toStr(condVal).toLowerCase() === toStr(cond.equals).toLowerCase()
        ? (p as any).then_kind : (p as any).else_kind;
      if (!useKind) return false;
      return pairEval({ ...rule, kind: useKind as RuleKind }, a, b, sideA, sideB);
    }
    case "roll_up":
      return true; // handled at group level (treat as key-aware sum proxy)
    case "reference_lookup": {
      if (p.reference_table_id) {
        const mappedA = managedReferenceValue(rule, a, sideA);
        const mappedB = managedReferenceValue(rule, b, sideB);
        if (!mappedA.found || !mappedB.found) return false;
        return toStr(mappedA.value).toLowerCase() === toStr(mappedB.value).toLowerCase();
      }
      // params: { lookup: { A: { value->mapped }, B: { value->mapped } } }
      const map = (p as any).lookup ?? {};
      const ma = (map[sideA] ?? {})[toStr(va)] ?? toStr(va);
      const mb = (map[sideB] ?? {})[toStr(vb)] ?? toStr(vb);
      return toStr(ma).toLowerCase() === toStr(mb).toLowerCase();
    }
    case "multi_pass": {
      const passes: RuleKind[] = (p as any).passes ?? [];
      return passes.some((k) => pairEval({ ...rule, kind: k }, a, b, sideA, sideB));
    }
    case "quick_fix": {
      // params: { transform: 'trim'|'upper'|'lower'|'regex_replace', pattern, replace }
      const t = (p as any).transform ?? "trim";
      const apply = (v: any) => {
        let s = toStr(v);
        if (t === "trim") s = s.trim();
        else if (t === "upper") s = s.toUpperCase();
        else if (t === "lower") s = s.toLowerCase();
        else if (t === "regex_replace") {
          const rx = safeRx(String((p as any).pattern ?? ""), "g");
          if (rx) s = s.replace(rx, String((p as any).replace ?? ""));
        }
        return s;
      };
      return apply(va) === apply(vb);
    }
  }
}

function singleEval(rule: RuleSpec, row: RecordRow, side: string): boolean {
  const f = rule.fields[side];
  const v = f ? row[f] : undefined;
  const p = rule.params ?? {};
  switch (rule.kind) {
    case "non_null": return v != null && v !== "";
    case "unique": return true; // evaluated across the complete one-sided input below
    case "numeric_equals": return Number.isFinite(toNum(v));
    case "regex_match": { const rx = safeRx(p.pattern); return !!rx && rx.test(toStr(v)); }
    case "in_set": return (p.set ?? []).map((s) => s.toLowerCase()).includes(toStr(v).toLowerCase());
    case "value_range": {
      const n = toNum(v);
      return n >= (p.min ?? -Infinity) && n <= (p.max ?? Infinity);
    }
    case "date_within_range": {
      const d = toDate(v);
      const min = p.min ? Date.parse(String(p.min)) : -Infinity;
      const max = p.max ? Date.parse(String(p.max)) : Infinity;
      return d >= min && d <= max;
    }
    case "date_age_days": return withinDateAge(v, p.days, p.as_of);
    default: return v != null && v !== "";
  }
}

// ---------- engine ----------
export function runRecon(spec: ReconSpec, data: SideData[], options: { asOf?: Date } = {}): RunResult {
  let asOf: string | undefined;
  if (spec.rules.some((rule) => rule.kind === "date_age_days")) {
    asOf = (options.asOf ?? new Date()).toISOString();
    spec = { ...spec, rules: spec.rules.map((rule) => rule.kind === "date_age_days"
      ? { ...rule, params: { ...rule.params, as_of: asOf } } : rule) };
  }
  const sideMap = new Map(data.map((d) => [d.side_id, d.rows]));
  const total = data.reduce((s, d) => s + d.rows.length, 0);
  const byRule: Record<string, number> = {};
  const matches: MatchGroup[] = [];
  const exceptions: ExceptionItem[] = [];

  if (spec.recon_type === "one_sided") {
    const side = spec.sides[0];
    const rows = sideMap.get(side.side_id) ?? [];
    const uniqueCounts = new Map<string, Map<string, number>>();
    for (const rule of spec.rules.filter((candidate) => candidate.kind === "unique")) {
      const field = rule.fields[side.side_id];
      const counts = new Map<string, number>();
      for (const row of rows) {
        const value = field ? toStr(row[field]) : "";
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      uniqueCounts.set(rule.id, counts);
    }
    for (const row of rows) {
      const failed = spec.rules.filter((rule) => {
        if (rule.kind !== "unique") return !singleEval(rule, row, side.side_id);
        const field = rule.fields[side.side_id];
        const value = field ? toStr(row[field]) : "";
        return (uniqueCounts.get(rule.id)?.get(value) ?? 0) > 1;
      });
      if (failed.length === 0) {
        matches.push({
          rule_id: "validate",
          cardinality: "1:0",
          members: { [side.side_id]: [row] },
          score: 1,
        });
        byRule["validate"] = (byRule["validate"] ?? 0) + 1;
      } else {
        for (const f of failed) {
          exceptions.push({
            side: side.side_id,
            reason: `Validation failed: ${f.description || f.kind} (${f.fields[side.side_id] || ""})`,
            severity: "medium",
            payload: { row, rule_id: f.id, rule_kind: f.kind },
          });
        }
      }
    }
  } else {
    const sideIds = spec.sides.map((s) => s.side_id);
    const keyRules = spec.rules.filter((r) => r.is_key);
    const nonKeyRules = spec.rules.filter((r) => !r.is_key && r.kind !== "sum_to_match" && r.kind !== "many_to_one_sum" && r.kind !== "one_to_many_sum");
    const sumRule = spec.rules.find((r) => r.kind === "sum_to_match" || r.kind === "many_to_one_sum" || r.kind === "one_to_many_sum");

    // Build composite keys per side
    const keyPartsFor = (side: string, row: RecordRow) =>
      keyRules.map((r) => {
        const f = r.fields[side];
        let v = f ? row[f] : "";
        if (r.kind === "reference_lookup" && r.params?.reference_table_id) {
          const mapped = managedReferenceValue(r, row, side);
          v = mapped.found
            ? mapped.value
            : `__fvi_reference_missing__:${side}:${mapped.key}`;
        } else if (r.kind === "case_insensitive_match" || r.kind === "trimmed_match" || r.kind === "phonetic_soundex") {
          v = toStr(v).trim().toLowerCase();
          if (r.kind === "phonetic_soundex") v = soundex(v);
        } else if (r.kind === "numeric_equals" || r.kind === "numeric_tolerance_abs" || r.kind === "numeric_tolerance_pct" || r.kind === "amount_sign_flip") {
          v = String(Math.round(toNum(v) * 100) / 100);
        } else if (r.kind === "date_equals" || r.kind === "date_tolerance_days") {
          const d = toDate(v);
          v = Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : "";
        } else {
          v = toStr(v);
        }
        const value = String(v);
        return { part: `${r.id}=${value}`, missing: value === "" };
      });

    const buckets: Record<string, Record<string, RecordRow[]>> = {};
    for (const sideId of sideIds) {
      const rows = sideMap.get(sideId) ?? [];
      for (const row of rows) {
        const keyParts = keyPartsFor(sideId, row);
        const key = keyParts.map(({ part }) => part).join("|");
        const hasMissingKeyComponent = keyRules.length > 0 && keyParts.some(({ missing }) => missing);
        if (hasMissingKeyComponent) {
          exceptions.push({
            side: sideId,
            reason: "Invalid or missing reconciliation key",
            severity: "high",
            payload: {
              row,
              disposition: "keyless_input",
              key_status: "missing_or_invalid",
              key_rule_ids: keyRules.map((rule) => rule.id),
            },
          });
          continue;
        }
        buckets[key] = buckets[key] || {};
        buckets[key][sideId] = buckets[key][sideId] || [];
        buckets[key][sideId].push(row);
      }
    }

    for (const [key, group] of Object.entries(buckets)) {
      const presentSides = sideIds.filter((s) => (group[s]?.length ?? 0) > 0);
      if (presentSides.length !== sideIds.length) {
        // Unmatched on at least one side
        const missingSides = sideIds.filter((s) => !group[s]?.length);
        for (const presentSide of presentSides) {
          for (const row of group[presentSide]) {
            exceptions.push({
              side: presentSide,
              reason: `Unmatched: no counterpart on side ${missingSides.join(", ")} for key ${key}`,
              severity: "high",
              payload: { row, key, missing_sides: missingSides },
            });
          }
        }
        continue;
      }

      // Evaluate non-key rules pairwise (A vs B, A vs C, B vs C)
      let allRulesOk = true;
      const ruleHits: string[] = [];
      for (const rule of nonKeyRules) {
        for (let i = 0; i < sideIds.length; i++) {
          for (let j = i + 1; j < sideIds.length; j++) {
            const sa = sideIds[i], sb = sideIds[j];
            const ra = group[sa][0], rb = group[sb][0];
            const ok = pairEval(rule, ra, rb, sa, sb);
            if (!ok) {
              allRulesOk = false;
              exceptions.push({
                side: `${sa}/${sb}`,
                reason: `Rule failed: ${rule.description || rule.kind}`,
                severity: "medium",
                payload: { key, rule_id: rule.id, rule_kind: rule.kind, sides: { [sa]: ra, [sb]: rb } },
              });
            } else {
              ruleHits.push(rule.id);
            }
          }
        }
      }

      // Sum rule (many-to-one): all rows on a side must sum to the counterpart amount
      let cardinality = sideIds.map((s) => group[s].length).join(":");
      if (sumRule) {
        const sums: Record<string, number> = {};
        const exactSums: Decimal[] = [];
        for (const s of sideIds) {
          const field = sumRule.fields[s];
          const exact = (group[s] || []).reduce<Decimal>(
            (acc, r) => acc.plus(toNum(r[field]) || 0), new Decimal(0),
          );
          exactSums.push(exact);
          sums[s] = exact.toNumber();
        }
        const tol = sumRule.params?.tolerance ?? 0.01;
        const maxDiff = Decimal.max(...exactSums).minus(Decimal.min(...exactSums));
        if (maxDiff.greaterThan(tol)) {
          allRulesOk = false;
          exceptions.push({
            reason: `Sum mismatch for key ${key}: ${JSON.stringify(sums)} (tolerance ${tol})`,
            severity: "high",
            payload: { key, sums, tolerance: tol },
          });
        } else {
          ruleHits.push(sumRule.id);
        }
      }

      if (allRulesOk) {
        const members: Record<string, RecordRow[]> = {};
        for (const s of sideIds) members[s] = group[s];
        matches.push({
          rule_id: ruleHits.join(",") || "key_match",
          cardinality,
          members,
          score: 1,
        });
        for (const r of ruleHits) byRule[r] = (byRule[r] ?? 0) + 1;
      }
    }
  }

  const matchedRecords = matches.reduce(
    (s, m) => s + Object.values(m.members).reduce((a, b) => a + b.length, 0),
    0,
  );

  return {
    matches,
    exceptions,
    stats: {
      total_rows: total,
      matched_records: matchedRecords,
      exception_count: exceptions.length,
      by_rule: byRule,
      ...(asOf ? { as_of: asOf } : {}),
    },
  };
}

export const RULE_LIBRARY: { kind: RuleKind; label: string; description: string; params?: string[] }[] = [
  { kind: "exact_match", label: "Exact match", description: "Values are identical." },
  { kind: "case_insensitive_match", label: "Case-insensitive match", description: "Match ignoring case." },
  { kind: "trimmed_match", label: "Trimmed match", description: "Match after trimming whitespace." },
  { kind: "numeric_equals", label: "Numeric equals", description: "Numbers compared after cleaning." },
  { kind: "numeric_tolerance_abs", label: "Numeric tolerance (absolute)", description: "abs(a-b) ≤ tolerance.", params: ["tolerance"] },
  { kind: "numeric_tolerance_pct", label: "Numeric tolerance (percent)", description: "Percent difference within %.", params: ["pct"] },
  { kind: "amount_sign_flip", label: "Amount sign-flip", description: "Debit/credit pairing: abs(a+b) ≤ tolerance.", params: ["tolerance"] },
  { kind: "date_equals", label: "Date equals", description: "Dates compared after parsing." },
  { kind: "date_tolerance_days", label: "Date tolerance (days)", description: "|date_a - date_b| ≤ N days.", params: ["days"] },
  { kind: "date_within_range", label: "Date within range", description: "Date between min and max.", params: ["min", "max"] },
  { kind: "date_age_days", label: "Maximum age (days)", description: "Date is not in the future and is within the permitted age at execution (UTC calendar days).", params: ["days"] },
  { kind: "string_contains", label: "String contains", description: "One string contains the other." },
  { kind: "string_starts_with", label: "String starts with", description: "Prefix match." },
  { kind: "string_ends_with", label: "String ends with", description: "Suffix match." },
  { kind: "regex_match", label: "Regex match", description: "Regex matches both sides.", params: ["pattern"] },
  { kind: "fuzzy_levenshtein", label: "Fuzzy (Levenshtein)", description: "Similarity ≥ threshold (0-1).", params: ["threshold"] },
  { kind: "phonetic_soundex", label: "Phonetic (Soundex)", description: "Sound-alike match." },
  { kind: "currency_equals", label: "Currency equals", description: "ISO currency code identical." },
  { kind: "boolean_equals", label: "Boolean equals", description: "Boolean equality." },
  { kind: "non_null", label: "Non-null", description: "Field present and non-empty." },
  { kind: "unique", label: "Unique", description: "One-sided field values occur exactly once." },
  { kind: "in_set", label: "In set", description: "Value is in an allowed set.", params: ["set"] },
  { kind: "value_range", label: "Value in range", description: "Numeric between min and max.", params: ["min", "max"] },
  { kind: "sum_to_match", label: "Sum to match", description: "N:M aggregate sums equal within tolerance.", params: ["tolerance"] },
  { kind: "many_to_one_sum", label: "Many-to-one sum", description: "Many rows on one side sum to one on the other.", params: ["tolerance"] },
  { kind: "one_to_many_sum", label: "One-to-many sum", description: "One row matches a sum of many.", params: ["tolerance"] },
  { kind: "multiply", label: "Multiply", description: "a × factor ≈ b within tolerance (price × qty = notional).", params: ["threshold", "abs_tolerance"] },
  { kind: "ignore_day_portion", label: "Ignore time-of-day", description: "Compare dates ignoring the time component." },
  { kind: "conditional_set", label: "Conditional rule set", description: "If a condition matches, apply rule A; else apply rule B.", params: ["when", "then_kind", "else_kind"] },
  { kind: "roll_up", label: "Roll-up", description: "Aggregate by a group key, then match roll-up totals.", params: ["group_by", "tolerance"] },
  { kind: "reference_lookup", label: "Reference lookup", description: "Map values through an effective published Reference Data version, then compare.", params: ["reference_table_id", "reference_value_column", "reference_as_of", "reference_key_fields"] },
  { kind: "multi_pass", label: "Multi-pass", description: "Try an ordered list of rules; first to match wins.", params: ["passes"] },
  { kind: "quick_fix", label: "Quick fix transform", description: "Apply a transform (trim/upper/lower/regex_replace) then compare.", params: ["transform", "pattern", "replace"] },
];
