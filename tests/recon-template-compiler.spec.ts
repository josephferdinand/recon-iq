import { describe, expect, it } from "vitest";
import { compileReconStarterTemplate, starterTemplateFields, type StarterTemplate } from "../src/lib/recon-template-compiler";

const modern: StarterTemplate = {
  code: "equities_trade_vs_confirm",
  legs: [{ name: "OMS" }, { name: "Broker" }],
  keys: ["trade_id", "isin"],
  rules: [
    { kind: "exact", fields: ["trade_id", "isin", "side"] },
    { kind: "tolerance", field: "price", pct: 0.0005 },
    { kind: "tolerance", field: "quantity", abs: 0 },
  ],
  tolerances: {},
  sample_fields: ["trade_id", "isin", "side", "price", "quantity"],
};

describe("Starter Kit compiler", () => {
  it("compiles modern two-sided catalogue rules into executable engine rules", () => {
    const fields = starterTemplateFields(modern);
    const bindings = ["source-a", "source-b"].map((data_source_id) => ({
      data_source_id,
      field_map: Object.fromEntries(fields.map((field) => [field, field])),
    }));
    const compiled = compileReconStarterTemplate(modern, bindings);
    expect(compiled.recon_type).toBe("two_sided");
    expect(compiled.sides.map((side) => side.side_id)).toEqual(["A", "B"]);
    expect(compiled.rules.filter((rule) => rule.is_key)).toHaveLength(2);
    expect(compiled.rules.find((rule) => rule.kind === "numeric_tolerance_pct")?.params?.pct).toBe(0.05);
    expect(compiled.rules.find((rule) => rule.kind === "numeric_tolerance_abs")?.params?.tolerance).toBe(0);
    expect(compiled.rules.some((rule) => rule.kind === "exact_match" && !rule.is_key)).toBe(true);
  });

  it("turns a legacy one-sided zero-balance kit into real validation rules", () => {
    const template: StarterTemplate = {
      code: "acct_clearing_v1",
      legs: [{ name: "GL" }],
      keys: ["txn_id"],
      rules: [{ type: "zero_balance" }],
      tolerances: { amount: { abs: 0.01 } },
      sample_fields: ["txn_id", "amount"],
    };
    const compiled = compileReconStarterTemplate(template, [{
      data_source_id: "source-a",
      field_map: { txn_id: "transaction_id", amount: "closing_balance" },
    }]);
    expect(compiled.recon_type).toBe("one_sided");
    expect(compiled.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unique", fields: { A: "transaction_id" } }),
      expect.objectContaining({ kind: "value_range", fields: { A: "closing_balance" }, params: { min: -0.01, max: 0.01 } }),
    ]));
  });

  it("requires complete mappings and distinct tenant sources", () => {
    expect(() => compileReconStarterTemplate(modern, [
      { data_source_id: "same", field_map: { trade_id: "trade_id" } },
      { data_source_id: "same", field_map: { trade_id: "trade_id" } },
    ])).toThrow("distinct data source");
    expect(() => compileReconStarterTemplate(modern, [
      { data_source_id: "a", field_map: {} },
      { data_source_id: "b", field_map: {} },
    ])).toThrow("Missing field mapping");
  });
});
