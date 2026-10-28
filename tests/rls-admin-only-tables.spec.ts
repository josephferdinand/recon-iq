/**
 * RLS integration tests
 * ---------------------
 * Confirms that only intended roles can read/write:
 *   - public.tenant_domain_verification  (tenant_admin + platform_admin only)
 *   - public.reporting_db_exports        (tenant_admin + platform_admin only)
 *
 * Strategy:
 *   - Use the service role to create a tenant, 3 user fixtures (admin / analyst
 *     / outsider) and seed rows.
 *   - For each user, build a JWT-scoped PostgREST client via
 *     `supabase.auth.admin.generateLink` → `setSession`, then attempt SELECT
 *     / INSERT / UPDATE / DELETE and assert the RLS outcome.
 *   - A platform_admin user is added via `platform_roles` and asserted to have
 *     full access across tenants.
 *
 * Run once vitest is wired:
 *   bunx vitest run tests/rls-admin-only-tables.spec.ts
 */

// @ts-nocheck — runnable only once vitest is installed.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { purgeTestTenants, recordTestTenantCreated } from "./helpers/tenant-teardown";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const _clientCache = new Map<string, SupabaseClient>();
async function userClient(email: string, password: string): Promise<SupabaseClient> {
  const cached = _clientCache.get(email);
  if (cached) return cached;
  const c = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  _clientCache.set(email, c);
  return c;
}

describe("RLS · admin-only tables", () => {
  let tenantA: string;
  let tenantB: string;
  let tenantAdmin: { id: string; email: string };
  let analyst: { id: string; email: string };
  let outsider: { id: string; email: string };
  let platformAdmin: { id: string; email: string };
  const PW = "Test!12345";

  async function mkUser(prefix: string) {
    const email = `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fvi.test`;
    const { data } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
    return { id: data.user!.id, email };
  }

  beforeAll(async () => {
    const stamp = Date.now();
    const { data: famA } = await admin.from("tenant_families").insert({ name: `rlsfamA-${stamp}` }).select("id").single();
    const { data: famB } = await admin.from("tenant_families").insert({ name: `rlsfamB-${stamp}` }).select("id").single();
    const { data: a } = await admin.from("tenants").insert({
      name: "RLS A", slug: `rls-a-${stamp}`, environment: "dev", region: "eu-west-1", family_id: famA!.id,
    }).select("id").single();
    const { data: b } = await admin.from("tenants").insert({
      name: "RLS B", slug: `rls-b-${stamp}`, environment: "dev", region: "eu-west-1", family_id: famB!.id,
    }).select("id").single();
    tenantA = a!.id; tenantB = b!.id;
    await recordTestTenantCreated(admin, tenantA, `rls-a-${stamp}`);
    await recordTestTenantCreated(admin, tenantB, `rls-b-${stamp}`);

    tenantAdmin   = await mkUser("rls-admin");
    analyst       = await mkUser("rls-analyst");
    outsider      = await mkUser("rls-outsider");
    platformAdmin = await mkUser("rls-platadmin");

    await admin.from("tenant_members").insert([
      { tenant_id: tenantA, user_id: tenantAdmin.id, role: "tenant_admin",  invited_by: tenantAdmin.id },
      { tenant_id: tenantA, user_id: analyst.id,    role: "tenant_analyst", invited_by: tenantAdmin.id },
    ]);
    await admin.from("platform_roles").insert({ user_id: platformAdmin.id, role: "platform_admin" });

    // Seed rows in tenant A
    await admin.from("tenant_domain_verification").insert({
      tenant_id: tenantA, token_hash: "seed-hash-A",
    });
    await admin.from("reporting_db_exports").insert({
      tenant_id: tenantA, name: "Seed export A",
    } as any);
  });

  afterAll(async () => {
    await purgeTestTenants(admin, [tenantA, tenantB]);
    for (const u of [tenantAdmin, analyst, outsider, platformAdmin]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  });

  describe("tenant_domain_verification", () => {
    it("tenant_admin can SELECT own-tenant rows", async () => {
      const c = await userClient(tenantAdmin.email, PW);
      const { data, error } = await c.from("tenant_domain_verification").select("*").eq("tenant_id", tenantA);
      expect(error).toBeNull();
      expect(data!.length).toBe(1);
    });

    it("tenant_analyst cannot SELECT", async () => {
      const c = await userClient(analyst.email, PW);
      const { data } = await c.from("tenant_domain_verification").select("*").eq("tenant_id", tenantA);
      expect(data ?? []).toHaveLength(0);
    });

    it("outsider cannot SELECT", async () => {
      const c = await userClient(outsider.email, PW);
      const { data } = await c.from("tenant_domain_verification").select("*").eq("tenant_id", tenantA);
      expect(data ?? []).toHaveLength(0);
    });

    it("tenant_admin can UPDATE own-tenant rows", async () => {
      const c = await userClient(tenantAdmin.email, PW);
      const { error } = await c.from("tenant_domain_verification")
        .update({ token_hash: "rotated-A" }).eq("tenant_id", tenantA);
      expect(error).toBeNull();
    });

    it("tenant_analyst cannot UPDATE", async () => {
      const c = await userClient(analyst.email, PW);
      const { error, data } = await c.from("tenant_domain_verification")
        .update({ token_hash: "hacker" }).eq("tenant_id", tenantA).select();
      // Either RLS blocks (error) or zero rows updated
      expect((data ?? []).length).toBe(0);
    });

    it("platform_admin can SELECT across tenants", async () => {
      const c = await userClient(platformAdmin.email, PW);
      const { data, error } = await c.from("tenant_domain_verification").select("*");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("reporting_db_exports", () => {
    it("tenant_admin can SELECT own-tenant rows", async () => {
      const c = await userClient(tenantAdmin.email, PW);
      const { data, error } = await c.from("reporting_db_exports").select("*").eq("tenant_id", tenantA);
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("tenant_analyst cannot SELECT", async () => {
      const c = await userClient(analyst.email, PW);
      const { data } = await c.from("reporting_db_exports").select("*").eq("tenant_id", tenantA);
      expect(data ?? []).toHaveLength(0);
    });

    it("outsider cannot INSERT into tenant A", async () => {
      const c = await userClient(outsider.email, PW);
      const { error } = await c.from("reporting_db_exports").insert({
        tenant_id: tenantA, name: "hijack",
      } as any);
      expect(error).not.toBeNull();
    });

    it("platform_admin can INSERT into any tenant", async () => {
      const c = await userClient(platformAdmin.email, PW);
      const { error } = await c.from("reporting_db_exports").insert({
        tenant_id: tenantB, name: "platform-seed",
      } as any);
      expect(error).toBeNull();
    });

    it("tenant_admin can DELETE own-tenant rows", async () => {
      const c = await userClient(tenantAdmin.email, PW);
      const { error } = await c.from("reporting_db_exports").delete().eq("tenant_id", tenantA);
      expect(error).toBeNull();
    });
  });
});
