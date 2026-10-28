import { describe, expect, it } from "vitest";

import { runRecon, type ReconSpec, type SideData } from "@/lib/recon-engine";

const side = (side_id: string, rows: Array<Record<string, unknown>>): SideData => ({ side_id, rows });

describe("reconciliation engine scenario matrix", () => {
  it("validates required and unique fields in a one-sided reconciliation", () => {
    const spec: ReconSpec = {
      recon_type: "one_sided",
      sides: [{ side_id: "A", label: "Ledger", data_source_id: "source-a" }],
      rules: [
        { id: "date-required", kind: "non_null", fields: { A: "value_date" } },
        { id: "reference-unique", kind: "unique", fields: { A: "reference" } },
      ],
    };
    const result = runRecon(spec, [side("A", [
      { reference: "VALID", value_date: "2026-08-01" },
      { reference: "DUP", value_date: "2026-08-02" },
      { reference: "DUP", value_date: "2026-08-02" },
      { reference: "MISSING_DATE", value_date: null },
    ])]);

    expect(result.matches).toHaveLength(1);
    expect(result.exceptions).toHaveLength(3);
    expect(result.exceptions.filter((item) => item.payload.rule_id === "reference-unique")).toHaveLength(2);
    expect(result.exceptions.filter((item) => item.payload.rule_id === "date-required")).toHaveLength(1);
  });

  it("matches 1:1, M:1, 1:M and M:M groups with amount tolerance", () => {
    const spec: ReconSpec = {
      recon_type: "two_sided",
      sides: [
        { side_id: "A", label: "Ledger", data_source_id: "source-a" },
        { side_id: "B", label: "Statement", data_source_id: "source-b" },
      ],
      rules: [
        { id: "group", kind: "exact_match", fields: { A: "group_id", B: "group_id" }, is_key: true },
        { id: "amount-sum", kind: "sum_to_match", fields: { A: "amount", B: "amount" }, params: { tolerance: 0.01 } },
      ],
    };
    const result = runRecon(spec, [
      side("A", [
        { group_id: "G100", amount: 1000 },
        { group_id: "G200", amount: 600 }, { group_id: "G200", amount: 400 },
        { group_id: "G300", amount: 500 },
        { group_id: "G400", amount: 300 }, { group_id: "G400", amount: 200 },
        { group_id: "G500", amount: 250 }, { group_id: "G500", amount: 150 },
        { group_id: "G600", amount: 125 },
      ]),
      side("B", [
        { group_id: "G100", amount: 1000 },
        { group_id: "G200", amount: 1000 },
        { group_id: "G300", amount: 300 }, { group_id: "G300", amount: 200 },
        { group_id: "G400", amount: 250 }, { group_id: "G400", amount: 250 },
        { group_id: "G500", amount: 399.99 },
        { group_id: "G700", amount: 75 },
      ]),
    ]);

    expect(result.matches.map((match) => match.cardinality)).toEqual(["1:1", "2:1", "1:2", "2:2", "2:1"]);
    expect(result.exceptions).toHaveLength(2);
    expect(result.stats).toMatchObject({ total_rows: 17, matched_records: 15, exception_count: 2 });
  });

  it("requires every side and checks group totals in a three-sided reconciliation", () => {
    const spec: ReconSpec = {
      recon_type: "three_sided",
      sides: [
        { side_id: "A", label: "Ledger", data_source_id: "ledger" },
        { side_id: "B", label: "Bank", data_source_id: "bank" },
        { side_id: "C", label: "Settlement", data_source_id: "settlement" },
      ],
      rules: [
        { id: "group", kind: "exact_match", fields: { A: "group_id", B: "group_id", C: "group_id" }, is_key: true },
        { id: "amount-sum", kind: "sum_to_match", fields: { A: "amount", B: "amount", C: "amount" }, params: { tolerance: 0.01 } },
      ],
    };
    const result = runRecon(spec, [
      side("A", [{ group_id: "T1", amount: 1000 }, { group_id: "T2", amount: 500 }, { group_id: "T3", amount: 250 }]),
      side("B", [{ group_id: "T1", amount: 1000 }, { group_id: "T2", amount: 500 }, { group_id: "T3", amount: 250 }]),
      side("C", [{ group_id: "T1", amount: 1000 }, { group_id: "T2", amount: 500 }, { group_id: "T3", amount: 245 }]),
    ]);

    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.cardinality === "1:1:1")).toBe(true);
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0].reason).toContain("Sum mismatch");
  });

  it("emits one exception per present row when two three-sided counterparts are missing", () => {
    const spec: ReconSpec = {
      recon_type: "three_sided",
      sides: ["A", "B", "C"].map((side_id) => ({ side_id, label: side_id, data_source_id: side_id })),
      rules: [{
        id: "group", kind: "exact_match", is_key: true,
        fields: { A: "group_id", B: "group_id", C: "group_id" },
      }],
    };
    const result = runRecon(spec, [
      side("A", [{ group_id: "ONLY_A", id: 1 }, { group_id: "ONLY_A", id: 2 }, { group_id: "A_AND_B", id: 3 }]),
      side("B", [{ group_id: "A_AND_B", id: 4 }]),
      side("C", []),
    ]);

    expect(result.matches).toHaveLength(0);
    expect(result.exceptions).toHaveLength(4);
    expect(result.exceptions.filter((item) => item.payload.key === "group=ONLY_A")).toHaveLength(2);
    expect(result.exceptions.filter((item) => item.payload.key === "group=ONLY_A")
      .map((item) => item.payload.missing_sides)).toEqual([["B", "C"], ["B", "C"]]);
    expect(result.exceptions.filter((item) => item.payload.key === "group=A_AND_B")
      .map((item) => item.payload.missing_sides)).toEqual([["C"], ["C"]]);
    expect(result.stats).toMatchObject({ total_rows: 4, matched_records: 0, exception_count: 4 });
  });

  it("disposes each keyless input row once in a two-sided run", () => {
    const spec: ReconSpec = {
      recon_type: "two_sided",
      sides: ["A", "B"].map((side_id) => ({ side_id, label: side_id, data_source_id: side_id })),
      rules: [{
        id: "reference", kind: "exact_match", is_key: true,
        fields: { A: "reference", B: "reference" },
      }],
    };
    const result = runRecon(spec, [
      side("A", [{ reference: "", id: "a1" }, { reference: null, id: "a2" }, { reference: "MATCH", id: "a3" }]),
      side("B", [{ reference: "", id: "b1" }, { reference: "MATCH", id: "b2" }]),
    ]);

    const keyless = result.exceptions.filter((item) => item.payload.disposition === "keyless_input");
    expect(result.matches).toHaveLength(1);
    expect(keyless).toHaveLength(3);
    expect(keyless.map((item) => item.payload.row.id)).toEqual(["a1", "a2", "b1"]);
    expect(keyless.every((item) => item.payload.key_rule_ids[0] === "reference")).toBe(true);
    expect(result.exceptions).toHaveLength(3);
    expect(result.stats).toMatchObject({ total_rows: 5, matched_records: 2, exception_count: 3 });
  });

  it("disposes three-sided keyless rows once even when other sides are missing", () => {
    const spec: ReconSpec = {
      recon_type: "three_sided",
      sides: ["A", "B", "C"].map((side_id) => ({ side_id, label: side_id, data_source_id: side_id })),
      rules: [{
        id: "group", kind: "exact_match", is_key: true,
        fields: { A: "group_id", B: "group_id", C: "group_id" },
      }],
    };
    const result = runRecon(spec, [
      side("A", [{ group_id: "", id: "a-keyless" }, { group_id: "ONLY_A", id: "a-only" }]),
      side("B", [{ group_id: null, id: "b-keyless" }, { group_id: "ONLY_A", id: "b-only" }]),
      side("C", [{ group_id: "", id: "c-keyless" }]),
    ]);

    const keyless = result.exceptions.filter((item) => item.payload.disposition === "keyless_input");
    const missingSide = result.exceptions.filter((item) => item.payload.missing_sides);
    expect(result.matches).toHaveLength(0);
    expect(keyless.map((item) => item.payload.row.id)).toEqual(["a-keyless", "b-keyless", "c-keyless"]);
    expect(keyless).toHaveLength(3);
    expect(missingSide).toHaveLength(2);
    expect(missingSide.every((item) => item.payload.missing_sides.includes("C"))).toBe(true);
    expect(result.exceptions).toHaveLength(5);
    expect(result.stats).toMatchObject({ total_rows: 5, matched_records: 0, exception_count: 5 });
  });
});
