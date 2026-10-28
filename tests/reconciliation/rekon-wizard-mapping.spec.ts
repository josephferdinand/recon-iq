import { describe, expect, it } from "vitest";

import { suggestWizardMapping, validateWizardMappingPlan } from "@/lib/rekon-wizard-rules";

const sides = [
  { side_id: "A", columns: ["trade_id", "settlement_amount", "value_date"] },
  { side_id: "B", columns: ["transaction_id", "net_amount", "settlement_date"] },
  { side_id: "C", columns: ["txn_id", "amount", "value_dt"] },
];

describe("Rekon wizard mapping assurance", () => {
  it("auto-detects common financial aliases across three sides deterministically", () => {
    const first = suggestWizardMapping(sides);
    const second = suggestWizardMapping(sides);
    expect(first).toEqual(second);
    expect(first.mappings.trade_id).toEqual({ A: "trade_id", B: "transaction_id", C: "txn_id" });
    expect(first.mappings.settlement_amount).toEqual({ A: "settlement_amount", B: "net_amount", C: "amount" });
    expect(first.suggested_keys).toContain("trade_id");
    expect(first.suggested_amount).toBe("settlement_amount");
    expect(first.suggested_date).toBe("value_date");
  });

  it("never classifies a value-date column as an amount", () => {
    const result = suggestWizardMapping([
      { side_id: "A", columns: ["record_id", "value_date", "amount"] },
      { side_id: "B", columns: ["transaction_id", "settlement_date", "net_amount"] },
    ]);
    expect(result.suggested_amount).toBe("amount");
    expect(result.suggested_date).toBe("value_date");
  });

  it("accepts only exact supplied columns from a natural-language plan", () => {
    expect(validateWizardMappingPlan({
      mappings: {
        trade_id: { A: "trade_id", B: "transaction_id", C: "invented_id" },
        settlement_amount: { A: "settlement_amount", B: "net_amount", C: "amount" },
        invented: { A: "invented", B: "invented", C: "invented" },
      },
      keys: ["trade_id", "settlement_amount", "invented"],
      amount: "settlement_amount",
      date: "invented",
      rules: [{ kind: "arbitrary" }],
    }, sides)).toEqual({
      mappings: {
        trade_id: { A: "trade_id", B: "transaction_id", C: "" },
        settlement_amount: { A: "settlement_amount", B: "net_amount", C: "amount" },
      },
      keys: ["settlement_amount"],
      amount: "settlement_amount",
      date: "",
      rules: [],
    });
  });

  it("fails closed when the model returns no valid mappings", () => {
    expect(() => validateWizardMappingPlan({ mappings: { invented: { A: "fake" } } }, sides))
      .toThrow("no valid source-column mappings");
    expect(() => validateWizardMappingPlan("not-json", sides)).toThrow("invalid mapping plan");
  });

  it("allows safe canonical business labels while requiring exact source columns", () => {
    expect(validateWizardMappingPlan({
      mappings: {
        transaction_reference: { A: "trade_id", B: "transaction_id", C: "txn_id" },
        settlement_value: { A: "settlement_amount", B: "net_amount", C: "amount" },
      },
      keys: ["trade_id"],
      amount: "settlement_amount",
      date: "",
    }, sides)).toEqual({
      mappings: {
        transaction_reference: { A: "trade_id", B: "transaction_id", C: "txn_id" },
        settlement_value: { A: "settlement_amount", B: "net_amount", C: "amount" },
      },
      keys: ["transaction_reference"],
      amount: "settlement_value",
      date: "",
      rules: [],
    });
  });
});
