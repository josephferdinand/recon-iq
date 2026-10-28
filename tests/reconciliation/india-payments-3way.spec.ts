import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseCsv } from "../../src/lib/csv-parse";
import { runRecon, type ReconSpec, type RuleSpec } from "../../src/lib/recon-engine";

const dir = path.resolve("tests/fixtures/reconciliation");
const files = ["india-payments-ledger.csv", "india-payments-bank.csv", "india-payments-rail.csv"];
const spec: ReconSpec = {
  recon_type: "three_sided",
  sides: ["A", "B", "C"].map((side_id) => ({ side_id, label: side_id, data_source_id: side_id })),
  rules: [
    {
      id: "reference",
      kind: "exact_match",
      fields: { A: "reference", B: "reference", C: "reference" },
      is_key: true,
    },
    {
      id: "amount",
      kind: "sum_to_match",
      fields: { A: "amount", B: "amount", C: "amount" },
      params: { tolerance: 0.01 },
    },
    {
      id: "date",
      kind: "date_tolerance_days",
      fields: { A: "date", B: "date", C: "date" },
      params: { days: 1 },
    },
  ],
};

async function loadSides() {
  const [ledger, bank, rail] = await Promise.all(
    files.map(async (file) => parseCsv(await readFile(path.join(dir, file), "utf8")).rows),
  );
  return [
    {
      side_id: "A",
      rows: ledger.map((row) => ({
        ...row,
        reference: row.payment_ref,
        amount: Number(row.amount_inr),
        date: row.posting_date,
      })),
    },
    {
      side_id: "B",
      rows: bank.map((row) => ({
        ...row,
        reference: row.reference_no,
        amount: Number(row.credit_inr) - Number(row.debit_inr),
        date: row.value_date,
      })),
    },
    {
      side_id: "C",
      rows: rail.map((row) => ({
        ...row,
        reference: row.rrn_utr,
        amount: Number(row.gross_amount_inr),
        date: row.event_timestamp_ist.slice(0, 10),
      })),
    },
  ];
}

const keyFor = (ref: string) => `reference=${ref}`;

describe("synthetic India payments three-way reconciliation", () => {
  it("preserves exact references and separates matches from fee, pending and duplicate breaks", async () => {
    const sides = await loadSides();
    const expected = parseCsv(
      await readFile(path.join(dir, "india-payments-expected.csv"), "utf8"),
    ).rows;
    const result = runRecon(spec, sides);
    const matchedRefs = new Set(
      result.matches.map((match) => String(match.members.A[0].reference)),
    );
    const exceptionKeys = result.exceptions.map((exception) => String(exception.payload?.key));

    expect(sides.map((side) => side.rows.length)).toEqual([10, 11, 10]);
    expect(expected).toHaveLength(9);
    expect(sides.every((side) => side.rows[0].reference === "623409230001")).toBe(true);
    expect(result.matches).toHaveLength(6);
    expect(result.stats.matched_records).toBe(21);
    expect(result.exceptions).toHaveLength(4);

    for (const oracle of expected) {
      const ref = String(oracle.payment_ref);
      if (String(oracle.expected_classification).startsWith("BREAK_")) {
        expect(matchedRefs.has(ref), `${ref} must remain a break`).toBe(false);
        expect(exceptionKeys, `${ref} must produce evidence`).toContain(keyFor(ref));
      } else {
        expect(matchedRefs.has(ref), `${ref} must match`).toBe(true);
      }
    }
    expect(
      result.matches.find((match) => match.members.A[0].reference === "623409230004")?.cardinality,
    ).toBe("2:2:2");
    expect(
      result.exceptions.filter((item) => item.payload?.key === keyFor("TEST202609230000000007")),
    ).toHaveLength(2);
    expect(
      result.exceptions.filter((item) => item.payload?.key === keyFor("623409230009"))[0]?.reason,
    ).toContain("Sum mismatch");
  });

  it("accepts exactly one paise only when the configured tolerance allows it", async () => {
    const sides = await loadSides();
    const exact = runRecon(
      {
        ...spec,
        rules: spec.rules.map((rule) =>
          rule.id === "amount" ? { ...rule, params: { tolerance: 0 } } : rule,
        ),
      },
      sides,
    );
    expect(exact.exceptions.some((item) => item.payload?.key === keyFor("623409230008"))).toBe(
      true,
    );
    expect(exact.stats.matched_records).toBe(18);
    expect(runRecon(spec, sides).stats.matched_records).toBe(21);

    sides[1].rows.find((row) => row.reference === "623409230008")!.amount = 99.99;
    const beyond = runRecon(spec, sides);
    expect(beyond.exceptions.some((item) => item.payload?.key === keyFor("623409230008"))).toBe(
      true,
    );
  });
});

describe("decimal boundary comparisons across matching rules", () => {
  const cases: Array<{ kind: RuleSpec["kind"]; a: number; b: number; params: RuleSpec["params"] }> =
    [
      { kind: "numeric_tolerance_abs", a: 100.01, b: 100, params: { tolerance: 0.01 } },
      { kind: "numeric_tolerance_pct", a: 100.01, b: 100, params: { pct: 0.01 } },
      { kind: "amount_sign_flip", a: 100.01, b: -100, params: { tolerance: 0.01 } },
      { kind: "multiply", a: 33.34, b: 100.01, params: { threshold: 3, tolerance: 0.01 } },
    ];

  for (const item of cases) {
    it(`${item.kind} accepts its exact configured boundary`, () => {
      const pairSpec: ReconSpec = {
        recon_type: "two_sided",
        sides: ["A", "B"].map((side_id) => ({ side_id, label: side_id, data_source_id: side_id })),
        rules: [
          {
            id: "reference",
            kind: "exact_match",
            fields: { A: "reference", B: "reference" },
            is_key: true,
          },
          {
            id: "boundary",
            kind: item.kind,
            fields: { A: "amount", B: "amount" },
            params: item.params,
          },
        ],
      };
      const result = runRecon(pairSpec, [
        { side_id: "A", rows: [{ reference: "IN-BOUNDARY", amount: item.a }] },
        { side_id: "B", rows: [{ reference: "IN-BOUNDARY", amount: item.b }] },
      ]);
      expect(result.matches).toHaveLength(1);
      expect(result.exceptions).toHaveLength(0);
    });
  }
});
