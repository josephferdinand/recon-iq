import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ provider: vi.fn(), generate: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate = (data: any) => data;
  const chain = { middleware: () => chain, validator: (fn: any) => { validate = fn; return chain; }, handler: (fn: any) => async (input: any) => fn({ ...input, data: validate(input.data) }) };
  return chain;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
vi.mock("@/lib/ai/provider-router.server", () => ({ createFviAiProvider: mocks.provider, assertResidencyCompliant: vi.fn(), resolveFviAiBaseUrl: vi.fn(), resolvePlatformAiApiKey: mocks.provider }));
vi.mock("@/lib/ai-metering.server", () => ({ checkBudget: vi.fn() }));
vi.mock("ai", () => ({ generateText: mocks.generate, tool: vi.fn(), stepCountIs: vi.fn() }));
vi.mock("@/lib/agent-runner.server", () => ({ enforceBlastRadius: vi.fn(), enforceHourlyActionLimit: vi.fn(), emitAgentReversalEvent: vi.fn(), requireProductionRunStepUp: vi.fn(), TOOL_TO_ACTION_KIND: {}, BLAST_RADIUS_DEFAULT: { maxActions: 50, maxDistinctTables: 10 }, BLAST_RADIUS_ADMIN_OVERRIDE: { maxActions: 500, maxDistinctTables: 50 } }));
import { lineageEvidencePack } from "@/lib/lineage.functions";
import { listMyWorkspaceAudit } from "@/lib/my-audit.functions";
import { runAgent } from "@/lib/agent.functions";
const tenant = "11111111-1111-4111-8111-111111111111";
function readClient(rows: any[], error: unknown = null) {
  const query: any = {};
  for (const name of ["select", "eq", "order"]) query[name] = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.then = (resolve: any, reject: any) => Promise.resolve({ data: rows, error }).then(resolve, reject);
  query.range = vi.fn(async () => ({ data: rows, error }));
  const from = vi.fn(() => query);
  return { query, from, supabase: { from } };
}
describe("Insights bounded read flows", () => {
  it("exports the selected recorded target using the original RLS client, not a global graph", async () => {
    const c = readClient([{ id: "edge", source_kind: "upload", source_ref: "source", source_label: null, target_kind: "recon", target_ref: "target", target_label: null, transform: null, recorded_at: "2026-10-02", recorded_by: null, attributes: { secret: "not-exported" } }]);
    const pack = await (lineageEvidencePack as any)({ data: { tenant_id: tenant, target_kind: "recon", target_ref: "target" }, context: { supabase: c.supabase } });
    expect(c.query.eq).toHaveBeenCalledWith("tenant_id", tenant);
    expect(c.query.eq).toHaveBeenCalledWith("target_kind", "recon");
    expect(c.query.eq).toHaveBeenCalledWith("target_ref", "target");
    expect(c.query.limit).toHaveBeenCalledWith(501);
    expect(pack.framework).toBe("Recorded data lineage");
    expect(pack.edges[0]).not.toHaveProperty("attributes");
    expect(pack.scope.coverage).toContain("completeness");
  });
  it("marks truncated lineage and keeps colon-containing resource identities distinct", async () => {
    const edge = { id: "e", source_kind: "a:b", source_ref: "c", source_label: null, target_kind: "target", target_ref: "1", target_label: null };
    const c = readClient([edge, { ...edge, id: "second", source_kind: "a", source_ref: "b:c" }, ...Array.from({ length: 499 }, (_, i) => ({ ...edge, id: String(i) }))]);
    const pack = await (lineageEvidencePack as any)({ data: { tenant_id: tenant }, context: { supabase: c.supabase } });
    expect(pack.edges).toHaveLength(500);
    expect(pack.scope.has_more).toBe(true);
    expect(pack.nodes).toHaveLength(3);
  });
  it("does not issue a lineage read for a partial target filter", async () => {
    const c = readClient([]);
    await expect((lineageEvidencePack as any)({ data: { tenant_id: tenant, target_ref: "target" }, context: { supabase: c.supabase } })).rejects.toThrow();
    expect(c.from).not.toHaveBeenCalled();
  });
  it("binds audit information to session actor and exposes a bounded-history ending", async () => {
    const c = readClient(Array.from({ length: 26 }, (_, i) => ({ id: i, action: "read" })));
    const result = await (listMyWorkspaceAudit as any)({ data: { tenant_id: tenant, page: 400, actor_id: "forged" }, context: { supabase: c.supabase, userId: "session-actor" } });
    expect(c.query.eq).toHaveBeenCalledWith("actor_user_id", "session-actor");
    expect(c.query.eq).toHaveBeenCalledWith("tenant_id", tenant);
    expect(c.query.select).toHaveBeenCalledWith("id,occurred_at,scope,action,resource_type,resource_id,row_hash,prev_hash");
    expect(result.rows).toHaveLength(25);
    expect(result.has_more).toBe(false);
    expect(result.window_limit_reached).toBe(true);
  });
  it("does not convert personal-audit denial into an empty record list", async () => {
    const c = readClient([], { code: "42501" });
    await expect((listMyWorkspaceAudit as any)({ data: { tenant_id: tenant }, context: { supabase: c.supabase, userId: "session-actor" } })).rejects.toThrow("Forbidden");
  });
  it.each(["supervised", "autonomous"])("refuses %s Agent requests before provider or history operations", async (autonomy) => {
    const from = vi.fn(), rpc = vi.fn();
    await expect((runAgent as any)({ data: { tenant_id: tenant, objective: "Synthetic read-only investigation", autonomy }, context: { supabase: { from, rpc } } })).rejects.toThrow("restricted to read-only");
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
});
