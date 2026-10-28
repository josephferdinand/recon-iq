import { describe, it, expect } from "vitest";
import { repeatBreakPatterns } from "@/lib/copilot-tools.server";
import { makeMockSupa } from "./_supa-mock";

const iso = (d: Date) => d.toISOString();

describe("repeatBreakPatterns", () => {
  it("returns grouped patterns sorted by count", async () => {
    const now = new Date();
    const supa = makeMockSupa({
      tableData: {
        break_root_causes: [
          { category: "fx_mismatch", label: "USD/EUR diff", occurrence_count: 12, first_seen_at: iso(now), last_seen_at: iso(now), representative_exception_id: "11111111-1111-1111-1111-111111111111" },
          { category: "missing_trade", label: "no counterparty leg", occurrence_count: 5, first_seen_at: iso(now), last_seen_at: iso(now), representative_exception_id: "22222222-2222-2222-2222-222222222222" },
        ],
      },
    });
    const out = await repeatBreakPatterns(supa, { type: "tenant", tenantId: "t1" }, { window_days: 7, min_count: 3 });
    expect(out).toHaveLength(2);
    expect(out[0].pattern_key).toContain("::");
    expect(out[0].sample_break_ids).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("returns [] when no patterns found", async () => {
    const supa = makeMockSupa({ tableData: { break_root_causes: [] } });
    const out = await repeatBreakPatterns(supa, { type: "tenant", tenantId: "t1" }, { window_days: 7, min_count: 3 });
    expect(out).toEqual([]);
  });
});
