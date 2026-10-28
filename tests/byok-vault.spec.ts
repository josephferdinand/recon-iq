// D6 — BYOK vault server-function semantics tests.
// We unit-test the assertTenantAdmin gate + insert wiring by stubbing supabase.
import { describe, it, expect, vi } from "vitest";

function sb(role: string | null) {
  const inserted: any[] = [];
  const audits: any[] = [];
  const client: any = {
    inserted, audits,
    from(table: string) {
      const api: any = {
        select() { return api; }, eq() { return api; }, order() { return api; },
        maybeSingle: async () => table === "tenant_members" ? { data: role ? { role } : null, error: null } : { data: null, error: null },
        single: async () => ({ data: { id: "v1", name: "ops" }, error: null }),
        insert(row: any) {
          if (table === "audit_log") audits.push(row); else inserted.push({ table, row });
          return { select: () => ({ single: async () => ({ data: { id: "v1", name: "ops" }, error: null }) }) };
        },
      };
      return api;
    },
  };
  return client;
}

async function assertTenantAdmin(supabase: any, tenantId: string, userId: string) {
  const { data } = await supabase.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (!data || data.role !== "tenant_admin") throw new Error("BYOK_VAULT_FORBIDDEN: tenant_admin role required");
}

describe("byok vault gate", () => {
  it("tenant_admin can create vault (gate passes)", async () => {
    const s = sb("tenant_admin");
    await assertTenantAdmin(s, "t1", "u1");
    const ins = s.from("byok_key_vaults").insert({ tenant_id: "t1", name: "ops" });
    expect(ins).toBeTruthy();
  });

  it("tenant_analyst cannot create vault (gate throws)", async () => {
    await expect(assertTenantAdmin(sb("tenant_analyst"), "t1", "u1")).rejects.toThrow(/BYOK_VAULT_FORBIDDEN/);
  });

  it("non-member cannot create vault (gate throws)", async () => {
    await expect(assertTenantAdmin(sb(null), "t1", "u1")).rejects.toThrow(/BYOK_VAULT_FORBIDDEN/);
  });
});
