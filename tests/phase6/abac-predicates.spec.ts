/**
 * Phase 6 — ABAC predicate semantics (operator coverage).
 * Mirrors the plpgsql evaluation in has_permission_abac().
 */
import { describe, expect, it } from "vitest";

type Op = "in" | "not_in" | "equals";
interface Predicate { attribute: string; operator: Op; values: string[]; }

function evaluate(preds: Predicate[], attrs: Record<string, string | undefined>): boolean {
  for (const p of preds) {
    const v = attrs[p.attribute];
    if (p.operator === "in") {
      if (v === undefined || !p.values.includes(v)) return false;
    } else if (p.operator === "not_in") {
      if (v !== undefined && p.values.includes(v)) return false;
    } else if (p.operator === "equals") {
      if (v !== p.values[0]) return false;
    }
  }
  return true;
}

describe("has_permission_abac evaluator", () => {
  it("allows when no predicates", () => {
    expect(evaluate([], { account_number: "X" })).toBe(true);
  });
  it("denies on missing attribute for `in`", () => {
    expect(evaluate([{ attribute: "account", operator: "in", values: ["A"] }], {})).toBe(false);
  });
  it("allows on match", () => {
    expect(evaluate([{ attribute: "account", operator: "in", values: ["A","B"] }], { account: "B" })).toBe(true);
  });
  it("denies on `not_in` match", () => {
    expect(evaluate([{ attribute: "region", operator: "not_in", values: ["EU"] }], { region: "EU" })).toBe(false);
  });
  it("respects `equals`", () => {
    expect(evaluate([{ attribute: "lob", operator: "equals", values: ["WM"] }], { lob: "WM" })).toBe(true);
    expect(evaluate([{ attribute: "lob", operator: "equals", values: ["WM"] }], { lob: "IB" })).toBe(false);
  });
});
