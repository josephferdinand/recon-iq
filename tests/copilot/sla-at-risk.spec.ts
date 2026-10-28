import { describe, it, expect } from "vitest";
import { slaAtRisk } from "@/lib/copilot-tools.server";
import { makeMockSupa } from "./_supa-mock";

const inSoon = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();

describe("slaAtRisk", () => {
  it("tenant scope: filters by tenant_id and returns at-risk breaks", async () => {
    const log: string[] = [];
    const supa = makeMockSupa({
      log,
      tableData: {
        break_sla_timers: [
          { exception_id: "11111111-1111-1111-1111-111111111111", due_resolution_at: inSoon(30) },
          { exception_id: "22222222-2222-2222-2222-222222222222", due_resolution_at: inSoon(120) },
        ],
      },
    });
    const out = await slaAtRisk(supa, { type: "tenant", tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }, { window: "24h", limit: 10 });
    expect(out.breaks_at_risk).toBe(2);
    expect(out.worst_offenders).toHaveLength(2);
    expect(out.worst_offenders[0].sla_minutes_remaining).toBeLessThan(out.worst_offenders[1].sla_minutes_remaining + 1);
    expect(log.some((l) => l.startsWith("eq:") && l.includes("tenant_id"))).toBe(true);
  });

  it("platform scope: does NOT apply a tenant_id filter", async () => {
    const log: string[] = [];
    const supa = makeMockSupa({
      log,
      tableData: { break_sla_timers: [{ exception_id: "33333333-3333-3333-3333-333333333333", due_resolution_at: inSoon(10) }] },
    });
    const out = await slaAtRisk(supa, { type: "platform" }, { window: "today", limit: 5 });
    expect(out.breaks_at_risk).toBe(1);
    expect(log.some((l) => l.startsWith("eq:") && l.includes("tenant_id"))).toBe(false);
  });

  it("non-member (empty rows): returns zero counts and empty array, no error", async () => {
    const supa = makeMockSupa({ tableData: { break_sla_timers: [] } });
    const out = await slaAtRisk(supa, { type: "tenant", tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }, { window: "7d" });
    expect(out).toEqual({ breaks_at_risk: 0, reconciled_at_risk: 0, worst_offenders: [] });
  });
});
