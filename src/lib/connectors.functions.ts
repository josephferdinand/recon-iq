import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const CronRx = /^(\S+\s){4}\S+$/;
export const CONNECTOR_TYPES = [
  "sftp",
  "ftp",
  "s3",
  "azure_blob",
  "gcs",
  "bigquery",
  "snowflake",
  "databricks",
  "http",
  "https",
  "rest",
  "local",
  "network_drive",
  "manual",
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
export type ConnectorExecutionMode = "direct" | "manual" | "remote_gateway" | "agent_required";

export const CONNECTOR_EXECUTION_MODES: Readonly<Record<ConnectorType, ConnectorExecutionMode>> =
  Object.freeze({
    http: "direct",
    https: "direct",
    rest: "direct",
    manual: "manual",
    sftp: "agent_required",
    ftp: "agent_required",
    s3: "remote_gateway",
    azure_blob: "remote_gateway",
    gcs: "remote_gateway",
    bigquery: "remote_gateway",
    snowflake: "remote_gateway",
    databricks: "remote_gateway",
    local: "agent_required",
    network_drive: "agent_required",
  });

export function connectorExecutionMode(connectorType: string): ConnectorExecutionMode {
  return CONNECTOR_EXECUTION_MODES[connectorType as ConnectorType] ?? "agent_required";
}

type ScheduleSummaryRow = {
  id: string;
  name: string;
  connector_type: string;
  cron_expression: string;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_rows_ingested: number | null;
  updated_at: string;
  config: Json;
  last_error: string | null;
  data_source?: { name: string } | null;
};

export type ScheduleSummary = Omit<ScheduleSummaryRow, "config" | "last_error" | "data_source"> & {
  data_source: { name: string } | null;
  agent_configured: boolean;
  has_error: boolean;
};

export function scheduleAgentConfigured(config: unknown): boolean {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return false;
  const agentId = (config as Record<string, unknown>).agent_id;
  return typeof agentId === "string" && agentId.trim().length > 0;
}

export function projectScheduleSummary(row: ScheduleSummaryRow): ScheduleSummary {
  return {
    id: row.id,
    name: row.name,
    connector_type: row.connector_type,
    cron_expression: row.cron_expression,
    enabled: row.enabled,
    last_run_at: row.last_run_at,
    last_status: row.last_status,
    last_rows_ingested: row.last_rows_ingested,
    updated_at: row.updated_at,
    data_source: row.data_source ? { name: row.data_source.name } : null,
    agent_configured: scheduleAgentConfigured(row.config),
    has_error: Boolean(row.last_error),
  };
}

export type ScheduleRunSummary = {
  id: number;
  started_at: string;
  status: string;
  rows_ingested: number | null;
  has_error: boolean;
};

export function projectScheduleRun(row: {
  id: number;
  started_at: string;
  status: string;
  rows_ingested: number | null;
  error: string | null;
}): ScheduleRunSummary {
  return {
    id: row.id,
    started_at: row.started_at,
    status: row.status,
    rows_ingested: row.rows_ingested,
    has_error: Boolean(row.error),
  };
}

const ConnectorTypeSchema = z.enum(CONNECTOR_TYPES);

async function assertActiveScheduleRunner(context: { supabase: any; userId: string }, tenantId: string) {
  const { data: member, error } = await context.supabase.from("tenant_members")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", context.userId)
    .eq("active", true)
    .maybeSingle();
  if (error || !member || !["tenant_admin", "tenant_analyst"].includes(member.role)) {
    throw new Error("You do not have permission to run this connection.");
  }
}

export const SCHEDULE_PAGE_SIZES = [10, 25, 50] as const;
export const SCHEDULE_SORTS = ["name_asc", "name_desc", "updated_desc", "attempt_desc"] as const;
const ScheduleListInput = z.object({
  tenant_id: z.string().uuid(),
  search: z.string().trim().max(120).default(""),
  public_id_search: z.string().trim().max(80).regex(/^[A-Za-z0-9-]*$/u, "Public ID search contains unsupported characters")
    .optional()
    .transform((value) => value || undefined),
  updated_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(isUtcDate, "Enter a valid UTC calendar date").optional(),
  updated_through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(isUtcDate, "Enter a valid UTC calendar date").optional(),
  connector_type: z.union([ConnectorTypeSchema, z.literal("all")]).default("all"),
  state: z.enum(["all", "enabled", "paused"]).default("all"),
  agent_required: z.enum(["all", "yes", "no"]).default("all"),
  sort: z.enum(SCHEDULE_SORTS).default("name_asc"),
  page: z.number().int().min(1).default(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50)]).default(25),
}).superRefine((value, context) => {
  if (value.updated_from && value.updated_through && value.updated_from > value.updated_through) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["updated_through"], message: "Through date must be on or after from date" });
  }
});
export type ScheduleListInput = z.infer<typeof ScheduleListInput>;

function isUtcDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function utcDayAfter(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export function normalizeScheduleSearch(value: string): string {
  // Keep PostgREST's OR expression syntax out of user-controlled search text.
  return value.replace(/[(),%_\\\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function scheduleListOrder(sort: ScheduleListInput["sort"]) {
  switch (sort) {
    case "name_desc": return { column: "name", ascending: false } as const;
    case "updated_desc": return { column: "updated_at", ascending: false } as const;
    case "attempt_desc": return { column: "last_run_at", ascending: false, nullsFirst: false } as const;
    default: return { column: "name", ascending: true } as const;
  }
}

const TransformStepSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("filter"), column: z.string(), expr: z.string().max(200) }),
  z.object({ op: z.literal("rename"), from: z.string(), to: z.string() }),
  z.object({
    op: z.literal("cast"),
    column: z.string(),
    to: z.enum(["string", "number", "date", "boolean"]),
  }),
  z.object({ op: z.literal("derive"), column: z.string(), expression: z.string().max(500) }),
  z.object({ op: z.literal("drop"), column: z.string() }),
  z.object({ op: z.literal("trim"), column: z.string() }),
  z.object({ op: z.literal("upper"), column: z.string() }),
  z.object({ op: z.literal("lower"), column: z.string() }),
]);

export type TransformStep = z.infer<typeof TransformStepSchema>;

export const listSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("data_source_schedules")
      .select(
        "id,name,connector_type,cron_expression,enabled,last_run_at,last_status,last_rows_ingested,updated_at,config,last_error,data_source:workspace_data_sources(name)",
      )
      .eq("tenant_id", data.tenant_id)
      .order("updated_at", { ascending: false });
    if (error || !rows) throw new Error("Connections could not be loaded. Please try again.");
    return rows.map(projectScheduleSummary);
  });

export const listSchedulesPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ScheduleListInput.parse(d))
  .handler(async ({ data, context }) => {
    const start = (data.page - 1) * data.page_size;
    const end = start + data.page_size - 1;
    let query = context.supabase
      .from("data_source_schedules")
      .select(
        "id,name,connector_type,cron_expression,enabled,last_run_at,last_status,last_rows_ingested,updated_at,config,last_error,data_source:workspace_data_sources(name)",
        { count: "exact" },
      )
      .eq("tenant_id", data.tenant_id);
    if (data.connector_type !== "all") query = query.eq("connector_type", data.connector_type);
    if (data.state === "enabled") query = query.eq("enabled", true);
    if (data.state === "paused") query = query.eq("enabled", false);
    const agentTypes = CONNECTOR_TYPES.filter((type) => connectorExecutionMode(type) === "agent_required");
    if (data.agent_required === "yes") query = query.in("connector_type", agentTypes);
    if (data.agent_required === "no") query = query.not("connector_type", "in", `(${agentTypes.join(",")})`);
    const search = normalizeScheduleSearch(data.search);
    if (search) query = query.or(`name.ilike.%${search}%,connector_type.ilike.%${search}%,cron_expression.ilike.%${search}%`);
    if (data.public_id_search) query = (query as any).ilike("public_id", `%${data.public_id_search}%`);
    if (data.updated_from) query = query.gte("updated_at", `${data.updated_from}T00:00:00.000Z`);
    if (data.updated_through) query = query.lt("updated_at", utcDayAfter(data.updated_through));
    const order = scheduleListOrder(data.sort);
    query = query
      .order(order.column, {
        ascending: order.ascending,
        ...( "nullsFirst" in order ? { nullsFirst: order.nullsFirst } : {}),
      })
      .order("id", { ascending: true })
      .range(start, end);
    const { data: rows, error, count } = await query;
    if (error || !rows || typeof count !== "number") {
      throw new Error("Connections could not be loaded. Please try again.");
    }
    return { rows: rows.map(projectScheduleSummary), count, page: data.page, page_size: data.page_size };
  });

export const getScheduleForEdit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { readScheduleSettingsForEditor } = await import("@/lib/connectors-schedule-editor.server");
    return readScheduleSettingsForEditor(context.supabase, context.userId, data.tenant_id, data.id);
  });

export const upsertSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        tenant_id: z.string().uuid(),
        data_source_id: z.string().uuid(),
        name: z.string().min(1).max(120),
        connector_type: ConnectorTypeSchema,
        config: z.record(z.any()).default({}),
        transformation: z.array(TransformStepSchema).max(50).default([]),
        cron_expression: z.string().regex(CronRx, "Cron must be 5 fields"),
        enabled: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const {
      assertActiveScheduleWriter,
      preserveExistingScheduleCredentials,
    } = await import("@/lib/connectors-schedule-editor.server");
    await assertActiveScheduleWriter(context.supabase, context.userId, data.tenant_id, "edit");
    const config = data.id
      ? await preserveExistingScheduleCredentials(
          context.supabase,
          context.userId,
          data.tenant_id,
          data.id,
          data.config,
        )
      : data.config;
    const payload = { ...data, config, created_by: context.userId, updated_at: new Date().toISOString() };
    const { data: row, error } = data.id
      ? await context.supabase
          .from("data_source_schedules")
          .update(payload)
          .eq("id", data.id)
          .eq("tenant_id", data.tenant_id)
          .select("id,name,connector_type,cron_expression,enabled,last_run_at,last_status,last_rows_ingested,updated_at,config,last_error")
          .single()
      : await context.supabase.from("data_source_schedules").insert(payload)
          .select("id,name,connector_type,cron_expression,enabled,last_run_at,last_status,last_rows_ingested,updated_at,config,last_error")
          .single();
    if (error || !row) throw new Error("Connection changes could not be saved. Please try again.");
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "connector.upsert",
      resource_type: "data_source_schedules",
      resource_id: row.id,
      context: {
        name: data.name,
        type: data.connector_type,
        cron: data.cron_expression,
        enabled: data.enabled,
      },
    } as any);
    return projectScheduleSummary(row);
  });

export const deleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertActiveScheduleWriter } = await import("@/lib/connectors-schedule-editor.server");
    await assertActiveScheduleWriter(context.supabase, context.userId, data.tenant_id, "manage");
    const { error } = await context.supabase
      .from("data_source_schedules")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error("Connection could not be deleted. Please try again.");
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "connector.delete",
      resource_type: "data_source_schedules",
      resource_id: data.id,
      context: {},
    } as any);
    return { ok: true };
  });

export const listScheduleRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { schedule_id: string }) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("data_source_runs")
      .select("id,started_at,status,rows_ingested,error")
      .eq("schedule_id", data.schedule_id)
      .order("started_at", { ascending: false })
      .limit(50);
    if (error || !rows) throw new Error("Run history could not be loaded. Please try again.");
    return rows.map(projectScheduleRun);
  });

export const runScheduleNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertActiveScheduleRunner(context, data.tenant_id);
    const { data: schedule, error: scheduleError } = await context.supabase
      .from("data_source_schedules")
      .select("id,tenant_id,connector_type")
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (scheduleError) throw new Error(scheduleError.message);
    if (!schedule) throw new Error("Schedule not found");
    if (connectorExecutionMode(schedule.connector_type) === "agent_required") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as SupabaseClient;
      const { data: queued, error } = await admin.rpc("enqueue_workflow_api_job", {
        _tenant_id: data.tenant_id,
        _token_id: null,
        _actor_user_id: context.userId,
        _job_kind: "connector_run",
        _resource_id: data.id,
        _idempotency_key: `browser-agent-${crypto.randomUUID()}`,
      });
      if (error || !queued?.[0]) throw new Error(error?.message ?? "Agent queue unavailable");
      return { ok: true, rows: 0, queued: true, job_id: queued[0].job_id };
    }
    const { runSchedule } = await import("@/lib/connectors.server");
    const result = await runSchedule(data.id, data.tenant_id, "manual", {
      actorUserId: context.userId,
    });
    return { ...result, queued: false, job_id: null };
  });
