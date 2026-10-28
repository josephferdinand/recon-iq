import { describe, expect, it } from "vitest";
import { resolveAccess } from "@/lib/access.functions";

type Result = { data: any; error: { message: string } | null };
const ok = (data: any): Result => ({ data, error: null });
const fail = (): Result => ({ data: null, error: { message: "PGRST303" } });

function context(overrides: Partial<Record<string, Result>> = {}) {
  const results: Record<string, Result> = {
    is_platform_admin: ok(false),
    tenant_members: ok({ role: "operator", active: true }),
    effective_user_permissions: ok([{ permission_id: "recon.read", source: "role" }]),
    permissions: ok([{ id: "recon.read" }, { id: "recon.write" }]),
    ...overrides,
  };
  return {
    supabase: {
      rpc: async (name: string) => results[name],
      from(table: string) {
        const result = Promise.resolve(results[table]);
        const query = { select: () => query, eq: () => query, maybeSingle: () => result, then: result.then.bind(result) };
        return query;
      },
    },
  };
}

const resolve = (overrides?: Partial<Record<string, Result>>) =>
  resolveAccess(context(overrides), "owner", "tenant-a", null);

describe("effective permission resolution", () => {
  it.each(["is_platform_admin", "tenant_members", "effective_user_permissions", "permissions"])(
    "surfaces %s failure rather than returning an empty or inflated grant",
    async (source) => await expect(resolve({ [source]: fail() })).rejects.toThrow("PGRST303"),
  );

  it("keeps a suspended member denied even with platform-wide grants", async () => {
    const result = await resolve({ is_platform_admin: ok(true), tenant_members: ok({ role: "operator", active: false }) });
    expect(result.permission_ids).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it("keeps successful effective grants intact", async () => {
    const result = await resolve();
    expect(result.permission_ids).toEqual(["recon.read"]);
    expect(result.tenant_role).toBe("operator");
  });
});
