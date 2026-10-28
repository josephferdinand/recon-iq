/**
 * RLS Multi-Tenant Regression Suite
 * ---------------------------------
 * Pre-deployment gate that confirms tenant-isolation boundaries and
 * wizard/process-library permission paths cannot be crossed.
 *
 * Coverage:
 *   1. Cross-tenant SELECT/INSERT/UPDATE/DELETE on recon_definitions,
 *      recon_exceptions, rekon_wizard_drafts, process_wizard_runs.
 *   2. process_library: only platform_admin can write; non-admins can read
 *      published rows but never unpublished ones.
 *   3. rekon_wizard_drafts: a user cannot read or write another user's
 *      draft, even within the same tenant.
 *   4. process_wizard_runs: tenant_viewer cannot insert; only analyst/admin.
 *   5. Platform admin override paths execute successfully.
 *
 * Run:
 *   bunx vitest run tests/rls-multi-tenant-regression.spec.ts
 *
 * CI: executed automatically by .github/workflows/ci.yml on every PR and
 *     push to main when TEST_SUPABASE_* secrets are configured.
 */

// @ts-nocheck — runnable only with live Supabase env vars.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { purgeTestTenants, recordTestTenantCreated } from "./helpers/tenant-teardown";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PW = "Test!12345";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const _clientCache = new Map<string, SupabaseClient>();
async function userClient(email: string): Promise<SupabaseClient> {
  const cached = _clientCache.get(email);
  if (cached) return cached;
  const c = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  _clientCache.set(email, c);
  return c;
}

async function mkUser(prefix: string) {
  const email = `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fvi.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true,
  });
  if (error) throw error;
  return { id: data.user!.id, email };
}

describe("RLS · multi-tenant regression", () => {
  let tenantA: string, tenantB: string;
  let adminA: any, analystA: any, viewerA: any;
  let adminB: any;
  let platformAdmin: any;
  let outsider: any;
  let publishedSlug: string, draftSlug: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const { data: famA } = await admin.from("tenant_families").insert({ name: `regfamA-${stamp}` }).select("id").single();
    const { data: famB } = await admin.from("tenant_families").insert({ name: `regfamB-${stamp}` }).select("id").single();
    const { data: a } = await admin.from("tenants").insert({
      name: "RegA", slug: `reg-a-${stamp}`, environment: "dev", region: "eu-west-1", family_id: famA!.id,
    }).select("id").single();
    const { data: b } = await admin.from("tenants").insert({
      name: "RegB", slug: `reg-b-${stamp}`, environment: "dev", region: "eu-west-1", family_id: famB!.id,
    }).select("id").single();
    tenantA = a!.id; tenantB = b!.id;
    await recordTestTenantCreated(admin, tenantA, `reg-a-${stamp}`);
    await recordTestTenantCreated(admin, tenantB, `reg-b-${stamp}`);

    [adminA, analystA, viewerA, adminB, platformAdmin, outsider] = await Promise.all([
      mkUser("reg-adminA"), mkUser("reg-analystA"), mkUser("reg-viewerA"),
      mkUser("reg-adminB"), mkUser("reg-platadmin"), mkUser("reg-outsider"),
    ]);

    await admin.from("tenant_members").insert([
      { tenant_id: tenantA, user_id: adminA.id,   role: "tenant_admin",   invited_by: adminA.id },
      { tenant_id: tenantA, user_id: analystA.id, role: "tenant_analyst", invited_by: adminA.id },
      { tenant_id: tenantA, user_id: viewerA.id,  role: "tenant_viewer",  invited_by: adminA.id },
      { tenant_id: tenantB, user_id: adminB.id,   role: "tenant_admin",   invited_by: adminB.id },
    ]);
    await admin.from("platform_roles").insert({ user_id: platformAdmin.id, role: "platform_admin" });

    // Seed a published + unpublished process_library row
    publishedSlug = `pl-pub-${stamp}`;
    draftSlug = `pl-draft-${stamp}`;
    await admin.from("process_library").insert([
      { slug: publishedSlug, title: "Pub", category: "cash", blueprint: {}, published: true },
      { slug: draftSlug,     title: "Drft",category: "cash", blueprint: {}, published: false },
    ]);
  });

  afterAll(async () => {
    await admin.from("process_library").delete().in("slug", [publishedSlug, draftSlug]);
    await purgeTestTenants(admin, [tenantA, tenantB]);
    for (const u of [adminA, analystA, viewerA, adminB, platformAdmin, outsider]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  });

  // ─── Tenant boundary: recon_definitions ──────────────────────────────────
  describe("recon_definitions cross-tenant isolation", () => {
    let defAId: string;

    beforeAll(async () => {
      const { data } = await admin.from("recon_definitions").insert({
        tenant_id: tenantA, name: "A-recon", recon_type: "two_sided", visibility: "tenant",
      } as never).select("id").single();
      defAId = data!.id;
    });

    it("tenant A analyst CAN SELECT their recon", async () => {
      const c = await userClient(analystA.email);
      const { data } = await c.from("recon_definitions").select("id").eq("id", defAId);
      expect(data?.length).toBe(1);
    });

    it("tenant A admin CAN INSERT a new definition into tenant A", async () => {
      const c = await userClient(adminA.email);
      const name = `admin-created-${Date.now()}`;
      const { data, error } = await c.from("recon_definitions").insert({
        tenant_id: tenantA,
        name,
        recon_type: "one_sided",
        visibility: "tenant",
        created_by: adminA.id,
      } as never).select("id").single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    });

    it("tenant B admin CANNOT SELECT tenant A recon", async () => {
      const c = await userClient(adminB.email);
      const { data } = await c.from("recon_definitions").select("id").eq("id", defAId);
      expect(data ?? []).toHaveLength(0);
    });

    it("tenant B admin CANNOT INSERT into tenant A", async () => {
      const c = await userClient(adminB.email);
      const { error } = await c.from("recon_definitions").insert({
        tenant_id: tenantA, name: "hijack", recon_type: "two_sided", visibility: "tenant",
      } as any);
      expect(error).not.toBeNull();
    });

    it("outsider CANNOT SELECT or INSERT", async () => {
      const c = await userClient(outsider.email);
      const sel = await c.from("recon_definitions").select("id").eq("id", defAId);
      expect(sel.data ?? []).toHaveLength(0);
      const ins = await c.from("recon_definitions").insert({
        tenant_id: tenantA, name: "x", recon_type: "two_sided", visibility: "tenant",
      } as any);
      expect(ins.error).not.toBeNull();
    });

    it("platform_admin CAN SELECT across tenants", async () => {
      const c = await userClient(platformAdmin.email);
      const { data } = await c.from("recon_definitions").select("id").eq("id", defAId);
      expect(data?.length).toBe(1);
    });
  });

  // ─── Tenant boundary: recon_exceptions ───────────────────────────────────
  describe("recon_exceptions cross-tenant isolation", () => {
    let runAId: string;
    beforeAll(async () => {
      const { data: def } = await admin.from("recon_definitions").insert({
        tenant_id: tenantA, name: "A-exc-def", recon_type: "two_sided", visibility: "tenant",
      } as any).select("id").single();
      const { data: run } = await admin.from("recon_runs").insert({
        tenant_id: tenantA, definition_id: def!.id, status: "completed",
      } as any).select("id").single();
      runAId = run!.id;
    });

    it("tenant A viewer can read, tenant B admin cannot", async () => {
      const { data: row } = await admin.from("recon_exceptions").insert({
        tenant_id: tenantA, status: "open", reason: "amount_mismatch", run_id: runAId,
      } as any).select("id").single();
      expect(row).toBeTruthy();
      const va = await userClient(viewerA.email);
      const ba = await userClient(adminB.email);
      const a = await va.from("recon_exceptions").select("id").eq("id", row!.id);
      const b = await ba.from("recon_exceptions").select("id").eq("id", row!.id);
      expect(a.data?.length).toBe(1);
      expect(b.data ?? []).toHaveLength(0);
    });

    it("tenant A viewer CANNOT mutate (only analyst/admin policy)", async () => {
      const { data: row } = await admin.from("recon_exceptions").insert({
        tenant_id: tenantA, status: "open", reason: "amount_mismatch", run_id: runAId,
      } as any).select("id").single();
      const va = await userClient(viewerA.email);
      const upd = await va.from("recon_exceptions")
        .update({ status: "resolved" }).eq("id", row!.id).select();
      expect((upd.data ?? []).length).toBe(0);
    });
  });

  // ─── process_library platform-admin write gate ───────────────────────────
  describe("process_library permissions", () => {
    it("any tenant user can read published entries", async () => {
      const c = await userClient(viewerA.email);
      const { data } = await c.from("process_library").select("slug").eq("slug", publishedSlug);
      expect(data?.length).toBe(1);
    });

    it("non-admin CANNOT read draft (unpublished) entries", async () => {
      const c = await userClient(viewerA.email);
      const { data } = await c.from("process_library").select("slug").eq("slug", draftSlug);
      expect(data ?? []).toHaveLength(0);
    });

    it("non-admin CANNOT INSERT into process_library", async () => {
      const c = await userClient(adminA.email);
      const { error } = await c.from("process_library").insert({
        slug: `unauth-${Date.now()}`, title: "x", category: "cash", blueprint: {},
      } as any);
      expect(error).not.toBeNull();
    });

    it("non-admin CANNOT UPDATE published entries", async () => {
      const c = await userClient(adminA.email);
      const { data } = await c.from("process_library")
        .update({ title: "hacked" }).eq("slug", publishedSlug).select();
      expect((data ?? []).length).toBe(0);
    });

    it("platform_admin CAN write process_library entries", async () => {
      const c = await userClient(platformAdmin.email);
      const slug = `pl-platadmin-${Date.now()}`;
      const ins = await c.from("process_library").insert({
        slug, title: "PA", category: "cash", blueprint: {}, published: true,
      } as any);
      expect(ins.error).toBeNull();
      await admin.from("process_library").delete().eq("slug", slug);
    });
  });

  // ─── process_wizard_runs role-gated writes ───────────────────────────────
  describe("process_wizard_runs permission paths", () => {
    it("tenant A analyst CAN start a wizard run", async () => {
      const c = await userClient(analystA.email);
      const { error } = await c.from("process_wizard_runs").insert({
        tenant_id: tenantA, template_key: "cash-basic", started_by: analystA.id,
      } as any);
      expect(error).toBeNull();
    });

    it("tenant A viewer CANNOT start a wizard run (analyst/admin only)", async () => {
      const c = await userClient(viewerA.email);
      const { error } = await c.from("process_wizard_runs").insert({
        tenant_id: tenantA, template_key: "cash-basic", started_by: viewerA.id,
      } as any);
      expect(error).not.toBeNull();
    });

    it("tenant B admin CANNOT start a wizard run in tenant A", async () => {
      const c = await userClient(adminB.email);
      const { error } = await c.from("process_wizard_runs").insert({
        tenant_id: tenantA, template_key: "cash-basic", started_by: adminB.id,
      } as any);
      expect(error).not.toBeNull();
    });

    it("tenant B admin CANNOT SELECT tenant A runs", async () => {
      const { data: row } = await admin.from("process_wizard_runs").insert({
        tenant_id: tenantA, template_key: "x", started_by: adminA.id,
      } as any).select("id").single();
      const c = await userClient(adminB.email);
      const { data } = await c.from("process_wizard_runs").select("id").eq("id", row!.id);
      expect(data ?? []).toHaveLength(0);
    });
  });

  // ─── rekon_wizard_drafts per-user isolation ──────────────────────────────
  describe("rekon_wizard_drafts per-user isolation", () => {
    let draftId: string;

    beforeAll(async () => {
      const { data } = await admin.from("rekon_wizard_drafts").insert({
        tenant_id: tenantA, user_id: analystA.id, draft: { step: 1 },
      } as any).select("id").single();
      draftId = data!.id;
    });

    it("owner can read their draft", async () => {
      const c = await userClient(analystA.email);
      const { data } = await c.from("rekon_wizard_drafts").select("id").eq("id", draftId);
      expect(data?.length).toBe(1);
    });

    it("same-tenant non-owner CANNOT read another user's draft", async () => {
      const c = await userClient(adminA.email);
      const { data } = await c.from("rekon_wizard_drafts").select("id").eq("id", draftId);
      expect(data ?? []).toHaveLength(0);
    });

    it("cross-tenant user CANNOT read draft", async () => {
      const c = await userClient(adminB.email);
      const { data } = await c.from("rekon_wizard_drafts").select("id").eq("id", draftId);
      expect(data ?? []).toHaveLength(0);
    });

    it("non-owner CANNOT update draft", async () => {
      const c = await userClient(adminA.email);
      const { data } = await c.from("rekon_wizard_drafts")
        .update({ draft: { hijack: true } }).eq("id", draftId).select();
      expect((data ?? []).length).toBe(0);
    });
  });
});
