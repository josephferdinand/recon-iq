import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import Decimal from "decimal.js";

const tid = z.string().uuid();

// ===== Read-only ageing observation =====
export const AGEING_READ_LIMIT = 500;
export const AGEING_BUCKETS = ["0-1d", "2-5d", "6-15d", "16-30d", "30d+"] as const;
const Money = Decimal.clone({ precision: 160 });
type AgeingInputRow = { id: string; created_at: string; run_id?: string; lifecycle_state?: string; priority?: string; severity?: string; payload: unknown };

export function buildAgeingObservation(input: AgeingInputRow[], now = Date.now()) {
  const rows = input.slice(0, AGEING_READ_LIMIT).map((row) => {
    const timestamp = Date.parse(row.created_at);
    const age = Number.isFinite(timestamp) && timestamp <= now ? Math.floor((now - timestamp) / 86_400_000) : null;
    const bucket = age === null ? null : AGEING_BUCKETS[age <= 1 ? 0 : age <= 5 ? 1 : age <= 15 ? 2 : age <= 30 ? 3 : 4];
    const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {};
    const code = typeof payload.currency === "string" ? payload.currency.trim().toUpperCase() : "";
    const currency = /^[A-Z]{3}$/u.test(code) ? code : null;
    let amount: string | null = null;
    const raw = payload.amount;
    if ((typeof raw === "number" || typeof raw === "string") && String(raw).trim() && String(raw).length <= 128) {
      try {
        const value = new Money(raw);
        if (value.isFinite() && Math.abs(value.e) <= 100) amount = value.toFixed();
      } catch { /* Missing/malformed recorded amounts remain unknown. */ }
    }
    return { id: row.id, run_id: row.run_id, created_at: row.created_at, lifecycle_state: row.lifecycle_state,
      priority: row.priority, severity: row.severity, age_days: age, bucket, currency, amount };
  });
  const buckets = AGEING_BUCKETS.map((bucket) => {
    const members = rows.filter((row) => row.bucket === bucket);
    const currencies = [...new Set(members.flatMap((row) => row.currency ? [row.currency] : []))].sort();
    return { bucket, count: members.length, currencies: currencies.map((currency) => {
      const group = members.filter((row) => row.currency === currency);
      const known = group.filter((row) => row.amount !== null);
      const total = known.reduce((sum, row) => sum.plus(row.amount!), new Money(0));
      return { currency, amount: known.length ? total.toFixed() : null, known_amounts: known.length, missing_amounts: group.length - known.length };
    }), missing_currency: members.filter((row) => !row.currency).length };
  });
  return { observed_at: new Date(now).toISOString(), limit: AGEING_READ_LIMIT, has_more: input.length > AGEING_READ_LIMIT,
    count: rows.length, unknown_age: rows.filter((row) => row.age_days === null).length, buckets, rows };
}

// The old implementation deleted today's historical snapshots after an unchecked
// exception read. This operation now observes RLS-visible rows and never rewrites history.
export const computeAgeing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ tenant_id: tid, page: z.number().int().min(0).max(100000).default(0) }).parse(d))
  .handler(async ({ data, context }) => {
    // 100000/104000: _days limits trends, NOT the authorized open backlog.
    const { data: aggregate, error: aggregateError } = await context.supabase.rpc(
      "get_exception_dashboard" as never, { _tenant_id: data.tenant_id, _days: 30 } as never);
    if (aggregateError) throw new Error(aggregateError.code === "42501"
      ? "Forbidden: your access does not allow exception ageing."
      : "Exception ageing is temporarily unavailable. Please retry.");
    const totals = z.object({ as_of: z.string().datetime({ offset: true }),
      totals: z.object({ open: z.number().int().nonnegative() }),
      ageing: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })) }).parse(aggregate);
    if (totals.ageing.reduce((sum, bucket) => sum + bucket.count, 0) !== totals.totals.open)
      throw new Error("Exception ageing aggregate could not be verified. Please retry.");
    const offset = data.page * 50;
    const { data: open, error } = await context.supabase.from("recon_exceptions")
      .select("id,run_id,created_at,lifecycle_state,priority,severity,payload")
      .eq("tenant_id", data.tenant_id)
      .not("status", "in", "(resolved,wont_fix)")
      .not("lifecycle_state", "in", "(resolved,written_off)")
      .lte("created_at", totals.as_of)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + 50);
    if (error) throw new Error(error.code === "42501"
      ? "Forbidden: your access does not allow exception ageing."
      : "Exception details are temporarily unavailable. Please retry.");
    const detail = buildAgeingObservation((open ?? []).slice(0, 50), Date.parse(totals.as_of));
    return { observed_at: totals.as_of, total_open: totals.totals.open, buckets: totals.ageing,
      page: data.page, page_size: 50, has_more: (open?.length ?? 0) > 50, rows: detail.rows };
  });

export const listAgeing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ tenant_id: tid, days: z.number().int().default(30) }).parse(d))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.days * 86400000).toISOString().slice(0, 10);
    const { data: rows, error } = await context.supabase.from("exception_ageing_snapshots")
      .select("*").eq("tenant_id", data.tenant_id).gte("snapshot_date", since)
      .order("snapshot_date", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ===== EOD sign-off =====
export const listEodSignoffs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("eod_signoffs")
      .select("*").eq("tenant_id", data.tenant_id)
      .order("period_date", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const prepareEodSignoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({
    tenant_id: tid, period_date: z.string(), note: z.string().max(2000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: open } = await context.supabase.from("recon_exceptions")
      .select("id", { count: "exact", head: false }).eq("tenant_id", data.tenant_id).eq("status", "open");
    const metrics = { open_at_signoff: open?.length ?? 0 };
    const { data: row, error } = await context.supabase.from("eod_signoffs").upsert({
      tenant_id: data.tenant_id, period_date: data.period_date, scope: "tenant",
      status: "prepared", prepared_by: context.userId,
      prepared_at: new Date().toISOString(), metrics, note: data.note ?? null,
    } as any, { onConflict: "tenant_id,period_date,definition_id" }).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "eod.prepare", resource_type: "eod_signoffs", resource_id: row.id,
      context: { period: data.period_date, metrics },
    } as any);
    return row;
  });

export const approveEodSignoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ id: z.string().uuid(), tenant_id: tid, decision: z.enum(["approved","rejected"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase.from("eod_signoffs")
      .select("prepared_by").eq("id", data.id).single();
    if (existing?.prepared_by === context.userId)
      throw new Error("Preparer cannot approve their own EOD sign-off (4-eyes).");
    const { error } = await context.supabase.from("eod_signoffs").update({
      status: data.decision, approved_by: context.userId, approved_at: new Date().toISOString(),
    }).eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: `eod.${data.decision}`, resource_type: "eod_signoffs", resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });

// ===== Stop-a-run =====
export const requestStopRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({
    tenant_id: tid, run_id: z.string().uuid(), reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("run_kill_switches").insert({
      tenant_id: data.tenant_id, run_id: data.run_id, reason: data.reason ?? null,
      requested_by: context.userId,
    } as any).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("recon_runs").update({ status: "cancelled" })
      .eq("id", data.run_id).eq("tenant_id", data.tenant_id).in("status", ["queued","running"]);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "workspace",
      action: "run.stop", resource_type: "recon_runs", resource_id: data.run_id,
      context: { reason: data.reason ?? null },
    } as any);
    return row;
  });

// ===== Personalised home layout =====
export const getHomeLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("home_layouts")
      .select("layout").eq("user_id", context.userId).eq("tenant_id", data.tenant_id).maybeSingle();
    return row?.layout ?? [];
  });

export const saveHomeLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ tenant_id: tid, layout: z.array(z.any()) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("home_layouts").upsert({
      user_id: context.userId, tenant_id: data.tenant_id, layout: data.layout, updated_at: new Date().toISOString(),
    } as any, { onConflict: "user_id,tenant_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===== Status page =====
export const listStatusIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("status_incidents")
      .select("*").order("started_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertStatusIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({
    id: z.string().uuid().optional(),
    title: z.string().min(2).max(200),
    body: z.string().max(4000).optional(),
    severity: z.enum(["maintenance","minor","major","critical"]),
    status: z.enum(["investigating","identified","monitoring","resolved"]),
    component: z.string().max(100).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId, updated_at: new Date().toISOString() };
    if (data.status === "resolved") payload.resolved_at = new Date().toISOString();
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase.from("status_incidents")
      .upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

// ===== Status components admin =====
const COMP_STATE = ["operational","degraded_performance","partial_outage","major_outage","maintenance"] as const;

export const listStatusComponents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("status_components")
      .select("*").order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertStatusComponent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({
    id: z.string().uuid().optional(),
    key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional().nullable(),
    state: z.enum(COMP_STATE),
    group_name: z.string().max(80).optional().nullable(),
    display_order: z.number().int().min(0).max(9999).default(0),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const payload: any = { ...data };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase.from("status_components")
      .upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const setStatusComponentState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({
    id: z.string().uuid(),
    state: z.enum(COMP_STATE),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("status_components")
      .update({ state: data.state, updated_at: new Date().toISOString() }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteStatusComponent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("status_components").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===== Status subscribers admin =====
export const listStatusSubscribers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("status_subscribers")
      .select("id,email,confirmed_at,component_keys,created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteStatusSubscriber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("status_subscribers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
