import { describe, expect, it } from "vitest";

import {
  applyDataPrepStep,
  type DataPrepRow,
  type DataPrepStep,
  validateDataQualityRule,
  type DataQualityRule,
} from "../src/lib/data-prep.functions";
import { TRANSFORM_BY_KIND, TRANSFORM_CATALOG } from "../src/lib/data-prep-transforms";

type TransformCase = {
  kind: string;
  rows: DataPrepRow[];
  step: DataPrepStep;
  expected: DataPrepRow[];
};

const transforms: TransformCase[] = [
  { kind: "trim", rows: [{ text: "  alpha  " }], step: { kind: "trim", field: "text" }, expected: [{ text: "alpha" }] },
  { kind: "ltrim", rows: [{ text: "  alpha  " }], step: { kind: "ltrim", field: "text" }, expected: [{ text: "alpha  " }] },
  { kind: "rtrim", rows: [{ text: "  alpha  " }], step: { kind: "rtrim", field: "text" }, expected: [{ text: "  alpha" }] },
  { kind: "collapse_whitespace", rows: [{ text: " alpha\t beta  " }], step: { kind: "collapse_whitespace", field: "text" }, expected: [{ text: "alpha beta" }] },
  { kind: "uppercase", rows: [{ text: "Alpha" }], step: { kind: "uppercase", field: "text" }, expected: [{ text: "ALPHA" }] },
  { kind: "lowercase", rows: [{ text: "Alpha" }], step: { kind: "lowercase", field: "text" }, expected: [{ text: "alpha" }] },
  { kind: "titlecase", rows: [{ text: "fALCON veritas" }], step: { kind: "titlecase", field: "text" }, expected: [{ text: "ReconIQ" }] },
  { kind: "remove_non_printable", rows: [{ text: "A\u0000B\u200BC" }], step: { kind: "remove_non_printable", field: "text" }, expected: [{ text: "ABC" }] },
  { kind: "pad_left", rows: [{ text: "42" }], step: { kind: "pad_left", field: "text", length: 5, char: "0" }, expected: [{ text: "00042" }] },
  { kind: "pad_right", rows: [{ text: "AB" }], step: { kind: "pad_right", field: "text", length: 4, char: "_" }, expected: [{ text: "AB__" }] },
  { kind: "substring", rows: [{ text: "ABCDEF" }], step: { kind: "substring", field: "text", start: 1, end: 4 }, expected: [{ text: "BCD" }] },
  { kind: "replace", rows: [{ text: "A-B-A" }], step: { kind: "replace", field: "text", find: "A", replace: "X" }, expected: [{ text: "X-B-X" }] },
  { kind: "regex_replace", rows: [{ text: "INV-001" }], step: { kind: "regex_replace", field: "text", pattern: "\\d+", replace: "999" }, expected: [{ text: "INV-999" }] },
  { kind: "cast_number", rows: [{ value: "1,250.50" }], step: { kind: "cast_number", field: "value" }, expected: [{ value: 1250.5 }] },
  { kind: "cast_int", rows: [{ value: "10.6" }], step: { kind: "cast_int", field: "value" }, expected: [{ value: 11 }] },
  { kind: "cast_boolean", rows: [{ value: "YES" }, { value: "no" }, { value: "unknown" }], step: { kind: "cast_boolean", field: "value" }, expected: [{ value: true }, { value: false }, { value: null }] },
  { kind: "cast_date", rows: [{ value: "2026-09-06" }], step: { kind: "cast_date", field: "value" }, expected: [{ value: "2026-09-06T00:00:00.000Z" }] },
  { kind: "parse_date_format", rows: [{ value: "06/09/2026" }], step: { kind: "parse_date_format", field: "value", format: "DD/MM/YYYY" }, expected: [{ value: "2026-09-06T00:00:00.000Z" }] },
  { kind: "round", rows: [{ value: 12.3456 }], step: { kind: "round", field: "value", decimals: 2 }, expected: [{ value: 12.35 }] },
  { kind: "abs", rows: [{ value: -125 }], step: { kind: "abs", field: "value" }, expected: [{ value: 125 }] },
  { kind: "rename", rows: [{ old: "A" }], step: { kind: "rename", field: "old", to: "new" }, expected: [{ new: "A" }] },
  { kind: "drop_columns", rows: [{ a: 1, b: 2 }], step: { kind: "drop_columns", fields: ["b"] }, expected: [{ a: 1 }] },
  { kind: "select_columns", rows: [{ a: 1, b: 2 }], step: { kind: "select_columns", fields: ["b"] }, expected: [{ b: 2 }] },
  { kind: "fill_null", rows: [{ value: null }, { value: "A" }], step: { kind: "fill_null", field: "value", value: "UNKNOWN" }, expected: [{ value: "UNKNOWN" }, { value: "A" }] },
  { kind: "coalesce", rows: [{ a: null, b: "B" }], step: { kind: "coalesce", fields: ["a", "b"], to: "best" }, expected: [{ a: null, b: "B", best: "B" }] },
  { kind: "dedupe", rows: [{ id: "A", n: 1 }, { id: "A", n: 2 }, { id: "B", n: 3 }], step: { kind: "dedupe", fields: ["id"] }, expected: [{ id: "A", n: 1 }, { id: "B", n: 3 }] },
  { kind: "sort", rows: [{ n: 10 }, { n: 2 }], step: { kind: "sort", field: "n", direction: "asc" }, expected: [{ n: 2 }, { n: 10 }] },
  { kind: "filter", rows: [{ id: "INV-1" }, { id: "PAY-1" }], step: { kind: "filter", field: "id", pattern: "^INV" }, expected: [{ id: "INV-1" }] },
  { kind: "filter_expr", rows: [{ amount: 99 }, { amount: 101 }], step: { kind: "filter_expr", field: "amount", expr: ">= 100" }, expected: [{ amount: 101 }] },
  { kind: "derive_concat", rows: [{ a: "FUND", b: "01" }], step: { kind: "derive_concat", fields: ["a", "b"], to: "key", separator: "-" }, expected: [{ a: "FUND", b: "01", key: "FUND-01" }] },
  { kind: "derive_arithmetic", rows: [{ debit: 75, credit: 25 }], step: { kind: "derive_arithmetic", left: "debit", op: "-", right: "credit", to: "net" }, expected: [{ debit: 75, credit: 25, net: 50 }] },
  { kind: "split", rows: [{ value: "A|B|C" }], step: { kind: "split", field: "value", delimiter: "|", index: 2, to: "part" }, expected: [{ value: "A|B|C", part: "B" }] },
  { kind: "json_extract", rows: [{ payload: "{\"trade\":{\"amount\":125}}" }], step: { kind: "json_extract", field: "payload", path: "trade.amount", to: "amount" }, expected: [{ payload: "{\"trade\":{\"amount\":125}}", amount: 125 }] },
  { kind: "normalize_currency_amount", rows: [{ amount: "USD 1,250.50" }], step: { kind: "normalize_currency_amount", field: "amount" }, expected: [{ amount: 1250.5 }] },
  { kind: "flip_sign_when", rows: [{ amount: -25, dc: "DR" }], step: { kind: "flip_sign_when", amount_field: "amount", indicator_field: "dc", indicator_value: "DR" }, expected: [{ amount: 25, dc: "DR" }] },
  { kind: "normalize_iban", rows: [{ value: " gb82 west 1234 " }], step: { kind: "normalize_iban", field: "value" }, expected: [{ value: "GB82WEST1234" }] },
  { kind: "normalize_bic", rows: [{ value: " deut de ff " }], step: { kind: "normalize_bic", field: "value" }, expected: [{ value: "DEUTDEFF" }] },
  { kind: "normalize_isin", rows: [{ value: " us 0378331005 " }], step: { kind: "normalize_isin", field: "value" }, expected: [{ value: "US0378331005" }] },
  { kind: "normalize_country", rows: [{ value: "United Kingdom" }], step: { kind: "normalize_country", field: "value" }, expected: [{ value: "GB" }] },
  { kind: "mask_pii", rows: [{ value: "123456789" }], step: { kind: "mask_pii", field: "value", show_last: 4 }, expected: [{ value: "*****6789" }] },
  { kind: "hash_field", rows: [{ value: "abc" }], step: { kind: "hash_field", field: "value" }, expected: [{ value: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" }] },
  { kind: "redact", rows: [{ value: "secret" }], step: { kind: "redact", field: "value", token: "[MASKED]" }, expected: [{ value: "[MASKED]" }] },
];

describe("42-rule Data Prep catalogue", () => {
  it("contains exactly 42 unique executable definitions", () => {
    expect(TRANSFORM_CATALOG).toHaveLength(42);
    expect(new Set(TRANSFORM_CATALOG.map((definition) => definition.kind)).size).toBe(42);
    expect(new Set(transforms.map((testCase) => testCase.kind))).toEqual(
      new Set(TRANSFORM_CATALOG.map((definition) => definition.kind)),
    );
  });

  it.each(transforms)("executes $kind deterministically without mutating its input", async ({ rows, step, expected }) => {
    const before = structuredClone(rows);
    const first = await applyDataPrepStep(rows, step);
    const second = await applyDataPrepStep(rows, step);
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(rows).toEqual(before);
  });

  it.each(transforms)("handles null and empty values deterministically for $kind", async ({ step }) => {
    const emptyRow: DataPrepRow = {
      text: "", value: null, amount: null, debit: null, credit: null, dc: "", id: "",
      old: null, a: null, b: "", n: null, payload: "", part: null,
    };
    const first = await applyDataPrepStep([emptyRow], step);
    const second = await applyDataPrepStep([emptyRow], step);
    expect(first).toEqual(second);
    expect(emptyRow).toEqual({
      text: "", value: null, amount: null, debit: null, credit: null, dc: "", id: "",
      old: null, a: null, b: "", n: null, payload: "", part: null,
    });
  });

  it.each(transforms)("rejects missing required configuration for $kind", async ({ kind, rows, step }) => {
    const required = TRANSFORM_BY_KIND[kind].params.find((parameter) => parameter.required);
    expect(required).toBeDefined();
    const invalid = { ...step } as Record<string, unknown>;
    delete invalid[required!.name];
    await expect(applyDataPrepStep(rows, invalid as DataPrepStep)).rejects.toThrow();
  });

  it("rejects unknown transforms, unsafe regexes and invalid numeric bounds", async () => {
    await expect(applyDataPrepStep([], { kind: "unknown" })).rejects.toThrow("Unknown transform");
    await expect(
      applyDataPrepStep([], { kind: "filter", field: "id", pattern: "(a+)+$" }),
    ).rejects.toThrow("regular expression");
    await expect(
      applyDataPrepStep([], { kind: "round", field: "amount", decimals: 100 }),
    ).rejects.toThrow();
    await expect(
      applyDataPrepStep([], { kind: "substring", field: "id", start: 5, end: 2 }),
    ).rejects.toThrow("End must");
  });

  it("rejects rolled-over formatted dates and invalid booleans become null", async () => {
    await expect(
      applyDataPrepStep([{ value: "31/02/2026" }], {
        kind: "parse_date_format", field: "value", format: "DD/MM/YYYY",
      }),
    ).resolves.toEqual([{ value: null }]);
    await expect(
      applyDataPrepStep([{ value: "maybe" }], { kind: "cast_boolean", field: "value" }),
    ).resolves.toEqual([{ value: null }]);
  });
});

const dqCases: Array<{ rule: DataQualityRule; pass: DataPrepRow[]; fail: DataPrepRow[] }> = [
  { rule: { id: "not-null", field: "v", kind: "not_null", severity: "critical" }, pass: [{ v: "A" }], fail: [{ v: null }] },
  { rule: { id: "unique", field: "v", kind: "unique", severity: "warning" }, pass: [{ v: "A" }, { v: "B" }], fail: [{ v: "A" }, { v: "A" }] },
  { rule: { id: "regex", field: "v", kind: "regex", params: { pattern: "^[A-Z]{3}$" }, severity: "warning" }, pass: [{ v: "USD" }], fail: [{ v: "usd" }] },
  { rule: { id: "min", field: "v", kind: "min", params: { value: 10 }, severity: "warning" }, pass: [{ v: 10 }], fail: [{ v: 9 }] },
  { rule: { id: "max", field: "v", kind: "max", params: { value: 10 }, severity: "warning" }, pass: [{ v: 10 }], fail: [{ v: 11 }] },
  { rule: { id: "set", field: "v", kind: "in_set", params: { values: ["A", "B"] }, severity: "warning" }, pass: [{ v: "A" }], fail: [{ v: "C" }] },
  { rule: { id: "number", field: "v", kind: "is_number", severity: "warning" }, pass: [{ v: 1.5 }], fail: [{ v: "1.5" }] },
  { rule: { id: "date", field: "v", kind: "is_date", severity: "warning" }, pass: [{ v: "2026-09-06" }], fail: [{ v: "not-a-date" }] },
  { rule: { id: "currency", field: "v", kind: "currency", severity: "warning" }, pass: [{ v: "USD" }], fail: [{ v: "usd" }] },
];

describe("Data Quality catalogue", () => {
  it.each(dqCases)("applies $rule.kind pass/fail boundaries", ({ rule, pass, fail }) => {
    expect(validateDataQualityRule(pass, rule).failures).toBe(0);
    expect(validateDataQualityRule(fail, rule).failures).toBeGreaterThan(0);
  });

  it("rejects incomplete or unsafe rule configuration", () => {
    expect(() => validateDataQualityRule([], { id: "r", field: "v", kind: "regex" })).toThrow();
    expect(() => validateDataQualityRule([], { id: "r", field: "v", kind: "regex", params: { pattern: "(a+)+$" } })).toThrow();
    expect(() => validateDataQualityRule([], { id: "r", field: "v", kind: "min" })).toThrow();
    expect(() => validateDataQualityRule([], { id: "r", field: "v", kind: "in_set", params: { values: [] } })).toThrow();
  });
});
