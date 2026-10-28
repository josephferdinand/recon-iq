import { describe, expect, it } from "vitest";
import { getTenantBySlugHandler } from "@/lib/tenants.functions";

type Result = { data: any; error: { message: string } | null };
const ok = (data: any): Result => ({ data, error: null });
const fail = (message = "PGRST002"): Result => ({ data: null, error: { message } });
const tenant = { id: "tenant-a", slug: "assurance", name: "Assurance" };

function context(overrides: Partial<Record<string, Result>> = {}) {
  const results: Record<string, Result> = {
    tenants: ok(tenant),
    tenant_members: ok({ role: "tenant_admin" }),
    platform_roles: ok([]),
    audit_log: ok(null),
    rpc: ok(false),
    ...overrides,
  };
  const supabase = {
    from(table: string) {
      const result = Promise.resolve(results[table]);
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () => result,
        insert: () => result,
        then: result.then.bind(result),
      };
      return query;
    },
    rpc: async () => results.rpc,
  };
  return { data: { slug: "assurance" }, context: { supabase, userId: "owner" } } as any;
}

describe("tenant slug access during query failures", () => {
  it.each(["tenants", "tenant_members", "rpc"])("surfaces %s failure", async (table) => {
    await expect(getTenantBySlugHandler(context({ [table]: fail() }))).rejects.toThrow("PGRST002");
  });

  it("surfaces platform-role failure instead of denying access", async () => {
    await expect(getTenantBySlugHandler(context({ tenant_members: ok(null), platform_roles: fail() })))
      .rejects.toThrow("PGRST002");
  });

  it("requires the visibility audit to persist for platform override", async () => {
    await expect(getTenantBySlugHandler(context({ tenant_members: ok(null), rpc: ok(true), audit_log: fail() })))
      .rejects.toThrow("PGRST002");
  });

  it("keeps a real missing tenant and real denied access distinct from outages", async () => {
    await expect(getTenantBySlugHandler(context({ tenants: ok(null) }))).rejects.toThrow("Tenant not found");
    await expect(getTenantBySlugHandler(context({ tenant_members: ok(null) }))).rejects.toThrow("Forbidden");
  });

  it("still returns the authorized tenant role", async () => {
    await expect(getTenantBySlugHandler(context())).resolves.toMatchObject({ id: "tenant-a", role: "tenant_admin" });
  });
});
