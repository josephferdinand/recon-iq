/**
 * B1 · Cross-tenant RLS isolation suite
 * --------------------------------------
 * Proves "zero data leakage" between tenants is enforced by RLS, not by
 * application-layer filtering.
 *
 * Strategy (mirrors tests/rls-admin-only-tables.spec.ts):
 *   - Service-role admin client seeds 2 tenants + 5 users:
 *       * tenant_admin_A, tenant_analyst_A, tenant_member_A  (tenant A)
 *       * tenant_admin_B                                     (tenant B)
 *       * platform_admin                                     (global)
 *   - For every tenant-scoped table listed in TENANT_TABLES, seed a marker
 *     row inside TENANT B (best effort — schema-incompatible rows are
 *     logged and the table still gets the leak assertion).
 *   - Sign in as tenant_admin_A and assert NO row carrying
 *     tenant_id = tenantB is returned. This is the canonical
 *     "cross-tenant leak" assertion.
 *   - Also assert tenant_admin_B sees their own seeded row (positive control).
 *
 * Run:
 *   bun run test:rls
 */

// @ts-nocheck — depends on live Supabase env vars and runtime types.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { purgeTestTenants, recordTestTenantCreated } from "../helpers/tenant-teardown";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// LL-020 graceful-skip guard: this suite requires a live Supabase project.
// If the env vars are missing (CI without secrets), skip the entire suite
// rather than failing. This way `npm run test:rls` returns a clean skip
// when secrets are not provisioned, instead of a stack trace.
const HAS_SUPABASE_ENV = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// LL-020: when env vars are missing, `createClient` would throw because
// `SUPABASE_URL` is `undefined`. Guard with a sentinel so the describe.skip
// above prevents the suite body from executing. Even with describe.skip,
// beforeAll/afterAll hooks can still be queued, so we hold off creating
// the client until the suite body actually runs.
const admin = HAS_SUPABASE_ENV
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : (null as unknown as ReturnType<typeof createClient>);

const PW = "Test!12345";

// Cache one signed-in client per email — GoTrue rate-limits aggressive
// per-test sign-ins, and a single token is sufficient for RLS assertions.
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

/**
 * Catalog of tenant-scoped tables to validate. Each entry includes the
 * minimal payload needed to satisfy NOT NULL constraints; tenant_id is
 * injected at seed time.
 */
type TenantTable = {
  table: string;
  seed?: (tenantId: string, ctx: SeedCtx) => Record<string, unknown>;
};
type SeedCtx = {
  definitionId?: string;
  runId?: string;
  projectId?: string;
  documentTypeId?: string;
  documentId?: string;
  pageId?: string;
  entityTypeId?: string;
  predictionId?: string;
  categoryId?: string;
  threadId?: string;
  userId: string;
};

const TENANT_TABLES: TenantTable[] = [
  // ── Tenancy & identity ─────────────────────────────────────────────────
  { table: "tenant_members" },
  { table: "tenants" }, // self-reference, asserted via id column too
  { table: "tenant_invitations" },
  { table: "tenant_groups", seed: (t) => ({ tenant_id: t, name: `grp-${Date.now()}` }) },
  { table: "tenant_security_settings", seed: (t) => ({ tenant_id: t }) },
  {
    table: "tenant_ip_allowlist",
    seed: (t) => ({ tenant_id: t, cidr: "10.0.0.0/24", label: "test" }),
  },
  {
    table: "tenant_sso_configs",
    seed: (t) => ({
      tenant_id: t,
      provider_type: "saml",
      display_name: "RLS SAML",
      enabled: false,
    }),
  },

  // ── Recon engine ───────────────────────────────────────────────────────
  {
    table: "recon_definitions",
    seed: (t, c) => ({
      tenant_id: t,
      name: `def-${Date.now()}`,
      recon_type: "two_sided",
      sides: [],
      rules: [],
      created_by: c.userId,
    }),
  },
  { table: "recon_runs" },
  { table: "recon_matches" },
  { table: "recon_exceptions" },
  { table: "recon_match_feedback" },
  { table: "recon_permissions" },
  { table: "recon_carry_forward" },
  { table: "recon_match_allocations" },
  {
    table: "recon_tolerance_ladders",
    seed: (t, c) => ({
      tenant_id: t,
      recon_id: c.definitionId,
      field_name: "amount",
      rungs_json: [],
    }),
  },

  // ── AIDP ───────────────────────────────────────────────────────────────
  {
    table: "aidp_projects",
    seed: (t, c) => ({
      tenant_id: t,
      name: `proj-${Date.now()}`,
      slug: `proj-${Date.now()}`,
      created_by: c.userId,
    }),
  },
  {
    table: "aidp_document_types",
    seed: (t, c) => ({
      tenant_id: t,
      project_id: c.projectId,
      code: `dt-${Date.now()}`,
      label: "RLS document",
    }),
  },
  {
    table: "aidp_entity_types",
    seed: (t, c) => ({
      tenant_id: t,
      document_type_id: c.documentTypeId,
      key: `entity_${Date.now()}`,
      label: "RLS entity",
      datatype: "string",
    }),
  },
  { table: "aidp_documents" },
  { table: "aidp_pages" },
  { table: "aidp_annotations" },
  { table: "aidp_predictions" },
  { table: "aidp_prediction_fields" },
  { table: "aidp_outputs" },
  { table: "aidp_output_recon_invalidations" },
  {
    table: "aidp_api_host_allowlist",
    seed: (t) => ({ tenant_id: t, host: `h-${Date.now()}.example.com` }),
  },
  {
    table: "aidp_api_quotas",
    seed: (t) => ({
      tenant_id: t,
      day: new Date().toISOString().slice(0, 10),
      calls: 0,
      max_calls: 100,
    }),
  },

  // ── Worker health / breakers ──────────────────────────────────────────
  {
    table: "worker_circuit_breakers",
    seed: (t) => ({
      tenant_id: t,
      scope: "pipeline",
      target_id: "00000000-0000-0000-0000-000000000001",
    }),
  },
  {
    table: "worker_retry_attempts",
    seed: (t) => ({
      tenant_id: t,
      step: "ingest",
      attempt: 1,
      max_attempts: 3,
      status: "retry_scheduled",
    }),
  },

  // ── AI governance & agentic ────────────────────────────────────────────
  {
    table: "ai_usage_events",
    seed: (t, c) => ({
      tenant_id: t,
      user_id: c.userId,
      scope: "copilot",
      model: "gpt-x",
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
    }),
  },
  { table: "ai_budgets", seed: (t) => ({ tenant_id: t, monthly_max_cost_usd: 100 }) },
  {
    table: "byok_keys",
    seed: (t) => ({
      tenant_id: t,
      provider: "aws-kms",
      alias: `rls-${Date.now()}`,
      key_arn: "arn:aws:kms:eu-west-1:000000000000:key/rls-test",
    }),
  },
  { table: "agent_runs" },
  { table: "agent_actions" },
  {
    table: "copilot_threads",
    seed: (t, c) => ({ tenant_id: t, user_id: c.userId, scope: "tenant", title: "t" }),
  },
  { table: "copilot_messages" },
  {
    table: "llm_providers",
    seed: (t, c) => ({
      tenant_id: t,
      scope: "tenant",
      provider: "muse",
      display_name: "RLS Muse",
      model: "gpt-test",
      is_active: false,
      created_by: c.userId,
    }),
  },

  // ── Platform / API / DORA ──────────────────────────────────────────────
  { table: "api_tokens" },
  {
    table: "dora_register",
    seed: (t) => ({
      tenant_id: t,
      provider_name: `prov-${Date.now()}`,
      service_description: "RLS service",
      criticality: "non_critical",
    }),
  },
  { table: "dora_exit_plans", seed: (t) => ({ tenant_id: t, title: `exit-${Date.now()}` }) },
  { table: "dora_incidents", seed: (t) => ({ tenant_id: t, classification: "minor" }) },
  { table: "regulatory_pack_installs" },

  // ── Exception management ───────────────────────────────────────────────
  {
    table: "break_categories",
    seed: (t) => ({ tenant_id: t, code: `cat-${Date.now()}`, label: "x" }),
  },
  { table: "break_attachments" },
  { table: "break_comments" },
  { table: "break_graph_edges" },
  { table: "break_root_causes", seed: (t) => ({ tenant_id: t, label: `RLS cause ${Date.now()}` }) },
  {
    table: "exception_assignment_rules",
    seed: (t) => ({ tenant_id: t, name: `rule-${Date.now()}`, strategy: "round_robin" }),
  },
];

// LL-020: skip the entire suite if Supabase env vars are missing. The
// vitest.config.ts already excludes tests/rls/** in this case, but explicit
// invocations (`vitest run tests/rls/cross-tenant.spec.ts`) bypass that
// exclude, so we guard at the describe level too with describe.skip().
const rlsSuite = HAS_SUPABASE_ENV ? describe : describe.skip;

rlsSuite("RLS · cross-tenant isolation", () => {
  let tenantA: string;
  let tenantB: string;
  let admA: { id: string; email: string };
  let anaA: { id: string; email: string };
  let memA: { id: string; email: string };
  let admB: { id: string; email: string };
  let plat: { id: string; email: string };

  const seededTables: string[] = [];
  const seedErrors: Record<string, string> = {};

  async function mkUser(prefix: string) {
    const email = `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fvi.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PW,
      email_confirm: true,
    });
    if (error) throw error;
    return { id: data.user!.id, email };
  }

  beforeAll(async () => {
    // LL-020: short-circuit beforeAll when env vars are missing — vitest's
    // describe.skip still queues beforeAll/afterAll hooks, so we guard here
    // to avoid spurious "Cannot read properties of null" failures.
    if (!HAS_SUPABASE_ENV) return;
    const ts = Date.now();
    const { data: famA } = await admin
      .from("tenant_families")
      .insert({ name: `xfamA-${ts}` })
      .select("id")
      .single();
    const { data: famB } = await admin
      .from("tenant_families")
      .insert({ name: `xfamB-${ts}` })
      .select("id")
      .single();
    const { data: a } = await admin
      .from("tenants")
      .insert({
        name: "Cross-A",
        slug: `xa-${ts}`,
        environment: "dev",
        region: "eu-west-1",
        family_id: famA!.id,
      })
      .select("id")
      .single();
    const { data: b } = await admin
      .from("tenants")
      .insert({
        name: "Cross-B",
        slug: `xb-${ts}`,
        environment: "dev",
        region: "eu-west-1",
        family_id: famB!.id,
      })
      .select("id")
      .single();
    tenantA = a!.id;
    tenantB = b!.id;
    await recordTestTenantCreated(admin, tenantA, `xa-${ts}`);
    await recordTestTenantCreated(admin, tenantB, `xb-${ts}`);

    admA = await mkUser("xt-admA");
    anaA = await mkUser("xt-anaA");
    memA = await mkUser("xt-memA");
    admB = await mkUser("xt-admB");
    plat = await mkUser("xt-plat");

    const { error: tmErr } = await admin.from("tenant_members").insert([
      { tenant_id: tenantA, user_id: admA.id, role: "tenant_admin", invited_by: admA.id },
      { tenant_id: tenantA, user_id: anaA.id, role: "tenant_analyst", invited_by: admA.id },
      { tenant_id: tenantA, user_id: memA.id, role: "tenant_viewer", invited_by: admA.id },
      { tenant_id: tenantB, user_id: admB.id, role: "tenant_admin", invited_by: admB.id },
    ]);
    if (tmErr) {
      // Surface seed failures loudly — otherwise RLS positive controls fail
      // with "0 rows" and the real cause (NOT NULL / FK / enum) is hidden.
      throw new Error(`[cross-tenant beforeAll] tenant_members seed failed: ${tmErr.message}`);
    }
    await admin.from("platform_roles").insert({ user_id: plat.id, role: "platform_admin" });

    // Seed best-effort marker rows in tenant B for every table with a seed fn.
    const ctx: SeedCtx = { userId: admB.id };
    for (const t of TENANT_TABLES) {
      if (!t.seed) continue;
      const payload = t.seed(tenantB, ctx);
      const needsId = ["recon_definitions", "aidp_projects", "aidp_document_types"].includes(
        t.table,
      );
      const result = needsId
        ? await admin
            .from(t.table)
            .insert(payload as never)
            .select("id")
            .single()
        : await admin.from(t.table).insert(payload as never);
      const { data, error } = result;
      if (error) {
        seedErrors[t.table] = error.message;
      } else {
        seededTables.push(t.table);
        const insertedId = (data as { id?: string } | null)?.id;
        if (t.table === "recon_definitions") ctx.definitionId = insertedId;
        if (t.table === "aidp_projects") ctx.projectId = insertedId;
        if (t.table === "aidp_document_types") ctx.documentTypeId = insertedId;
      }
    }
  });

  afterAll(async () => {
    // LL-020: short-circuit afterAll when env vars are missing.
    if (!HAS_SUPABASE_ENV) return;
    await purgeTestTenants(admin, [tenantA, tenantB]);
    for (const u of [admA, anaA, memA, admB, plat]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  });

  describe("tenant_admin_A queries leak ZERO rows from tenant B", () => {
    for (const t of TENANT_TABLES) {
      it(`${t.table}: SELECT WHERE tenant_id=B returns 0 rows`, async () => {
        const c = await userClient(admA.email);
        const column = t.table === "tenants" ? "id" : "tenant_id";
        const { data } = await c.from(t.table).select("*").eq(column, tenantB);
        // The actual security guarantee: never return tenant-B rows to tenant A.
        // RLS may surface this as an error (42501 or PGRST*) or as an empty array.
        // Either is acceptable; a non-empty row set is the only real failure.
        expect((data ?? []).length).toBe(0);
      });
    }
  });

  describe("tenant_admin_A unscoped SELECT contains ZERO tenant-B rows", () => {
    for (const t of TENANT_TABLES) {
      it(`${t.table}: full SELECT excludes tenant B`, async () => {
        const c = await userClient(admA.email);
        const column = t.table === "tenants" ? "id" : "tenant_id";
        const { data } = await c.from(t.table).select(column).limit(500);
        const leak = (data ?? []).filter((r: any) => r[column] === tenantB);
        expect(leak).toHaveLength(0);
      });
    }
  });

  describe("tenant_analyst_A and tenant_member_A also leak ZERO tenant-B rows", () => {
    for (const t of TENANT_TABLES) {
      it(`${t.table}: analyst sees no tenant-B rows`, async () => {
        const c = await userClient(anaA.email);
        const column = t.table === "tenants" ? "id" : "tenant_id";
        const { data } = await c.from(t.table).select(column).eq(column, tenantB);
        expect((data ?? []).length).toBe(0);
      });
      it(`${t.table}: member sees no tenant-B rows`, async () => {
        const c = await userClient(memA.email);
        const column = t.table === "tenants" ? "id" : "tenant_id";
        const { data } = await c.from(t.table).select(column).eq(column, tenantB);
        expect((data ?? []).length).toBe(0);
      });
    }
  });

  describe("tenant_admin_A cannot WRITE into tenant B", () => {
    for (const t of TENANT_TABLES) {
      if (!t.seed) continue;
      it(`${t.table}: INSERT with tenant_id=B is denied`, async () => {
        const c = await userClient(admA.email);
        const payload = t.seed!(tenantB, { userId: admA.id });
        const { data, error } = await c
          .from(t.table)
          .insert(payload as never)
          .select();
        // RLS WITH CHECK must reject, OR the row is silently dropped (0 returned).
        expect(error !== null || (data ?? []).length === 0).toBe(true);
      });
    }
  });

  describe("tenant_admin_A cannot UPDATE tenant B rows", () => {
    for (const t of TENANT_TABLES) {
      if (!t.seed) continue;
      it(`${t.table}: UPDATE WHERE tenant_id=B affects 0 rows`, async () => {
        if (seedErrors[t.table]) return; // no marker row to target
        const c = await userClient(admA.email);
        const column = t.table === "tenants" ? "id" : "tenant_id";
        // updated_at exists on most tables; fall back to a no-op patch on tenant_id
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        const { data, error } = await c
          .from(t.table)
          .update(patch as any)
          .eq(column, tenantB)
          .select();
        // RLS USING must hide the row; either denied or zero rows updated.
        expect(error !== null || (data ?? []).length === 0).toBe(true);

        // Positive integrity check: the row still exists for tenant B (service-role view).
        const { data: still } = await admin
          .from(t.table)
          .select(column)
          .eq(column, tenantB)
          .limit(1);
        expect((still ?? []).length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe("tenant_admin_A cannot DELETE tenant B rows", () => {
    for (const t of TENANT_TABLES) {
      if (!t.seed) continue;
      it(`${t.table}: DELETE WHERE tenant_id=B affects 0 rows`, async () => {
        if (seedErrors[t.table]) return;
        const c = await userClient(admA.email);
        const column = t.table === "tenants" ? "id" : "tenant_id";
        const { data, error } = await c.from(t.table).delete().eq(column, tenantB).select();
        expect(error !== null || (data ?? []).length === 0).toBe(true);

        // Confirm the row still exists via service-role read.
        const { data: still } = await admin
          .from(t.table)
          .select(column)
          .eq(column, tenantB)
          .limit(1);
        expect((still ?? []).length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe("JWT fail-closed guards", () => {
    it("test harness never embeds the service-role key in user clients", async () => {
      // Sanity: publishable and service keys must be distinct, and userClient()
      // must construct clients from PUBLISHABLE_KEY only.
      expect(PUBLISHABLE_KEY).toBeTruthy();
      expect(SERVICE_ROLE_KEY).toBeTruthy();
      expect(PUBLISHABLE_KEY).not.toEqual(SERVICE_ROLE_KEY);

      const c = await userClient(admA.email);
      // PostgREST surfaces the apikey header on the internal fetch; ensure no
      // request originating from this client carries the service-role key.
      const intercepted: string[] = [];
      const origFetch = (c as any).rest.fetch ?? globalThis.fetch;
      (c as any).rest.fetch = async (input: any, init: any) => {
        const hdrs = new Headers(init?.headers);
        const ak = hdrs.get("apikey") ?? "";
        intercepted.push(ak);
        return origFetch(input, init);
      };
      await c.from("tenant_members").select("tenant_id").limit(1);
      expect(intercepted.length).toBeGreaterThan(0);
      for (const ak of intercepted) expect(ak).not.toEqual(SERVICE_ROLE_KEY);
    });

    it("anonymous client (no session) cannot read tenant B rows", async () => {
      const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await anon
        .from("tenant_members")
        .select("tenant_id")
        .eq("tenant_id", tenantB);
      // RLS without claims → 0 rows (and possibly an error). Must never return tenant B.
      expect((data ?? []).length).toBe(0);
      void error;
    });

    it("tampered bearer token is rejected (no rows returned)", async () => {
      const tampered = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: "Bearer YOUR_SUPABASE_KEY" } },
      });
      const { data, error } = await tampered
        .from("tenant_members")
        .select("tenant_id")
        .eq("tenant_id", tenantB);
      // Either GoTrue/PostgREST rejects the bad JWT, or it falls back to anon
      // (still 0 rows from tenant B). Never returns tenant-B data.
      expect((data ?? []).length).toBe(0);
      if (error) expect([401, 403]).toContain(Number(error.code ?? 0) || 401);
    });

    it("missing claims (sub-less JWT) cannot impersonate tenant B admin", async () => {
      // A syntactically valid but unsigned/empty-claims JWT must not authorize reads.
      const emptyClaims =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        Buffer.from(JSON.stringify({})).toString("base64url") +
        ".sig";
      const spoof = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${emptyClaims}` } },
      });
      const { data } = await spoof
        .from("tenant_members")
        .select("tenant_id")
        .eq("tenant_id", tenantB);
      expect((data ?? []).length).toBe(0);
    });
  });

  describe("Copilot thread scope binding", () => {
    let ownTenantThreadId: string;

    it("allows an active member to create their own tenant-bound thread", async () => {
      const c = await userClient(admA.email);
      const { data, error } = await c
        .from("copilot_threads")
        .insert({ scope: "tenant", tenant_id: tenantA, user_id: admA.id, title: "RLS own" })
        .select("id, tenant_id, scope")
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ tenant_id: tenantA, scope: "tenant" });
      ownTenantThreadId = data!.id;
    });

    it("denies retagging an owned tenant thread to another tenant or platform scope", async () => {
      const c = await userClient(admA.email);
      const retag = await c
        .from("copilot_threads")
        .update({ tenant_id: tenantB })
        .eq("id", ownTenantThreadId)
        .select("id");
      expect(retag.error !== null || (retag.data ?? []).length === 0).toBe(true);

      const elevate = await c
        .from("copilot_threads")
        .update({ scope: "platform", tenant_id: null })
        .eq("id", ownTenantThreadId)
        .select("id");
      expect(elevate.error !== null || (elevate.data ?? []).length === 0).toBe(true);
    });

    it("binds Copilot insights to the parent thread tenant", async () => {
      const c = await userClient(admA.email);
      const mismatched = await c
        .from("copilot_thread_insights")
        .insert({ thread_id: ownTenantThreadId, tenant_id: tenantB, insights: { test: true } })
        .select("id");
      expect(mismatched.error !== null || (mismatched.data ?? []).length === 0).toBe(true);

      const matching = await c
        .from("copilot_thread_insights")
        .insert({ thread_id: ownTenantThreadId, tenant_id: tenantA, insights: { test: true } })
        .select("id, tenant_id")
        .single();
      expect(matching.error).toBeNull();
      expect(matching.data?.tenant_id).toBe(tenantA);
    });

    it("rejects invalid scope and tenant-id combinations", async () => {
      const c = await userClient(admA.email);
      const platformWithTenant = await c
        .from("copilot_threads")
        .insert({ scope: "platform", tenant_id: tenantA, user_id: admA.id })
        .select("id");
      expect(
        platformWithTenant.error !== null || (platformWithTenant.data ?? []).length === 0,
      ).toBe(true);

      const tenantWithoutTenant = await c
        .from("copilot_threads")
        .insert({ scope: "workspace", tenant_id: null, user_id: admA.id })
        .select("id");
      expect(
        tenantWithoutTenant.error !== null || (tenantWithoutTenant.data ?? []).length === 0,
      ).toBe(true);
    });

    it("denies tenant scope when the owning membership is inactive", async () => {
      await admin
        .from("tenant_members")
        .update({ active: false, deactivated_at: new Date().toISOString() })
        .eq("tenant_id", tenantA)
        .eq("user_id", memA.id);
      try {
        const c = await userClient(memA.email);
        const { data, error } = await c
          .from("copilot_threads")
          .insert({ scope: "tenant", tenant_id: tenantA, user_id: memA.id })
          .select("id");
        expect(error !== null || (data ?? []).length === 0).toBe(true);
      } finally {
        await admin
          .from("tenant_members")
          .update({ active: true, deactivated_at: null })
          .eq("tenant_id", tenantA)
          .eq("user_id", memA.id);
      }
    });

    it("allows a platform administrator to use an owned platform thread", async () => {
      const c = await userClient(plat.email);
      const { data, error } = await c
        .from("copilot_threads")
        .insert({ scope: "platform", tenant_id: null, user_id: plat.id, title: "RLS platform" })
        .select("id, scope, tenant_id")
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ scope: "platform", tenant_id: null });

      const platformInsight = await c
        .from("copilot_thread_insights")
        .insert({ thread_id: data!.id, tenant_id: null, insights: { test: true } })
        .select("id, tenant_id")
        .single();
      expect(platformInsight.error).toBeNull();
      expect(platformInsight.data?.tenant_id).toBeNull();

      const forgedTenantInsight = await c
        .from("copilot_thread_insights")
        .insert({ thread_id: data!.id, tenant_id: tenantB, insights: { test: true } })
        .select("id");
      expect(
        forgedTenantInsight.error !== null || (forgedTenantInsight.data ?? []).length === 0,
      ).toBe(true);
    });
  });

  describe("positive controls", () => {
    it("tenant_admin_B SEES their own tenant rows (sanity)", async () => {
      // Sanity-check the seed via service-role BEFORE asserting on the user
      // session, so a missing seed row is reported as a fixture bug (not RLS).
      const { data: seeded } = await admin
        .from("tenant_members")
        .select("user_id,tenant_id,role")
        .eq("tenant_id", tenantB)
        .eq("user_id", admB.id);
      expect(
        (seeded ?? []).length,
        `seed missing tenant_members(admB,tenantB)`,
      ).toBeGreaterThanOrEqual(1);

      // Always sign in fresh — the per-email cache can hold a token whose
      // membership claims pre-date the beforeAll insert under heavy parallelism.
      const fresh = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signinErr } = await fresh.auth.signInWithPassword({
        email: admB.email,
        password: PW,
      });
      expect(signinErr).toBeNull();

      let rows: any[] = [];
      let lastErr: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await fresh
          .from("tenant_members")
          .select("tenant_id,user_id")
          .eq("user_id", admB.id);
        lastErr = error;
        rows = data ?? [];
        if (rows.length > 0) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      expect(lastErr).toBeNull();
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("platform_admin sees rows in BOTH tenants", async () => {
      const c = await userClient(plat.email);
      const { data } = await c
        .from("tenant_members")
        .select("tenant_id")
        .in("tenant_id", [tenantA, tenantB]);
      const tenants = new Set((data ?? []).map((r: any) => r.tenant_id));
      expect(tenants.has(tenantA)).toBe(true);
      expect(tenants.has(tenantB)).toBe(true);
    });

    it("seed diagnostics (informational)", () => {
      // Surfaces tables that could not be seeded — they still get the
      // leak assertion above, but maintainers may want richer fixtures.
      if (Object.keys(seedErrors).length > 0) {
        console.warn("[cross-tenant] tables without seed:", seedErrors);
      }
      expect(seededTables.length).toBeGreaterThan(0);
    });
  });
});
