import { describe, expect, it } from "vitest";
import catalogue from "./fixtures/recon-starter-catalog-prod-20260914.json";
import { compileReconStarterTemplate, starterTemplateFields, type StarterTemplate } from "../src/lib/recon-template-compiler";
import { runRecon, type SideData } from "../src/lib/recon-engine";

const asOf = new Date("2026-09-14T12:00:00Z");

function scenario(template: StarterTemplate) {
  const fields = starterTemplateFields(template);
  const spec = compileReconStarterTemplate(template, template.legs.map((_, index) => ({
    data_source_id: `synthetic-source-${index}`,
    field_map: Object.fromEntries(fields.map((field) => [field, field])),
  })));
  const row = Object.fromEntries(fields.map((field) => [field,
    field === "currency" || field === "ccy" ? "USD"
      : field.includes("date") || field === "posted_at" ? "2026-09-14"
        : template.keys.includes(field) ? "ASSURANCE-001"
          : field === "side" ? "BUY" : 100,
  ]));
  if (template.rules.some((rule) => rule.type === "zero_balance")) row.amount = 0;
  const data: SideData[] = spec.sides.map((side) => ({ side_id: side.side_id, rows: [{ ...row }] }));
  return { spec, data };
}

describe("published PROD Starter Kit catalogue executes its declared controls", () => {
  it("covers all 22 published recipes with the persisted normalized rule shape", () => {
    expect(catalogue.templates).toHaveLength(22);
    expect(catalogue.templates.flatMap((t) => t.rules).filter((r) => r.type === "deterministic")).toHaveLength(33);
  });

  for (const raw of catalogue.templates) {
    const template = raw as StarterTemplate;
    describe(template.code, () => {
      it("accepts a valid synthetic business case", () => {
        const { spec, data } = scenario(template);
        const result = runRecon(spec, data, { asOf });
        expect(result.exceptions).toEqual([]);
        expect(result.stats.matched_records).toBe(template.legs.length);
      });

      it("rejects empty mandatory identifiers", () => {
        const { spec, data } = scenario(template);
        for (const side of data) side.rows[0][template.keys[0]] = null;
        const result = runRecon(spec, data, { asOf });
        expect(result.stats.matched_records).toBe(0);
        expect(result.exceptions.length).toBeGreaterThan(0);
      });

      if (template.legs.length > 1) {
        const toleranceFields = [...new Set(template.rules.filter((rule) => rule.kind === "tolerance")
          .map((rule) => String(rule.field)))];
        for (const field of toleranceFields) {
          it(`rejects a material ${field} break even when identifiers match`, () => {
            const { spec, data } = scenario(template);
            data[1].rows[0][field] = 1_000_000;
            const result = runRecon(spec, data, { asOf });
            expect(result.stats.matched_records).toBe(0);
            expect(result.exceptions.length).toBeGreaterThan(0);
          });
        }
        const currency = template.sample_fields.find((field) => field === "currency" || field === "ccy");
        if (currency) it("rejects otherwise identical amounts in different currencies", () => {
          const { spec, data } = scenario(template);
          data[1].rows[0][currency] = "EUR";
          expect(runRecon(spec, data, { asOf }).stats.matched_records).toBe(0);
        });
      }
    });
  }

  it("enforces suspense ageing at 30 days, rejects future/malformed dates and records valuation time", () => {
    const template = catalogue.templates.find((t) => t.code === "acct_suspense_v1") as StarterTemplate;
    const { spec } = scenario(template);
    const data = [{ side_id: "A", rows: [
      { txn_id: "AT-BOUNDARY", posted_at: "2026-08-15", amount: 10 },
      { txn_id: "OVER-THRESHOLD", posted_at: "2026-08-14", amount: 10 },
      { txn_id: "FUTURE", posted_at: "2026-09-15", amount: 10 },
      { txn_id: "MALFORMED", posted_at: "not-a-date", amount: 10 },
    ] }];
    const result = runRecon(spec, data, { asOf });
    expect(result.stats.matched_records).toBe(1);
    expect(result.exceptions).toHaveLength(3);
    expect(result.stats.as_of).toBe(asOf.toISOString());
    expect(runRecon(spec, data, { asOf }).stats).toEqual(result.stats);
    expect(spec.rules.find((rule) => rule.kind === "date_age_days")?.params?.as_of).toBeUndefined();
  });

  it("honors absolute-or-percentage fee tolerances", () => {
    const template = catalogue.templates.find((t) => t.code === "acct_fee_v1") as StarterTemplate;
    const { spec, data } = scenario(template);
    data[0].rows[0].amount = 10_000;
    data[1].rows[0].amount = 10_040;
    expect(runRecon(spec, data, { asOf }).stats.matched_records).toBe(2);
    data[1].rows[0].amount = 11_000;
    expect(runRecon(spec, data, { asOf }).stats.matched_records).toBe(0);
  });

  it("never silently discards an unknown or invalid rule", () => {
    const original = catalogue.templates[0] as StarterTemplate;
    const fields = Object.fromEntries(starterTemplateFields(original).map((field) => [field, field]));
    const bindings = original.legs.map((_, index) => ({ data_source_id: String(index), field_map: fields }));
    expect(() => compileReconStarterTemplate({ ...original, rules: [{ kind: "unknown" }] }, bindings)).toThrow("not supported");
    expect(() => compileReconStarterTemplate({ ...original, rules: [{ kind: "tolerance", field: original.keys[0], abs: -1 }] }, bindings)).toThrow("non-negative");
  });
});
