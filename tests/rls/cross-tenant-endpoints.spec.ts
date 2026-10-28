/**
 * B2 · Cross-tenant NEGATIVE tests for critical RPC endpoints & write paths.
 * -------------------------------------------------------------------------
 * Complements tests/rls/cross-tenant.spec.ts (table-level SELECT/INSERT/
 * UPDATE/DELETE leakage) by exercising the surfaces that RLS-on-tables
 * cannot reach on its own:
 *
 *   1. SECURITY DEFINER RPCs that accept a tenant_id parameter.
 *      A user of tenant A must NEVER be able to read tenant B's data by
 *      calling one of these with tenant_id = tenantB.
 *
 *   2. Tenant-scoping WITH CHECK guards on write paths:
 *      - Cross-tenant FK "smuggling" (write into tenantA while pointing at
 *        a tenantB parent row)
 *      - Row-hijack (UPDATE own row and set tenant_id → tenantB)
 *      - Direct writes to audit / security_events with tenant_id = tenantB
 *
 *   3. The `assert_tenant_access` guard itself must raise 42501 when a
 *      non-member calls it for a foreign tenant.
 *
 * These are pure negative assertions — every "expect(...).toBe(0)" or
 * "expect(...).rejects" documents a security guarantee that MUST hold in
 * production. A green run proves cross-tenant isolation is enforced at the
 * RPC layer, not just at the table layer.
 *
 * Run:  bun run vitest run tests/rls/cross-tenant-endpoints.spec.ts
 */

// @ts-nocheck — depends on live Supabase env vars and runtime types.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { purgeTestTenants, recordTestTenantCreated } from "../helpers/tenant-teardown";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// LL-020 graceful-skip guard — see tests/rls/cross-tenant.spec.ts.
const HAS_SUPABASE_ENV = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PW = "Test!12345";

const _clientCache = new Map<string, SupabaseClient>();
async function userClient(email: string): Promise<SupabaseClient> {
  const cached = _clientCache.get(email);
  if (cached) return cached;
  const c = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  _clientCache.set(email, c);
  return c;
}

// LL-020 graceful-skip guard (paired with the constant above).
const rlsEndpointsSuite = HAS_SUPABASE_ENV ? describe : describe.skip;

rlsEndpointsSuite("RLS · cross-tenant NEGATIVE tests for critical endpoints", () => {
  let tenantA: string;
  let tenantB: string;
  let admA: { id: string; email: string };
  let admB: { id: string; email: string };

  // Seeded tenantB artifacts we'll try to reach from userA.
  let defB: string;
  let runB: string;
  let matchB: string;
  let excB: string;
  let dtNodeB: string;

  // TenantA parent we'll use for FK-smuggling tests.
  let defA: string;

  async function mkUser(prefix: string) {
    const email = `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fvi.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PW, email_confirm: true,
    });
    if (error) throw error;
    return { id: data.user!.id, email };
  }

  beforeAll(async () => {
    // LL-020: short-circuit beforeAll when env vars are missing.
    if (!HAS_SUPABASE_ENV) return;
    const ts = Date.now();
    const { data: famA } = await admin.from("tenant_families").insert({ name: `xefA-${ts}` }).select("id").single();
    const { data: famB } = await admin.from("tenant_families").insert({ name: `xefB-${ts}` }).select("id").single();
    const { data: a } = await admin.from("tenants").insert({
      name: "XEP-A", slug: `xepa-${ts}`, environment: "dev", region: "eu-west-1", family_id: famA!.id,
    }).select("id").single();
    const { data: b } = await admin.from("tenants").insert({
      name: "XEP-B", slug: `xepb-${ts}`, environment: "dev", region: "eu-west-1", family_id: famB!.id,
    }).select("id").single();
    tenantA = a!.id; tenantB = b!.id;
    await recordTestTenantCreated(admin, tenantA, `xepa-${ts}`);
    await recordTestTenantCreated(admin, tenantB, `xepb-${ts}`);

    admA = await mkUser("xep-admA");
    admB = await mkUser("xep-admB");

    const { error: memErr } = await admin.from("tenant_members").insert([
      { tenant_id: tenantA, user_id: admA.id, role: "tenant_admin", invited_by: admA.id },
      { tenant_id: tenantB, user_id: admB.id, role: "tenant_admin", invited_by: admB.id },
    ]);
    if (memErr) throw new Error(`[endpoints beforeAll] tenant_members seed failed: ${memErr.message}`);

    // TenantA parent (recon_definitions) — used to smuggle-write into tenantA
    // referencing tenantB children.
    const { data: dA, error: dAErr } = await admin.from("recon_definitions").insert({
      tenant_id: tenantA, name: `defA-${ts}`, recon_type: "two_sided", created_by: admA.id,
    }).select("id").single();
    if (dAErr) throw new Error(`seed defA failed: ${dAErr.message}`);
    defA = dA!.id;

    // TenantB seed graph: definition → run → match/exception
    const { data: dB } = await admin.from("recon_definitions").insert({
      tenant_id: tenantB, name: `defB-${ts}`, recon_type: "two_sided", created_by: admB.id,
    }).select("id").single();
    defB = dB!.id;

    const { data: rB } = await admin.from("recon_runs").insert({
      tenant_id: tenantB, recon_definition_id: defB, status: "completed",
    }).select("id").single();
    runB = rB?.id ?? null;

    if (runB) {
      const { data: mB } = await admin.from("recon_matches").insert({
        tenant_id: tenantB, recon_run_id: runB, recon_definition_id: defB, status: "matched",
      }).select("id").maybeSingle();
      matchB = mB?.id ?? null;

      const { data: eB } = await admin.from("recon_exceptions").insert({
        tenant_id: tenantB, recon_run_id: runB, recon_definition_id: defB, status: "open",
      }).select("id").maybeSingle();
      excB = eB?.id ?? null;
    }

    // Digital twin seed in tenantB (for get_digital_twin_subgraph negative test)
    const { data: dtn } = await admin.from("digital_twin_nodes").insert({
      tenant_id: tenantB, label: `dtB-${ts}`, node_type: "process", status: "healthy",
    }).select("id").maybeSingle();
    dtNodeB = dtn?.id ?? null;
  });

  afterAll(async () => {
    // LL-020: short-circuit afterAll when env vars are missing.
    if (!HAS_SUPABASE_ENV) return;
    await purgeTestTenants(admin, [tenantA, tenantB]);
    for (const u of [admA, admB]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 1) SECURITY DEFINER RPCs must not disclose tenantB to userA
  // ────────────────────────────────────────────────────────────────────
  describe("SECURITY DEFINER RPCs refuse foreign tenant_id", () => {
    it("assert_tenant_access(tenantB) throws 42501 for userA", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.rpc("assert_tenant_access", { _tenant_id: tenantB });
      // Must raise — data is null and error non-null with 42501 or PGRST.
      expect(error).not.toBeNull();
      const msg = `${error?.code ?? ""} ${error?.message ?? ""}`;
      expect(msg).toMatch(/42501|tenant_isolation|not a member|permission/i);
      void data;
    });

    it("assert_tenant_access(tenantA) succeeds for userA (positive control)", async () => {
      const c = await userClient(admA.email);
      const { error } = await c.rpc("assert_tenant_access", { _tenant_id: tenantA });
      expect(error).toBeNull();
    });

    it("is_tenant_member(userA, tenantB) returns false", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.rpc("is_tenant_member", {
        _user_id: admA.id, _tenant_id: tenantB,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("has_tenant_role(userA, tenantB, tenant_admin) returns false", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.rpc("has_tenant_role", {
        _user_id: admA.id, _tenant_id: tenantB, _role: "tenant_admin",
      });
      // Function may not exist under this exact signature in every deploy.
      if (error && /function .* does not exist/i.test(error.message ?? "")) return;
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("verify_recon_evidence_chain(tenantB) reveals no tenantB packs to userA", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.rpc("verify_recon_evidence_chain", { _tenant_id: tenantB });
      // Acceptable outcomes: RPC errors (denied) OR returns 0 rows.
      // A non-empty payload from a tenantB call would be a real leak.
      if (error) {
        expect(`${error.code ?? ""} ${error.message ?? ""}`).toMatch(/42501|tenant_isolation|permission|denied/i);
        return;
      }
      expect((data ?? []).length).toBe(0);
    });

    it("get_digital_twin_subgraph(tenantB, node_from_B) reveals no rows to userA", async () => {
      if (!dtNodeB) return; // seed failed — skip
      const c = await userClient(admA.email);
      const { data, error } = await c.rpc("get_digital_twin_subgraph", {
        _tenant_id: tenantB, _root_node_id: dtNodeB, _max_depth: 2,
      });
      if (error) {
        expect(`${error.code ?? ""} ${error.message ?? ""}`).toMatch(/42501|tenant_isolation|permission|denied/i);
        return;
      }
      expect((data ?? []).length).toBe(0);
    });

    it("generate_recon_run_evidence_pack(runB) does not generate a pack for userA", async () => {
      if (!runB) return;
      const c = await userClient(admA.email);
      const { data, error } = await c.rpc("generate_recon_run_evidence_pack", { _run_id: runB });
      // Either an explicit RLS/permission error, or the RPC returns null/false
      // because the underlying SELECT is filtered out by RLS.
      if (error) {
        expect(`${error.code ?? ""} ${error.message ?? ""}`).toMatch(/42501|tenant_isolation|permission|denied|not found/i);
        return;
      }
      // No pack id should be returned; and no evidence row should exist in tenantB
      // that was created by userA.
      if (data) {
        const { data: pack } = await admin.from("recon_run_evidence_packs")
          .select("id, tenant_id, generated_by")
          .eq("id", data as any).maybeSingle();
        if (pack) {
          expect(pack.tenant_id).not.toBe(tenantB);
        }
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2) Write-path guards
  // ────────────────────────────────────────────────────────────────────
  describe("Write paths reject cross-tenant smuggling", () => {
    it("cannot INSERT recon_matches into tenantA referencing a tenantB run/definition", async () => {
      if (!runB) return;
      const c = await userClient(admA.email);
      // Row claims tenant_id=A (userA IS a member) but the parent run/definition
      // belong to tenantB. RLS + tenancy CHECK should refuse.
      const { data, error } = await c.from("recon_matches").insert({
        tenant_id: tenantA,
        recon_run_id: runB,
        recon_definition_id: defB,
        status: "matched",
      }).select();
      // We accept EITHER an explicit error OR the row being invisible.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      // And no row must have been created in the database with those FK values
      // under tenantA.
      const { data: leak } = await admin.from("recon_matches")
        .select("id, tenant_id")
        .eq("recon_run_id", runB)
        .eq("tenant_id", tenantA);
      expect((leak ?? []).length).toBe(0);
    });

    it("cannot INSERT recon_exceptions into tenantA referencing a tenantB run", async () => {
      if (!runB) return;
      const c = await userClient(admA.email);
      const { data, error } = await c.from("recon_exceptions").insert({
        tenant_id: tenantA,
        recon_run_id: runB,
        recon_definition_id: defB,
        status: "open",
      }).select();
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      const { data: leak } = await admin.from("recon_exceptions")
        .select("id")
        .eq("recon_run_id", runB)
        .eq("tenant_id", tenantA);
      expect((leak ?? []).length).toBe(0);
    });

    it("cannot UPDATE own tenant_members row to move it into tenantB (row-hijack)", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.from("tenant_members")
        .update({ tenant_id: tenantB } as any)
        .eq("user_id", admA.id)
        .eq("tenant_id", tenantA)
        .select();
      // Must not succeed — either RLS WITH CHECK rejects, or 0 rows affected.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      // Verify via service-role that userA is still in tenantA and NOT in tenantB.
      const { data: still } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", admA.id);
      const tenants = new Set((still ?? []).map((r: any) => r.tenant_id));
      expect(tenants.has(tenantA)).toBe(true);
      expect(tenants.has(tenantB)).toBe(false);
    });

    it("cannot INSERT audit_log with tenant_id=tenantB", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.from("audit_log").insert({
        actor_user_id: admA.id,
        tenant_id: tenantB,
        scope: "tenant",
        action: "test.crosstenant.forgery",
        resource_type: "test",
      } as any).select();
      // audit_log is typically service-role write-only for cross-tenant.
      // Regardless of the exact policy, this insert MUST NOT land in tenantB.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      const { data: leak } = await admin.from("audit_log")
        .select("id")
        .eq("action", "test.crosstenant.forgery")
        .eq("tenant_id", tenantB);
      expect((leak ?? []).length).toBe(0);
    });

    it("cannot INSERT security_events into tenantB", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.from("security_events").insert({
        event_type: "test.crosstenant.forgery",
        severity: "low",
        actor_id: admA.id,
        tenant_id: tenantB,
        payload: {},
      } as any).select();
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      const { data: leak } = await admin.from("security_events")
        .select("id")
        .eq("event_type", "test.crosstenant.forgery")
        .eq("tenant_id", tenantB);
      expect((leak ?? []).length).toBe(0);
    });

    it("cannot INSERT api_tokens for tenantB", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.from("api_tokens").insert({
        tenant_id: tenantB,
        name: "forged-token",
        token_hash: "x".repeat(64),
        created_by: admA.id,
      } as any).select();
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      const { data: leak } = await admin.from("api_tokens")
        .select("id").eq("name", "forged-token").eq("tenant_id", tenantB);
      expect((leak ?? []).length).toBe(0);
    });

    it("cannot INSERT tenant_invitations for tenantB", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.from("tenant_invitations").insert({
        tenant_id: tenantB,
        email: `forged-${Date.now()}@fvi.test`,
        role: "tenant_admin",
        token_hash: "y".repeat(64),
        invited_by: admA.id,
      } as any).select();
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      const { data: leak } = await admin.from("tenant_invitations")
        .select("id").eq("invited_by", admA.id).eq("tenant_id", tenantB);
      expect((leak ?? []).length).toBe(0);
    });

    it("cannot UPDATE tenants.slug for tenantB", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c.from("tenants")
        .update({ slug: `hijacked-${Date.now()}` } as any)
        .eq("id", tenantB)
        .select();
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      const { data: still } = await admin.from("tenants").select("slug").eq("id", tenantB).single();
      expect((still?.slug ?? "")).not.toMatch(/^hijacked-/);
    });

    it("cannot READ tenantB's recon_matches row by primary key", async () => {
      if (!matchB) return;
      const c = await userClient(admA.email);
      const { data } = await c.from("recon_matches").select("id, tenant_id").eq("id", matchB);
      expect((data ?? []).length).toBe(0);
    });

    it("cannot READ tenantB's recon_exceptions row by primary key", async () => {
      if (!excB) return;
      const c = await userClient(admA.email);
      const { data } = await c.from("recon_exceptions").select("id, tenant_id").eq("id", excB);
      expect((data ?? []).length).toBe(0);
    });
  });
});
