// Cascading rule-set orchestrator + per-field tolerance ladder evaluator.
// Sits on top of `recon-engine.ts` without modifying its semantics.
//
// Closes the #1 gap vs Duco/TLM:
//   - Multi-pass "waterfalls": pass 1 (exact) -> pass 2 (penny tol) -> pass 3 (fuzzy) ...
//     Records matched in pass N are removed before pass N+1 runs.
//   - Per-field tolerance ladders: each rung defines abs/pct limits + an outcome
//     (auto_match, match_with_break, suggest, review) and a severity.
//
// Pure functions, no IO. The engine module already covers single-pass execution.

import {
  runRecon,
  type ReconSpec,
  type RuleSpec,
  type SideData,
  type RunResult,
  type MatchGroup,
  type ExceptionItem,
  type RecordRow,
} from "./recon-engine";

export type CascadeOutcome =
  | "auto_match"
  | "match_with_break"
  | "suggest"
  | "review";

export interface CascadePass {
  id: string;
  pass_order: number;
  label: string;
  outcome: CascadeOutcome;
  rules: RuleSpec[];
  enabled?: boolean;
  notes?: string;
}

export interface ToleranceRung {
  /** Absolute tolerance ceiling. e.g. 0.01 = "within one cent". */
  max_abs?: number;
  /** Percentage tolerance ceiling, expressed as percent (e.g. 0.5 = 0.5%). */
  max_pct?: number;
  /** Day tolerance for date fields. */
  max_days?: number;
  /** What happens when a value falls inside this rung. */
  outcome: CascadeOutcome;
  /** Severity to attach to exceptions when outcome != auto_match. */
  severity?: "low" | "medium" | "high" | "critical";
  /** Optional human label, e.g. "Penny break". */
  label?: string;
}

export interface ToleranceLadder {
  id: string;
  field_name: string;
  field_type: "numeric" | "date" | "string";
  rungs: ToleranceRung[];
  applies_to_pass_id?: string | null;
  enabled?: boolean;
}

export interface CascadeMatch extends MatchGroup {
  pass_id: string;
  pass_label: string;
  outcome: CascadeOutcome;
}

export interface CascadeRunResult {
  passes: Array<{
    pass_id: string;
    label: string;
    outcome: CascadeOutcome;
    matched_records: number;
    exception_count: number;
  }>;
  matches: CascadeMatch[];
  exceptions: ExceptionItem[];
  stats: {
    total_rows: number;
    matched_records: number;
    exception_count: number;
    by_pass: Record<string, number>;
    by_outcome: Record<CascadeOutcome, number>;
  };
}

// ---------- Tolerance ladder evaluation ----------

/**
 * Classify a numeric difference (or date diff in days) against a ladder.
 * Returns the first matching rung, or null if no rung matches.
 */
export function classifyDifference(
  diff: number,
  base: number | undefined,
  ladder: ToleranceLadder,
): ToleranceRung | null {
  if (!Number.isFinite(diff)) return null;
  const absDiff = Math.abs(diff);
  for (const rung of ladder.rungs) {
    const absOk = rung.max_abs == null || absDiff <= rung.max_abs;
    const pctOk =
      rung.max_pct == null ||
      (base != null && base !== 0
        ? (absDiff / Math.abs(base)) * 100 <= rung.max_pct
        : absDiff === 0);
    const daysOk = rung.max_days == null || absDiff <= rung.max_days;
    if (absOk && pctOk && daysOk) return rung;
  }
  return null;
}

/**
 * Given a match group and the ladders configured for a recon, derive the
 * weakest (most-permissive) outcome across all evaluated fields. If any
 * field falls outside every rung the group is downgraded to "review".
 */
export function evaluateLaddersForMatch(
  match: MatchGroup,
  ladders: ToleranceLadder[],
  sideIds: string[],
): { outcome: CascadeOutcome; exceptions: ExceptionItem[] } {
  if (ladders.length === 0) {
    return { outcome: "auto_match", exceptions: [] };
  }
  const order: CascadeOutcome[] = [
    "auto_match",
    "match_with_break",
    "suggest",
    "review",
  ];
  let worst: CascadeOutcome = "auto_match";
  const exceptions: ExceptionItem[] = [];

  for (const ladder of ladders) {
    if (ladder.enabled === false) continue;
    // Compare side[0] field vs side[1] field for the configured field name.
    const a = match.members[sideIds[0]]?.[0];
    const b = match.members[sideIds[1]]?.[0];
    if (!a || !b) continue;
    const va = a[ladder.field_name];
    const vb = b[ladder.field_name];

    let diff = NaN;
    let base: number | undefined = undefined;
    if (ladder.field_type === "numeric") {
      const na = Number(String(va ?? "").replace(/[, ]/g, ""));
      const nb = Number(String(vb ?? "").replace(/[, ]/g, ""));
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        diff = na - nb;
        base = Math.max(Math.abs(na), Math.abs(nb));
      }
    } else if (ladder.field_type === "date") {
      const da = Date.parse(String(va ?? ""));
      const db = Date.parse(String(vb ?? ""));
      if (Number.isFinite(da) && Number.isFinite(db)) {
        diff = (da - db) / 86_400_000; // days
      }
    } else {
      // strings: 0 diff if identical, else 1
      diff = String(va ?? "").trim() === String(vb ?? "").trim() ? 0 : 1;
    }

    const rung = classifyDifference(diff, base, ladder);
    if (!rung) {
      worst = "review";
      exceptions.push({
        reason: `Field "${ladder.field_name}" outside all tolerance rungs (diff=${diff})`,
        severity: "high",
        payload: {
          field: ladder.field_name,
          diff,
          ladder_id: ladder.id,
          sides: { [sideIds[0]]: va, [sideIds[1]]: vb },
        },
      });
      continue;
    }
    if (order.indexOf(rung.outcome) > order.indexOf(worst)) worst = rung.outcome;
    if (rung.outcome !== "auto_match") {
      exceptions.push({
        reason: `Field "${ladder.field_name}" on rung "${rung.label ?? rung.outcome}" (diff=${diff})`,
        severity: rung.severity ?? "low",
        payload: {
          field: ladder.field_name,
          diff,
          rung,
          ladder_id: ladder.id,
        },
      });
    }
  }
  return { outcome: worst, exceptions };
}

// ---------- Multi-pass cascade ----------

/**
 * Build a row identity used to remove records matched in earlier passes.
 * Falls back to JSON stringify when no obvious id column exists.
 */
function rowKey(row: RecordRow): string {
  const id =
    row.id ??
    row.row_id ??
    row.txn_id ??
    row.transaction_id ??
    row.reference ??
    row.ref;
  if (id != null) return `pk:${String(id)}`;
  return `j:${JSON.stringify(row)}`;
}

export function runCascade(
  spec: ReconSpec,
  data: SideData[],
  passes: CascadePass[],
  ladders: ToleranceLadder[] = [],
): CascadeRunResult {
  const sideIds = spec.sides.map((s) => s.side_id);
  const totalRows = data.reduce((s, d) => s + d.rows.length, 0);
  const consumed: Record<string, Set<string>> = {};
  for (const sd of data) consumed[sd.side_id] = new Set();

  const allMatches: CascadeMatch[] = [];
  const allExceptions: ExceptionItem[] = [];
  const passSummary: CascadeRunResult["passes"] = [];
  const byPass: Record<string, number> = {};
  const byOutcome: Record<CascadeOutcome, number> = {
    auto_match: 0,
    match_with_break: 0,
    suggest: 0,
    review: 0,
  };

  const ordered = [...passes]
    .filter((p) => p.enabled !== false)
    .sort((a, b) => a.pass_order - b.pass_order);

  for (const pass of ordered) {
    // Filter out previously-matched rows
    const filtered: SideData[] = data.map((sd) => ({
      side_id: sd.side_id,
      rows: sd.rows.filter((r) => !consumed[sd.side_id].has(rowKey(r))),
    }));

    const passSpec: ReconSpec = { ...spec, rules: pass.rules };
    const result: RunResult = runRecon(passSpec, filtered);

    const passLadders = ladders.filter(
      (l) =>
        l.enabled !== false &&
        (!l.applies_to_pass_id || l.applies_to_pass_id === pass.id),
    );

    let passMatchedRecords = 0;
    for (const m of result.matches) {
      const laddered = evaluateLaddersForMatch(m, passLadders, sideIds);
      // The pass outcome is the *worse* of the pass's declared outcome and the ladder verdict.
      const order: CascadeOutcome[] = [
        "auto_match",
        "match_with_break",
        "suggest",
        "review",
      ];
      const finalOutcome: CascadeOutcome =
        order.indexOf(laddered.outcome) > order.indexOf(pass.outcome)
          ? laddered.outcome
          : pass.outcome;

      allMatches.push({
        ...m,
        pass_id: pass.id,
        pass_label: pass.label,
        outcome: finalOutcome,
      });
      byOutcome[finalOutcome]++;
      for (const sid of sideIds) {
        for (const row of m.members[sid] ?? []) {
          consumed[sid].add(rowKey(row));
          passMatchedRecords++;
        }
      }
      for (const ex of laddered.exceptions) {
        allExceptions.push({
          ...ex,
          payload: { ...ex.payload, pass_id: pass.id, pass_label: pass.label },
        });
      }
    }

    byPass[pass.id] = passMatchedRecords;
    passSummary.push({
      pass_id: pass.id,
      label: pass.label,
      outcome: pass.outcome,
      matched_records: passMatchedRecords,
      exception_count: result.exceptions.length,
    });

    // Only carry exceptions from the final pass to avoid noise.
    if (pass.pass_order === ordered[ordered.length - 1].pass_order) {
      allExceptions.push(...result.exceptions);
    }
  }

  const matchedRecords = allMatches.reduce(
    (s, m) => s + Object.values(m.members).reduce((a, b) => a + b.length, 0),
    0,
  );

  return {
    passes: passSummary,
    matches: allMatches,
    exceptions: allExceptions,
    stats: {
      total_rows: totalRows,
      matched_records: matchedRecords,
      exception_count: allExceptions.length,
      by_pass: byPass,
      by_outcome: byOutcome,
    },
  };
}

// ---------- Defaults catalogue (UI seeds) ----------

export const DEFAULT_CASCADE_TEMPLATES: Record<string, CascadePass[]> = {
  // Cash & Bank / Nostro waterfall – Falcon Bank standard
  cash_nostro: [
    {
      id: "seed-1",
      pass_order: 1,
      label: "Pass 1 — Exact",
      outcome: "auto_match",
      rules: [],
    },
    {
      id: "seed-2",
      pass_order: 2,
      label: "Pass 2 — Penny tolerance",
      outcome: "match_with_break",
      rules: [],
    },
    {
      id: "seed-3",
      pass_order: 3,
      label: "Pass 3 — Fuzzy reference + date window",
      outcome: "suggest",
      rules: [],
    },
  ],
};

export const DEFAULT_LADDER_RUNGS: ToleranceRung[] = [
  { max_abs: 0.01, outcome: "auto_match", severity: "low", label: "Penny" },
  { max_abs: 1.0,  outcome: "match_with_break", severity: "medium", label: "Dollar" },
  { max_abs: 100,  outcome: "suggest", severity: "high", label: "Material" },
];
