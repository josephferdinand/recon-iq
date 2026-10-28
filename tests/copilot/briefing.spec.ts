import { describe, it, expect } from "vitest";
import { generateThreadBriefing } from "@/lib/copilot-briefing.server";
import { makeMockSupa } from "./_supa-mock";

describe("generateThreadBriefing", () => {
  it("produces a headline with open break count and SLA risk", async () => {
    const supa = makeMockSupa({
      tableData: {
        recon_exceptions: [],
        break_sla_timers: [
          { exception_id: "11111111-1111-1111-1111-111111111111", due_resolution_at: new Date(Date.now() + 60_000).toISOString() },
        ],
        recon_runs: [],
        break_root_causes: [
          { category: "fx", label: "drift", occurrence_count: 7, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), representative_exception_id: "22222222-2222-2222-2222-222222222222" },
        ],
      },
      countOverride: { recon_exceptions: 10 },
    });
    const out = await generateThreadBriefing(
      supa,
      "user-1",
      { type: "tenant", tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      "tenant",
    );
    expect(out.open_breaks).toBe(10);
    expect(out.sla_at_risk_today).toBe(1);
    expect(out.top_pattern_7d).not.toBeNull();
    expect(out.headline).toMatch(/open breaks/);
    expect(out.headline).toMatch(/SLA breach/);
  });

  it("returns a zero-state briefing when there is no data", async () => {
    const supa = makeMockSupa({ countOverride: { recon_exceptions: 0 } });
    const out = await generateThreadBriefing(
      supa,
      "user-2",
      { type: "platform" },
      "platform",
    );
    expect(out.open_breaks).toBe(0);
    expect(out.sla_at_risk_today).toBe(0);
    expect(out.top_pattern_7d).toBeNull();
    expect(out.headline).toMatch(/0 open breaks/);
  });
});
