import { describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ middleware() { return this; }, validator() { return this; }, handler(fn: unknown) { return fn; } }) }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
import { listGovernanceAuditTrailHandler, getGovernanceAuditEventHandler, governanceAuditListSchema, projectGovernanceAuditEvent } from "@/lib/governance-audit.functions";

const tenant = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
function database(options: { active?: boolean; role?: string; permission?: unknown; permissionError?: boolean; auditError?: boolean; profiles?: Array<{ id: string; full_name: string }> } = {}) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; projection: string; ors: string[] }> = [];
  const rows = Array.from({ length: 31 }, (_, n) => ({ id: n + 1, tenant_id: tenant, actor_user_id: actor, occurred_at: "2026-10-02T10:00:00Z", scope: "tenant", action: "governance.membership.approve", resource_type: "membership_request", resource_id: null, context: { outcome: n % 2 ? "success" : "pending", reason: "Independent review completed", version: 2, token: "private-value", nested: { secret: "never-return" } } }));
  const supabase = {
    rpc: vi.fn(async (_name: string, _args: unknown) => ({ data: options.permission === undefined ? true : options.permission, error: options.permissionError ? { code: "broken" } : null })),
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]>, projection: "", ors: [] as string[] }; calls.push(call);
      let range: [number, number] | undefined, head = false, limit: number | undefined;
      const query: any = {
        select(projection: string, opts?: { head?: boolean }) { call.projection = projection; head = opts?.head ?? false; return query; },
        eq(key: string, value: unknown) { call.filters.push([key, value]); return query; },
        in(key: string, value: unknown) { call.filters.push([key, value]); return query; },
        gte() { return query; }, lte() { return query; },
        ilike(key: string, pattern: string) { call.filters.push([key, { pattern }]); return query; },
        or(predicate: string) { call.ors.push(predicate); return query; },
        limit(value: number) { limit = value; return query; }, order() { return query; },
        range(start: number, end: number) { range = [start, end]; return query; },
        async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return execute().then(resolve, reject); },
      };
      async function execute() {
        let data: any[] = table === "audit_log" ? rows
          : table === "tenant_members" ? [{ user_id: actor, tenant_id: tenant, active: options.active ?? true, role: options.role ?? "tenant_admin" }]
          : table === "profiles" ? options.profiles ?? [{ id: actor, full_name: "Actual authorized label" }, { id: other, full_name: "Unrelated private label" }] : [];
        for (const [key, value] of call.filters) data = data.filter(r => {
          const actual = key === "context->>outcome" ? r.context?.outcome : r[key];
          if (value && typeof value === "object" && "pattern" in value) return String(actual ?? "").toLowerCase().includes(String(value.pattern).replaceAll("%", "").toLowerCase());
          return Array.isArray(value) ? value.includes(actual) : String(actual) === String(value);
        });
        for (const predicate of call.ors) data = data.filter(r => predicate.split(/,(?![^()]*\))/u).some(term => {
          const match = term.match(/^(.*)\.(eq|ilike|in)\.(.*)$/u);
          if (!match) throw new Error("Invalid filter grammar in test query");
          const [, key, op, value] = match;
          const actual = key.startsWith("context->>") ? r.context?.[key.slice(10)] : r[key];
          if (op === "ilike") return String(actual ?? "").toLowerCase().includes(value.replaceAll("*", "").toLowerCase());
          if (op === "in") return value.slice(1,-1).split(",").includes(String(actual));
          return String(actual) === value;
        }));
        const count = data.length;
        if (range) data = data.slice(range[0], range[1] + 1);
        if (limit !== undefined) data = data.slice(0, limit);
        return { data: head ? null : data, count, error: table === "audit_log" && options.auditError ? { code: "42501", message: "private database detail" } : null };
      }
      return query;
    },
  };
  return { context: { userId: actor, supabase }, calls, rows };
}

describe("governance audit purpose reads", () => {
  it.each([{ active: false }, { role: "platform_admin" }, { role: "tenant_viewer" }])("denies without current active tenant-admin membership: %j", async options => {
    const db = database(options);
    await expect(listGovernanceAuditTrailHandler({ data: { tenant_id: tenant }, context: db.context })).rejects.toThrow("administrator");
    expect(db.calls.some(c => c.table === "audit_log")).toBe(false);
  });
  it.each([false, null, "true"])("requires literal current permission allow: %j", async permission => {
    const db = database({ permission });
    await expect(listGovernanceAuditTrailHandler({ data: { tenant_id: tenant }, context: db.context })).rejects.toThrow("permission");
    expect(db.calls.some(c => c.table === "audit_log")).toBe(false);
  });
  it("pages from one and counts the complete filtered population", async () => {
    const db = database();
    const result = await listGovernanceAuditTrailHandler({ data: { tenant_id: tenant, page: 2, page_size: 25 }, context: db.context });
    expect(result.rows).toHaveLength(6); expect(result.total).toBe(31); expect(result.kpis.total).toBe(31);
    expect(result.kpis.success).toBe(15); expect(result.kpis.pending).toBe(16);
    expect(result.rows[0].actor_name).toBe("Actual authorized label");
    expect(db.context.supabase.rpc).toHaveBeenCalledWith("user_has_permission", { _user_id: actor, _tenant_id: tenant, _permission_id: "audit.log.read", _bu_id: null });
    expect(db.calls.filter(c => c.table === "audit_log").every(c => c.filters.some(([k,v]) => k === "tenant_id" && v === tenant))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private-value|never-return|Unrelated private/);
  });
  it("keeps outcome KPIs within the selected outcome population", async () => {
    const db = database();
    const result = await listGovernanceAuditTrailHandler({ data: { tenant_id: tenant, outcome: "success" }, context: db.context });
    expect(result.total).toBe(15); expect(result.kpis.pending).toBe(0); expect(result.kpis.unknown).toBe(0);
  });
  it("does not turn RLS/permission errors into successful empty lists", async () => {
    for (const options of [{ permissionError: true }, { auditError: true }]) {
      const db = database(options);
      await expect(listGovernanceAuditTrailHandler({ data: { tenant_id: tenant }, context: db.context })).rejects.toThrow("temporarily unavailable");
    }
  });
  it("denies wrong tenant and preserves bigint event identifiers", async () => {
    const db = database();
    await expect(getGovernanceAuditEventHandler({ data: { tenant_id: other, event_id: "1" }, context: db.context })).rejects.toThrow("administrator");
    const result = await getGovernanceAuditEventHandler({ data: { tenant_id: tenant, event_id: "1" }, context: db.context });
    expect(result?.id).toBe("1");
  });
  it("rejects actor/role overrides and query grammar injection", () => {
    expect(governanceAuditListSchema.safeParse({ tenant_id: tenant, acting_user_id: other }).success).toBe(false);
    expect(governanceAuditListSchema.safeParse({ tenant_id: tenant, search: "x),tenant_id.eq.other" }).success).toBe(false);
  });
  it("redacts sensitive scalar metadata and drops arbitrary context", () => {
    const db = database();
    const result = projectGovernanceAuditEvent({ ...db.rows[0], context: { reason: "Bearer confidential", version: 3, signed_url: "https://private", otp: "123456" } });
    expect(result.reason).toBe("[redacted]"); expect(JSON.stringify(result)).not.toContain("confidential");
    expect(result).not.toHaveProperty("context"); expect(result).not.toHaveProperty("signed_url");
  });
  it("preserves actual producer outcomes and effective multi-workspace scope", () => {
    const db = database();
    const result = projectGovernanceAuditEvent({ ...db.rows[0], context: { outcome: "no_access_granted", scope_label: "Tenant group membership; existing group rights can apply across workspaces", actor_role: "tenant_admin" } });
    expect(result.outcome).toBe("no_access_granted");
    expect(result.scope_label).toContain("across workspaces");
    expect(result.actor_role).toBe("tenant_admin");
  });
  it("denies permission revoked before returning the multi-query result", async () => {
    const db = database();
    let checks = 0;
    db.context.supabase.rpc.mockImplementation(async (_name, args: any) => {
      if (args._permission_id === "audit.log.read") checks++;
      return { data: checks < 2, error: null };
    });
    await expect(listGovernanceAuditTrailHandler({ data: { tenant_id: tenant }, context: db.context })).rejects.toThrow("permission");
  });
  it("searches exact request/review/correlation identities with the same full-count predicate", async () => {
    for (const key of ["request_id", "review_id", "correlation_id"]) {
      const db = database();
      Object.assign(db.rows[0].context, { [key]: other });
      const result = await listGovernanceAuditTrailHandler({ data: { tenant_id: tenant, search: other }, context: db.context });
      expect(result.total).toBe(1); expect(result.kpis.membership_decisions).toBe(1);
      const predicates = db.calls.filter(c => c.table === "audit_log").map(c => c.ors[0]);
      expect(new Set(predicates).size).toBe(1);
    }
  });
  it("searches only labels exposed by profiles RLS and the selected tenant membership", async () => {
    const db = database();
    const result = await listGovernanceAuditTrailHandler({ data: { tenant_id: tenant, search: "Actual authorized" }, context: db.context });
    expect(result.total).toBe(31); expect(result.kpis.membership_decisions).toBe(31);
    const otherResult = await listGovernanceAuditTrailHandler({ data: { tenant_id: tenant, search: "Unrelated private" }, context: db.context });
    expect(otherResult.total).toBe(0);
    expect(db.calls.filter(c => c.table === "audit_log").some(c => c.ors[0]?.includes(`actor_user_id.in.(${other})`))).toBe(false);
  });
  it("counts both decision families beyond the visible page and excludes initiation events", async () => {
    const db = database();
    db.rows[0].action = "governance.access_review.retain";
    db.rows[1].action = "governance.access_review.change_requested";
    db.rows[2].action = "governance.access_review.revoke";
    db.rows[3].action = "governance.membership.request";
    const result = await listGovernanceAuditTrailHandler({ data: { tenant_id: tenant, page: 2 }, context: db.context });
    expect(result.rows).toHaveLength(6); expect(result.kpis.membership_decisions).toBe(27); expect(result.kpis.access_review_decisions).toBe(3);
  });
  it("refuses over-bound actor-name matches before producing partial audit totals", async () => {
    const db = database({ profiles: Array.from({ length: 101 }, (_, n) => ({ id: `44444444-4444-4444-8444-${String(n).padStart(12,"0")}`, full_name: "Broad matching name" })) });
    await expect(listGovernanceAuditTrailHandler({ data: { tenant_id: tenant, search: "Broad" }, context: db.context })).rejects.toThrow("too broad");
    expect(db.calls.some(c => c.table === "audit_log")).toBe(false);
  });
});
