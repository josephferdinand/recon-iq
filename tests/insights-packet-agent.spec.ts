import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ governance: vi.fn(), resolve: vi.fn(), build: vi.fn(), generate: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate = (data: any) => data;
  const chain = { middleware: () => chain, validator: (fn: any) => { validate = fn; return chain; }, handler: (fn: any) => async (input: any) => fn({ ...input, data: validate(input.data) }) }; return chain;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
vi.mock("@/lib/copilot-governance.server", () => ({ resolveCopilotGovernance: mocks.governance }));
vi.mock("@/lib/model-factory.server", () => ({ resolveTenantProvider: mocks.resolve, buildModelHandle: mocks.build }));
vi.mock("@/lib/pii-redact", () => ({ redactAndAudit: async (s: string) => s.replace(/a@b.com/g, "[redacted]"), redactPii: (s: string) => ({ text: s.replace(/a@b.com/g, "[redacted]") }) }));
vi.mock("@/lib/agent-runner.server", () => ({ emitAgentReversalEvent: vi.fn(), requireProductionRunStepUp: vi.fn(), enforceHourlyActionLimit: vi.fn(), TOOL_TO_ACTION_KIND: {} }));
vi.mock("ai", () => ({ generateText: mocks.generate, tool: (value: any) => value, stepCountIs: (value: any) => value }));
import { runAgent } from "../output/insights-helmholtz-20261002/agent-integration/agent.functions";
const tenant = "11111111-1111-4111-8111-111111111111";
function client(enabled = true) {
  const writes: any[] = []; const filters: any[] = [];
  const tables: any = { platform_ai_settings: { allow_agent_global: enabled }, tenant_ai_settings: { allow_agent: true }, tenant_feature_entitlements: { allowed: true }, tenants: { ai_enabled: true }, agent_runs: { id: "run-id" } };
  const from = vi.fn((table: string) => {
    const q: any = { then: (resolve: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve) };
    for (const name of ["select", "eq", "order", "limit", "gte"]) q[name] = (...args: any[]) => { filters.push([table, name, ...args]); return q; };
    for (const name of ["insert", "update"]) q[name] = (data: any) => { writes.push([table, name, data]); return q; };
    for (const name of ["maybeSingle", "single"]) q[name] = () => Promise.resolve({ data: tables[table], error: null });
    return q;
  });
  return { supabase: { from, rpc: vi.fn(async (name: string) => ({ data: name === "user_has_permission" ? true : { totals: { open: 2501 } }, error: null })) }, writes, filters };
}
beforeEach(() => { vi.clearAllMocks(); mocks.governance.mockResolvedValue({ allowed: true, effectiveMode: "propose" }); mocks.resolve.mockResolvedValue({ model: "approved-owner-binding" }); mocks.build.mockReturnValue({ governed: true }); mocks.generate.mockResolvedValue({ text: "Authorized analysis" }); });
describe("packet governed read-only Agent", () => {
  it("executes actual SDK analysis under Suggest using the approved fenced model and only read tools", async () => {
    const c = client(); mocks.generate.mockImplementation(async (options: any) => {
      expect(options.model).toEqual({ governed: true });
      expect(Object.keys(options.tools).sort()).toEqual(["inspect_break", "report_overview", "search_breaks"]);
      const result = await options.tools.report_overview.execute({}); expect(result.totals.open).toBe(2501);
      return { text: "2501 authorized open exceptions" };
    });
    const result = await (runAgent as any)({ data: { tenant_id: tenant, objective: "Analyze current backlog a@b.com", autonomy: "read_only" }, context: { ...c, userId: "actual-actor" } });
    expect(result.status).toBe("succeeded"); expect(result.steps).toHaveLength(1);
    expect(mocks.resolve).toHaveBeenCalledWith(c.supabase, tenant);
    expect(c.writes.every(([table]) => ["agent_runs", "agent_actions", "audit_log"].includes(table))).toBe(true);
    expect(c.writes.find(([table]) => table === "audit_log")[2].actor_user_id).toBe("actual-actor");
    expect(JSON.stringify(c.writes)).not.toContain("a@b.com");
  });
  it("refuses disabled capability before provider lookup or run writes", async () => {
    const c = client(false);
    await expect((runAgent as any)({ data: { tenant_id: tenant, objective: "Analyze backlog" }, context: { ...c, userId: "actual-actor" } })).rejects.toThrow("Forbidden");
    expect(mocks.resolve).not.toHaveBeenCalled(); expect(c.writes).toHaveLength(0);
  });
  it("refuses budget/kill governance before model construction or history writes", async () => {
    const c = client(); mocks.governance.mockResolvedValue({ allowed: false });
    await expect((runAgent as any)({ data: { tenant_id: tenant, objective: "Analyze backlog" }, context: { ...c, userId: "actual-actor" } })).rejects.toThrow("governance");
    expect(mocks.build).not.toHaveBeenCalled(); expect(c.writes).toHaveLength(0);
  });
  it.each(["autonomous", "supervised"])("rejects %s without touching authorization or the provider", async autonomy => {
    const c = client(); await expect((runAgent as any)({ data: { tenant_id: tenant, objective: "Analyze backlog", autonomy }, context: { ...c, userId: "actor" } })).rejects.toThrow("read-only");
    expect(c.supabase.from).not.toHaveBeenCalled();
  });
  it("records failed outcomes without provider messages or credentials", async () => {
    const c = client(); mocks.generate.mockRejectedValue(new Error("secret-key upstream-body"));
    const result = await (runAgent as any)({ data: { tenant_id: tenant, objective: "Analyze backlog" }, context: { ...c, userId: "actor" } });
    expect(result.status).toBe("failed"); expect(JSON.stringify(c.writes)).not.toContain("secret-key");
  });
});
