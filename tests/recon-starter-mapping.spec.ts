import { describe, expect, it } from "vitest";
import { getStarterBindingProgress } from "@/lib/recon-starter-mapping";
import { starterTemplateFields, type StarterBinding, type StarterTemplate } from "@/lib/recon-template-compiler";

const kitShapes: Array<{ name: string; template: StarterTemplate }> = [
  {
    name: "acct_clearing_v1 one-sided GL",
    template: { code: "acct_clearing_v1", legs: [{ name: "gl" }], keys: ["txn_id"], rules: [{ kind: "zero_balance" }], tolerances: { amount_abs: 0.01 }, sample_fields: ["txn_id", "amount"] },
  },
  {
    name: "fx_settlement_cls two-sided FX",
    template: { code: "fx_settlement_cls", legs: [{ name: "CLS" }, { name: "Internal Cash" }], keys: ["trade_id", "value_date"], rules: [{ kind: "exact", fields: ["trade_id"] }, { kind: "tolerance", field: "amount" }], tolerances: { amount_pct: 0.00001 }, sample_fields: ["trade_id", "value_date", "ccy", "amount", "status"] },
  },
  {
    name: "trade_lifecycle three-sided multi-asset",
    template: { code: "trade_lifecycle", legs: [{ name: "OMS" }, { name: "Middle Office" }, { name: "Back Office" }], keys: ["trade_id"], rules: [{ kind: "exact", fields: ["trade_id"] }, { kind: "tolerance", field: "quantity" }, { kind: "tolerance", field: "price" }], tolerances: { price_pct: 0.0001 }, sample_fields: ["trade_id", "quantity", "price", "stage"] },
  },
];

function completeBindings(legCount: number, requiredFields: string[]): StarterBinding[] {
  return Array.from({ length: legCount }, (_, index) => ({
    data_source_id: `source-${index + 1}`,
    field_map: Object.fromEntries(requiredFields.map((field) => [field, `column_${field}`])),
  }));
}

describe("Starter Kit mapping checklist", () => {
  it.each(kitShapes)("uses the required source and field checklist for $name", ({ template }) => {
    const requiredFields = starterTemplateFields(template);
    const bindings = completeBindings(template.legs.length, requiredFields);
    const complete = getStarterBindingProgress(template.legs.length, requiredFields, bindings, template.code);
    expect(complete.complete).toBe(true);
    expect(complete.requiredFieldCount).toBe(template.legs.length * requiredFields.length);
    expect(complete.mappedFields).toBe(template.legs.length * requiredFields.length);

    const missingLastField = bindings.map((binding) => ({ ...binding, field_map: { ...binding.field_map } }));
    delete missingLastField[template.legs.length - 1].field_map[requiredFields[requiredFields.length - 1]];
    const incomplete = getStarterBindingProgress(template.legs.length, requiredFields, missingLastField, template.code);
    expect(incomplete.complete).toBe(false);
    expect(incomplete.sides[template.legs.length - 1].complete).toBe(false);
  });

  it("marks all sides incomplete when one source is reused", () => {
    const requiredFields = ["transaction_id", "amount"];
    const bindings = completeBindings(2, requiredFields);
    bindings[1].data_source_id = bindings[0].data_source_id;
    const progress = getStarterBindingProgress(2, requiredFields, bindings, "Kit");
    expect(progress.complete).toBe(false);
    expect(progress.sides.every((side) => !side.complete)).toBe(true);
  });
});
