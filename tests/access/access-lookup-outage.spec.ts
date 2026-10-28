import { describe, expect, it } from "vitest";
import { getMyAccessHandler, listAllTenantsHandler, listMyTenantsHandler } from "@/lib/tenants.functions";

type QueryResult = { data: unknown; error: { message: string } | null };

function db(results: Record<string, QueryResult>, rpcResult: QueryResult) {
  const query = (table: string) => {
    const result = Promise.resolve(results[table] ?? { data: [], error: null });
    const chain = { select: () => chain, eq: () => chain, order: () => result, then: result.then.bind(result) };
    return chain;
  };
  return { from: query, rpc: async () => rpcResult };
}

const context = (supabase: ReturnType<typeof db>) => ({ context: { supabase, userId: "owner" } });
const unavailable = { data: null, error: { message: "PGRST002" } };

describe("access lookup outages", () => {
  it("surfaces platform RPC failures instead of returning no access", async () => {
    const supabase = db({ tenant_members: { data: [], error: null } }, unavailable);
    await expect(listMyTenantsHandler(context(supabase))).rejects.toThrow("PGRST002");
    await expect(getMyAccessHandler(context(supabase))).rejects.toThrow("PGRST002");
    await expect(listAllTenantsHandler(context(supabase))).rejects.toThrow("PGRST002");
  });

  it("surfaces role and tenant-list failures", async () => {
    const roleFailure = db({
      tenant_members: { data: [], error: null },
      platform_roles: unavailable,
    }, { data: false, error: null });
    await expect(listMyTenantsHandler(context(roleFailure))).rejects.toThrow("PGRST002");
    await expect(getMyAccessHandler(context(roleFailure))).rejects.toThrow("PGRST002");

    const tenantFailure = db({
      tenant_members: { data: [], error: null },
      platform_roles: { data: [], error: null },
      tenants: unavailable,
    }, { data: true, error: null });
    await expect(listMyTenantsHandler(context(tenantFailure))).rejects.toThrow("PGRST002");
  });

  it("keeps a successful empty membership distinct from an outage", async () => {
    const supabase = db({
      tenant_members: { data: [], error: null },
      platform_roles: { data: [], error: null },
    }, { data: false, error: null });
    expect(await listMyTenantsHandler(context(supabase))).toEqual([]);
    expect(await getMyAccessHandler(context(supabase))).toMatchObject({
      is_platform_admin: false,
      is_platform_member: false,
      is_platform_staff: false,
    });
  });
});
