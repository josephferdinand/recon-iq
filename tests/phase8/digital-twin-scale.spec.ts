/**
 * Phase 8 — Digital Twin scale / e2e.
 *
 * Seeds a large graph (1,500 nodes + ~1,500 edges across mixed statuses/types)
 * into an ephemeral tenant via the service-role client, then exercises the
 * user-facing surfaces end-to-end using an authenticated Supabase session
 * that mirrors what `listTwinNodes` / `getTwinStats` execute server-side:
 *
 *   - Pagination:  RLS-scoped `.range()` returns stable, non-overlapping
 *                  pages and a correct `count: 'exact'` total.
 *   - Filtering:   node_type + status + search each narrow the count.
 *   - Aggregation: `get_digital_twin_stats` RPC totals match the seed and
 *                  break down by status + type.
 *   - Perf tiles:  each surface (page fetch, filtered fetch, stats RPC)
 *                  returns within an SLA budget; test records the wall time
 *                  so regressions are visible in CI output.
 *
 * Skipped when Supabase test env vars are absent.
 */
// @ts-nocheck — requires live Supabase env vars.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  purgeTestTenants,
  recordTestTenantCreated,
} from "../helpers/tenant-teardown";

const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ENABLED = SUPABASE_URL && PUBLISHABLE_KEY && SERVICE_ROLE_KEY;
const d = ENABLED ? describe : describe.skip;

const PW = "Test!12345";
const admin = ENABLED
  ? createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  : null;

// Seed shape: 1,500 nodes across 5 types with a fixed status mix so the
// aggregation assertions are deterministic.
const NODE_TYPES = ["source", "cutoff", "sla", "control", "workflow"] as const;
const STATUSES = ["ok", "warning", "breached", "unknown"] as const;
// 300 per type × 5 types = 1500 nodes. Status mix per 300: 210 ok / 45 warn / 30 breached / 15 unknown.
const PER_TYPE = 300;
const TOTAL_NODES = PER_TYPE * NODE_TYPES.length; // 1500
const MIX = { ok: 210, warning: 45, breached: 30, unknown: 15 };
const EXPECTED_OK = MIX.ok * NODE_TYPES.length;
const EXPECTED_WARN = MIX.warning * NODE_TYPES.length;
const EXPECTED_BREACH = MIX.breached * NODE_TYPES.length;
const EXPECTED_UNKNOWN = MIX.unknown * NODE_TYPES.length;

async function seedTenant() {
  const slug = `twin-scale-${Date.now()}`;
  const { data: t, error } = await admin!
    .from("tenants")
    .insert({ name: "twin-scale", slug, environment: "dev", region: "eu-west-1" })
    .select("id")
    .single();
  if (error) throw error;
  await recordTestTenantCreated(admin!, t.id, slug);
  return t.id as string;
}

async function seedUser(tenantId: string) {
  const email = `twin-scale-${crypto.randomUUID()}@fvi.test`;
  const { data: u, error } = await admin!.auth.admin.createUser({
    email, password: PW, email_confirm: true,
  });
  if (error) throw error;
  await admin!.from("tenant_members").insert({
    tenant_id: tenantId, user_id: u.user!.id, role: "tenant_admin",
  });
  // twin_view / twin_admin permissions map to tenant_admin in phase-c-rbac.
  return { id: u.user!.id, email };
}

async function signIn(email: string) {
  const sb = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return sb;
}

function buildNodes(tenantId: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (const node_type of NODE_TYPES) {
    let i = 0;
    const emit = (count: number, status: (typeof STATUSES)[number]) => {
      for (let k = 0; k < count; k++, i++) {
        rows.push({
          tenant_id: tenantId,
          node_type,
          node_key: `${node_type}-${String(i).padStart(4, "0")}`,
          label: `${node_type.toUpperCase()} node ${i}`,
          status,
          attributes: { seed: true, batch: Math.floor(i / 50) },
        });
      }
    };
    emit(MIX.ok, "ok");
    emit(MIX.warning, "warning");
    emit(MIX.breached, "breached");
    emit(MIX.unknown, "unknown");
  }
  return rows;
}

d("Digital Twin — large-dataset pagination, aggregation, perf", () => {
  let tenantId: string;
  let user: { id: string; email: string };
  let nodeIdsByType: Record<string, string[]> = {};

  beforeAll(async () => {
    tenantId = await seedTenant();
    user = await seedUser(tenantId);

    // Bulk insert nodes in chunks to stay under statement/timeout limits.
    const nodes = buildNodes(tenantId);
    const CHUNK = 500;
    for (let i = 0; i < nodes.length; i += CHUNK) {
      const { error } = await admin!.from("digital_twin_nodes").insert(nodes.slice(i, i + CHUNK));
      if (error) throw new Error(`seed nodes ${i}: ${error.message}`);
    }

    // Fetch ids grouped by node_type so we can build edges.
    const { data: idRows, error: idErr } = await admin!
      .from("digital_twin_nodes")
      .select("id, node_type")
      .eq("tenant_id", tenantId)
      .limit(TOTAL_NODES + 10);
    if (idErr) throw idErr;
    nodeIdsByType = {};
    for (const r of idRows ?? []) {
      (nodeIdsByType[r.node_type] ??= []).push(r.id as string);
    }

    // Wire ~1,500 edges: each `source` node → matching `cutoff` → `sla` → `control` → `workflow`.
    // The graph is a 5-layer bipartite chain, giving 4 × PER_TYPE = 1,200 edges of
    // rel="feeds" plus 300 self-cutoff edges rel="anchors" = 1,500 total.
    const edges: Array<Record<string, unknown>> = [];
    const layers = ["source", "cutoff", "sla", "control", "workflow"] as const;
    for (let li = 0; li < layers.length - 1; li++) {
      const from = nodeIdsByType[layers[li]] ?? [];
      const to = nodeIdsByType[layers[li + 1]] ?? [];
      for (let k = 0; k < PER_TYPE; k++) {
        edges.push({
          tenant_id: tenantId,
          src_node_id: from[k],
          dst_node_id: to[k],
          rel: "feeds",
          weight: 1,
          attributes: {},
        });
      }
    }
    for (let k = 0; k < PER_TYPE; k++) {
      const cutoffs = nodeIdsByType["cutoff"] ?? [];
      const sources = nodeIdsByType["source"] ?? [];
      edges.push({
        tenant_id: tenantId,
        src_node_id: cutoffs[k],
        dst_node_id: sources[k],
        rel: "anchors",
        weight: 1,
        attributes: {},
      });
    }
    for (let i = 0; i < edges.length; i += 500) {
      const { error } = await admin!.from("digital_twin_edges").insert(edges.slice(i, i + 500));
      if (error) throw new Error(`seed edges ${i}: ${error.message}`);
    }
  }, 120_000);

  afterAll(async () => {
    await purgeTestTenants(admin!, [tenantId]);
  });

  it("Pagination: exact count matches seed and pages are non-overlapping", async () => {
    const sb = await signIn(user.email);
    const PAGE = 250;
    const seenIds = new Set<string>();
    let total = 0;
    const started = Date.now();

    for (let offset = 0; offset < TOTAL_NODES; offset += PAGE) {
      const from = offset;
      const to = offset + PAGE - 1;
      const { data, count, error } = await sb
        .from("digital_twin_nodes")
        .select("id, node_type, node_key, status", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("node_type")
        .order("node_key")
        .range(from, to);
      expect(error).toBeNull();
      expect(count).toBe(TOTAL_NODES);
      for (const r of data ?? []) {
        expect(seenIds.has(r.id as string)).toBe(false);
        seenIds.add(r.id as string);
      }
      total += data?.length ?? 0;
    }
    const elapsed = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log(`[digital-twin-scale] paginated ${total} rows in ${elapsed}ms`);
    expect(total).toBe(TOTAL_NODES);
    expect(seenIds.size).toBe(TOTAL_NODES);
    // Budget: 6 pages × ≤400ms each on a warm DB.
    expect(elapsed).toBeLessThan(6000);
  }, 60_000);

  it("Filtering: node_type + status + search narrow the count correctly", async () => {
    const sb = await signIn(user.email);

    const { count: typeCount, error: e1 } = await sb
      .from("digital_twin_nodes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("node_type", "source");
    expect(e1).toBeNull();
    expect(typeCount).toBe(PER_TYPE);

    const { count: breachedCount, error: e2 } = await sb
      .from("digital_twin_nodes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "breached");
    expect(e2).toBeNull();
    expect(breachedCount).toBe(EXPECTED_BREACH);

    const { count: searchCount, error: e3 } = await sb
      .from("digital_twin_nodes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .ilike("node_key", "sla-00%");
    expect(e3).toBeNull();
    // sla-0000 .. sla-0099 = 100 rows.
    expect(searchCount).toBe(100);
  });

  it("Aggregation: get_digital_twin_stats totals match seed", async () => {
    const sb = await signIn(user.email);
    const started = Date.now();
    const { data, error } = await sb.rpc("get_digital_twin_stats", { _tenant_id: tenantId });
    const elapsed = Date.now() - started;
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(Number(row.total_nodes)).toBe(TOTAL_NODES);
    expect(Number(row.total_edges)).toBe((NODE_TYPES.length - 1) * PER_TYPE + PER_TYPE);
    expect(Number(row.ok_count)).toBe(EXPECTED_OK);
    expect(Number(row.warning_count)).toBe(EXPECTED_WARN);
    expect(Number(row.breached_count)).toBe(EXPECTED_BREACH);
    expect(Number(row.unknown_count)).toBe(EXPECTED_UNKNOWN);
    const types = (row.types_json ?? {}) as Record<string, number>;
    for (const t of NODE_TYPES) expect(Number(types[t])).toBe(PER_TYPE);
    // eslint-disable-next-line no-console
    console.log(`[digital-twin-scale] stats RPC ${elapsed}ms`);
    // Perf tile SLA: stats RPC should finish well under 1500ms on the seeded graph.
    expect(elapsed).toBeLessThan(1500);
  });

  it("Perf tile: first-page fetch under budget", async () => {
    const sb = await signIn(user.email);
    const started = Date.now();
    const { data, count, error } = await sb
      .from("digital_twin_nodes")
      .select("id, node_type, node_key, label, status, updated_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("node_type")
      .order("node_key")
      .range(0, 299);
    const elapsed = Date.now() - started;
    expect(error).toBeNull();
    expect(data?.length).toBe(300);
    expect(count).toBe(TOTAL_NODES);
    // eslint-disable-next-line no-console
    console.log(`[digital-twin-scale] first page ${elapsed}ms`);
    expect(elapsed).toBeLessThan(1500);
  });

  it("Isolation guard: get_digital_twin_stats returns zeros for a foreign tenant", async () => {
    const sb = await signIn(user.email);
    // Random UUID the user is not a member of — RLS filters everything out.
    const foreign = "00000000-0000-0000-0000-000000000000";
    const { data, error } = await sb.rpc("get_digital_twin_stats", { _tenant_id: foreign });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    // With RLS applied, a caller who is not a member sees 0 nodes / 0 edges.
    expect(Number(row?.total_nodes ?? 0)).toBe(0);
    expect(Number(row?.total_edges ?? 0)).toBe(0);
  });
});
