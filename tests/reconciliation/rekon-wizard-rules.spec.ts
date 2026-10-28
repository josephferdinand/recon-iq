import { describe, expect, it } from "vitest";

import { compileWizardRules } from "@/lib/rekon-wizard-rules";

const sides = [
  { side_id: "SOURCE_A", columns: ["group_id", "amount", "value_date"] },
  { side_id: "SOURCE_B", columns: ["group_id", "amount", "value_date"] },
];
const mappings = {
  group_id: { SOURCE_A: "group_id", SOURCE_B: "group_id" },
  amount: { SOURCE_A: "amount", SOURCE_B: "amount" },
  value_date: { SOURCE_A: "value_date", SOURCE_B: "value_date" },
};

describe("wizard rule compiler", () => {
  it("compiles executable key, grouped amount and date rules", () => {
    expect(compileWizardRules({
      mode: "two_sided",
      sides,
      mappings,
      keys: ["group_id"],
      amountField: "amount",
      dateField: "value_date",
    })).toEqual([
      { id: "wizard_key_group_id", kind: "exact_match", fields: { SOURCE_A: "group_id", SOURCE_B: "group_id" }, is_key: true },
      { id: "wizard_amount_sum", kind: "sum_to_match", fields: { SOURCE_A: "amount", SOURCE_B: "amount" }, params: { tolerance: 0.01 } },
      { id: "wizard_date_window", kind: "date_tolerance_days", fields: { SOURCE_A: "value_date", SOURCE_B: "value_date" }, params: { days: 1 } },
    ]);
  });

  it("compiles one-sided uniqueness and validation rules", () => {
    expect(compileWizardRules({
      mode: "one_sided",
      sides: [sides[0]],
      mappings: {
        group_id: { SOURCE_A: "group_id" },
        amount: { SOURCE_A: "amount" },
        value_date: { SOURCE_A: "value_date" },
      },
      keys: ["group_id"],
      amountField: "amount",
      dateField: "value_date",
    }).map((rule) => rule.kind)).toEqual(["unique", "non_null", "numeric_equals"]);
  });

  it("fails closed when a multi-sided key is not mapped everywhere", () => {
    expect(() => compileWizardRules({
      mode: "three_sided",
      sides: [...sides, { side_id: "SOURCE_C", columns: ["amount"] }],
      mappings,
      keys: ["group_id"],
    })).toThrow("not mapped on every side");
  });
});
