import { describe, expect, it } from "vitest";
import { isDateLike, parseCsv } from "@/lib/csv-parse";

describe("CSV schema inference", () => {
  it("recognises explicit financial date formats", () => {
    expect(isDateLike("2026-09-05")).toBe(true);
    expect(isDateLike("2026-09-05T14:30:00Z")).toBe(true);
    expect(isDateLike("05/09/2026")).toBe(true);
  });

  it("does not misclassify account and instrument identifiers as dates", () => {
    expect(isDateLike("FUND-GLOBAL-01")).toBe(false);
    expect(isDateLike("NOSTRO-USD-001")).toBe(false);
    expect(isDateLike("US0378331005")).toBe(false);

    const parsed = parseCsv([
      "account_id,value_date",
      "FUND-GLOBAL-01,2026-09-05",
      "FUND-GLOBAL-02,2026-09-06",
    ].join("\n"));
    expect(parsed.columns).toEqual([
      expect.objectContaining({ name: "account_id", inferred_type: "string" }),
      expect.objectContaining({ name: "value_date", inferred_type: "date" }),
    ]);
  });
});
