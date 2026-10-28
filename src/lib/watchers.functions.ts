import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { parseWatcherConfig, WATCHER_TYPES } from "@/lib/watcher-engine";

async function assertWriter(ctx: any, tenantId: string) {
  const { data: a } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
    _role: "tenant_admin",
  });
  const { data: b } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
    _role: "tenant_analyst",
  });
  if (!a && !b) throw new Error("Forbidden: analyst or admin required");
}

const UpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    tenant_id: z.string().uuid(),
    data_source_id: z.string().uuid(),
    name: z.string().min(2).max(120),
    watch_type: z.enum(WATCHER_TYPES),
    config: z.record(z.string(), z.unknown()).default({}),
    severity: z.enum(["info", "warning", "critical"]).default("warning"),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    try {
      parseWatcherConfig(value.watch_type, value.config);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config"],
        message: error instanceof Error ? error.message : "Invalid watcher configuration",
      });
    }
  });

const WatcherListSchema = z.object({
  tenant_id: z.string().uuid(),
  page: z.number().int().min(0).max(100_000).default(0),
  page_size: z.number().int().min(10).max(100).default(25),
  search: z.string().max(100).default(""),
  public_id_search: z.string().trim().max(80).regex(/^[A-Za-z0-9-]*$/u, "Public ID search contains unsupported characters")
    .optional()
    .transform((value) => value || undefined),
  updated_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(isUtcDate, "Enter a valid UTC calendar date").optional(),
  updated_through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(isUtcDate, "Enter a valid UTC calendar date").optional(),
  watch_type: z.enum(WATCHER_TYPES).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  source_id: z.string().uuid().optional(),
  state: z.enum(["all", "ok", "alert", "unknown", "disabled"]).default("all"),
  sort: z.enum(["name_asc", "name_desc", "last_check_desc", "last_check_asc"]).default("name_asc"),
}).superRefine((value, context) => {
  if (value.updated_from && value.updated_through && value.updated_from > value.updated_through) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["updated_through"], message: "Through date must be on or after from date" });
  }
});

function isUtcDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function utcDayAfter(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export const listWatchersPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof WatcherListSchema>) => WatcherListSchema.parse(d))
  .handler(async ({ data, context }) => {
    const search = data.search.trim().replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 100);
    let sourceIds: string[] | undefined;
    if (search) {
      const { data: sources, error: sourceError, count: sourceCount } = await context.supabase
        .from("workspace_data_sources")
        .select("id", { count: "exact" })
        .eq("tenant_id", data.tenant_id)
        .ilike("name", `%${search}%`)
        .limit(500);
      if (sourceError) throw new Error("Watcher sources unavailable");
      if (typeof sourceCount !== "number") throw new Error("Watcher sources unavailable");
      if (sourceCount > 500) throw new Error("Too many sources match. Enter a more specific search or use the source filter.");
      sourceIds = (sources ?? []).map((source) => source.id);
    }

    let query = context.supabase
      .from("data_watchers")
      .select(
        "id, name, watch_type, config, severity, enabled, last_checked_at, last_state, last_alerted_at, data_source_id, data_source:workspace_data_sources(name)",
        { count: "exact" },
      )
      .eq("tenant_id", data.tenant_id);
    if (search) {
      const nameFilter = `name.ilike.%${search}%`;
      query = sourceIds?.length
        ? query.or(`${nameFilter},data_source_id.in.(${sourceIds.join(",")})`)
        : query.ilike("name", `%${search}%`);
    }
    if (data.public_id_search) query = (query as any).ilike("public_id", `%${data.public_id_search}%`);
    if (data.updated_from) query = query.gte("updated_at", `${data.updated_from}T00:00:00.000Z`);
    if (data.updated_through) query = query.lt("updated_at", utcDayAfter(data.updated_through));
    if (data.watch_type) query = query.eq("watch_type", data.watch_type);
    if (data.severity) query = query.eq("severity", data.severity);
    if (data.source_id) query = query.eq("data_source_id", data.source_id);
    if (data.state === "disabled") query = query.eq("enabled", false);
    if (data.state === "ok") query = query.eq("enabled", true).not("last_checked_at", "is", null).eq("last_state", "ok");
    if (data.state === "alert") query = query.eq("enabled", true).not("last_checked_at", "is", null).eq("last_state", "alert");
    if (data.state === "unknown") query = query.eq("enabled", true).or("last_checked_at.is.null,last_state.not.in.(ok,alert)");
    const descending = data.sort === "name_desc" || data.sort === "last_check_desc";
    const sortColumn = data.sort.startsWith("name") ? "name" : "last_checked_at";
    const { data: rows, error, count } = await query
      .order(sortColumn, { ascending: !descending, nullsFirst: false })
      .order("id", { ascending: true })
      .range(data.page * data.page_size, data.page * data.page_size + data.page_size - 1);
    if (error || typeof count !== "number") throw new Error("Watcher list is temporarily unavailable. Please try again.");
    const ids = (rows ?? []).map((watcher) => watcher.id);
    const latestEvent = new Map<string, { outcome_code: string; occurred_at: string }>();
    for (let start = 0; start < ids.length; start += 5) {
      const results = await Promise.all(ids.slice(start, start + 5).map(async (watcherId) => {
        const result = await context.supabase
          .from("data_watcher_events")
          .select("outcome_code,occurred_at")
          .eq("tenant_id", data.tenant_id)
          .eq("watcher_id", watcherId)
          .order("occurred_at", { ascending: false })
          .limit(1);
        return { watcherId, ...result };
      }));
      for (const result of results) {
        if (result.error) throw new Error("Watcher history is temporarily unavailable. Please try again.");
        if (result.data?.[0]) latestEvent.set(result.watcherId, result.data[0]);
      }
    }
    return {
      rows: (rows ?? []).map((watcher) => ({
        ...watcher,
        last_event: latestEvent.has(watcher.id) ? {
          outcome_code: latestEvent.get(watcher.id)!.outcome_code,
          occurred_at: latestEvent.get(watcher.id)!.occurred_at,
        } : null,
      })),
      total: count,
      page: data.page,
      page_size: data.page_size,
    };
  });

// Compatibility for the ingestion hub summary, which still consumes a flat list.
export const listWatchers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("data_watchers")
      .select("id, name, watch_type, config, severity, enabled, last_checked_at, last_state, last_alerted_at, data_source_id, data_source:workspace_data_sources(name)")
      .eq("tenant_id", data.tenant_id)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("Watcher list unavailable");
    const ids = (rows ?? []).map((watcher) => watcher.id);
    const events = ids.length ? await context.supabase
      .from("data_watcher_events")
      .select("watcher_id,outcome_code,detail,notification_created,occurred_at")
      .eq("tenant_id", data.tenant_id)
      .in("watcher_id", ids)
      .order("occurred_at", { ascending: false })
      .limit(1000) : { data: [], error: null };
    if (events.error) throw new Error("Watcher history unavailable");
    const latestEvent = new Map<string, NonNullable<typeof events.data>[number]>();
    for (const event of events.data ?? []) if (!latestEvent.has(event.watcher_id)) latestEvent.set(event.watcher_id, event);
    return (rows ?? []).map((watcher) => ({ ...watcher, last_event: latestEvent.get(watcher.id) ?? null }));
  });

export const upsertWatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof UpsertSchema>) => UpsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: source, error: sourceError } = await context.supabase
      .from("workspace_data_sources")
      .select("id")
      .eq("id", data.data_source_id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (sourceError) throw new Error("The source could not be verified. Please try again.");
    if (!source) throw new Error("This source is not available in the current workspace. Select an authorized source and try again.");
    const payload: any = { ...data };
    delete payload.id;
    if (data.id) {
      const { error } = await context.supabase
        .from("data_watchers")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", data.tenant_id);
      if (error) throw new Error(error.message);
      const { error: auditError } = await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId,
        tenant_id: data.tenant_id,
        scope: "workspace",
        action: "watcher.update",
        resource_type: "data_watcher",
        resource_id: data.id,
        context: { watch_type: data.watch_type, severity: data.severity, enabled: data.enabled },
      } as never);
      if (auditError) throw new Error("Watcher audit unavailable");
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("data_watchers")
      .insert({ ...payload, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { error: auditError } = await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "workspace",
      action: "watcher.create",
      resource_type: "data_watcher",
      resource_id: row.id,
      context: { watch_type: data.watch_type, severity: data.severity, enabled: data.enabled },
    } as never);
    if (auditError) throw new Error("Watcher audit unavailable");
    return { id: row.id };
  });

export const disableWatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { error } = await context.supabase
      .from("data_watchers")
      .update({ enabled: false })
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    const { error: auditError } = await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "workspace",
      action: "watcher.disable",
      resource_type: "data_watcher",
      resource_id: data.id,
      context: { retained_history: true },
    } as never);
    if (auditError) throw new Error("Watcher audit unavailable");
    return { ok: true };
  });

export const evaluateWatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { evaluateWatcherById } = await import("@/lib/watcher-evaluator.server");
    return evaluateWatcherById({
      admin: supabaseAdmin,
      tenantId: data.tenant_id,
      watcherId: data.id,
      actorUserId: context.userId,
      trigger: "browser",
    });
  });
