import { describe, expect, it } from "vitest";
import {
  applyDataPrepStep,
  invalidDataQualityRowIndexes,
  profileDataPrepRows,
  validateDataQualityRule,
} from "../src/lib/data-prep.functions";

describe("Data Prep execution integrity", () => {
  it("applies finance normalization without mutating source rows", async () => {
    const source = [{ reference: "  abc-101  ", amount: "USD 1,250.50", isin: " us 0378331005 " }];
    let rows = await applyDataPrepStep(source, { kind: "trim", field: "reference" });
    rows = await applyDataPrepStep(rows, { kind: "uppercase", field: "reference" });
    rows = await applyDataPrepStep(rows, { kind: "normalize_currency_amount", field: "amount" });
    rows = await applyDataPrepStep(rows, { kind: "normalize_isin", field: "isin" });

    expect(rows).toEqual([{ reference: "ABC-101", amount: 1250.5, isin: "US0378331005" }]);
    expect(source[0]).toEqual({
      reference: "  abc-101  ",
      amount: "USD 1,250.50",
      isin: " us 0378331005 ",
    });
  });

  it("drops only later duplicate rows for unique data-quality rules", () => {
    const rows = [
      { reference: "A", amount: 10 },
      { reference: "B", amount: 20 },
      { reference: "A", amount: 30 },
      { reference: "C", amount: null },
    ];
    const rules = [
      { id: "unique-reference", field: "reference", kind: "unique", severity: "warning" },
      { id: "amount-required", field: "amount", kind: "not_null", severity: "critical" },
    ];

    expect(validateDataQualityRule(rows, rules[0]).failures).toBe(1);
    expect(validateDataQualityRule(rows, rules[1]).failures).toBe(1);
    expect([...invalidDataQualityRowIndexes(rows, rules)]).toEqual([2, 3]);
    expect(
      rows.filter((_row, index) => !invalidDataQualityRowIndexes(rows, rules).has(index)),
    ).toEqual(rows.slice(0, 2));
  });

  it("profiles transformed output for immediate downstream reconciliation", () => {
    const rows = [
      { account_id: "FUND-GLOBAL-01", value_date: "2026-09-05", amount: 125.25, active: true },
      { account_id: "NOSTRO-USD-001", value_date: "2026-09-06", amount: 75, active: false },
      { account_id: "", value_date: "2026-09-07", amount: 0, active: true },
    ];

    const profile = profileDataPrepRows(rows);
    expect(profile.sample_rows).toEqual(rows);
    expect(profile.columns).toEqual([
      { name: "account_id", inferred_type: "string", nullable: true, sample: "FUND-GLOBAL-01" },
      { name: "value_date", inferred_type: "date", nullable: false, sample: "2026-09-05" },
      { name: "amount", inferred_type: "number", nullable: false, sample: "125.25" },
      { name: "active", inferred_type: "boolean", nullable: false, sample: "true" },
    ]);
  });

  it("inverts the existing sign only when the configured indicator matches", async () => {
    const rows = [
      { amount: -175000, source_status: "COUNTERENTRY" },
      { amount: 85000, source_status: "BOOKED" },
      { amount: 92000, source_status: "counterentry" },
    ];

    expect(
      await applyDataPrepStep(rows, {
        kind: "flip_sign_when",
        amount_field: "amount",
        indicator_field: "source_status",
        indicator_value: "COUNTERENTRY",
      }),
    ).toEqual([
      { amount: 175000, source_status: "COUNTERENTRY" },
      { amount: 85000, source_status: "BOOKED" },
      { amount: -92000, source_status: "counterentry" },
    ]);
  });
});
