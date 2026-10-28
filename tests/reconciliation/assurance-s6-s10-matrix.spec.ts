import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseCsv } from "../../src/lib/csv-parse";
import { runRecon, type ReconSpec } from "../../src/lib/recon-engine";

const fixtureDir = path.resolve("tests/fixtures/reconciliation/assurance-lab");

const scenarios = [
  {
    code: "S6",
    mode: "three_sided",
    files: [
      "s6-issuer-corporate-actions.csv",
      "s6-custodian-entitlements.csv",
      "s6-internal-corporate-action-accruals.csv",
    ],
    expected: { matches: 2, exceptions: 3, total_rows: 14, matched_records: 9 },
  },
  {
    code: "S7",
    mode: "two_sided",
    files: ["s7-internal-fx-trades.csv", "s7-counterparty-fx-confirmations.csv"],
    expected: { matches: 3, exceptions: 3, total_rows: 12, matched_records: 8 },
  },
  {
    code: "S8",
    mode: "three_sided",
    files: ["s8-broker-fee-invoices.csv", "s8-internal-fee-accruals.csv", "s8-fee-payments.csv"],
    expected: { matches: 3, exceptions: 4, total_rows: 16, matched_records: 10 },
  },
  {
    code: "S9",
    mode: "three_sided",
    files: [
      "s9-entity-a-intercompany.csv",
      "s9-entity-b-intercompany.csv",
      "s9-treasury-intercompany-settlement.csv",
    ],
    expected: { matches: 2, exceptions: 5, total_rows: 16, matched_records: 8 },
  },
  {
    code: "S10",
    mode: "two_sided",
    files: ["s10-ccp-margin-statement.csv", "s10-internal-margin-ledger.csv"],
    expected: { matches: 4, exceptions: 3, total_rows: 16, matched_records: 12 },
  },
] as const;

describe("Assurance Lab S6-S10 reconciliation matrix", () => {
  for (const scenario of scenarios) {
    it(`${scenario.code} proves grouped cardinalities, breaks, and matched-record totals`, async () => {
      const rows = await Promise.all(
        scenario.files.map(async (file) => parseCsv(await readFile(path.join(fixtureDir, file), "utf8")).rows),
      );
      const sideIds = rows.map((_value, index) => String.fromCharCode(65 + index));
      const fields = Object.fromEntries(sideIds.map((sideId) => [sideId, "group_id"]));
      const amountFields = Object.fromEntries(sideIds.map((sideId) => [sideId, "amount"]));
      const dateFields = Object.fromEntries(sideIds.map((sideId) => [sideId, "value_date"]));
      const spec: ReconSpec = {
        recon_type: scenario.mode,
        sides: sideIds.map((sideId) => ({ side_id: sideId, label: sideId, data_source_id: sideId })),
        rules: [
          { id: "group", kind: "exact_match", fields, is_key: true },
          { id: "amount", kind: "sum_to_match", fields: amountFields, params: { tolerance: 0.01 } },
          { id: "date", kind: "date_tolerance_days", fields: dateFields, params: { days: 1 } },
        ],
      };

      const result = runRecon(
        spec,
        rows.map((dataset, index) => ({ side_id: sideIds[index], rows: dataset })),
      );
      expect({
        matches: result.matches.length,
        exceptions: result.exceptions.length,
        total_rows: result.stats.total_rows,
        matched_records: result.stats.matched_records,
      }).toEqual(scenario.expected);
      expect(result.matches.map((match) => match.cardinality)).toEqual(
        expect.arrayContaining(
          scenario.code === "S6"
            ? ["1:1:1", "1:2:3"]
            : scenario.code === "S7"
              ? ["1:1", "2:1", "1:2"]
              : scenario.code === "S8"
                ? ["1:1:1", "2:1:1"]
                : scenario.code === "S9"
                  ? ["1:1:1", "2:1:2"]
                  : ["1:1", "2:2", "1:3"],
        ),
      );
    });
  }
});
