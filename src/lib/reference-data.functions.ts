import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";

const tid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const utcCalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid UTC calendar date");
const utcCalendarDateFilter = z.union([utcCalendarDate, z.literal("")]).default("");
const referenceColumn = z.string().trim().min(1).max(80);
const uniqueColumns = (minimum: number) =>
  z
    .array(referenceColumn)
    .min(minimum)
    .max(50)
    .superRefine((columns, context) => {
      const normalized = columns.map((column) => column.toLocaleLowerCase());
      if (new Set(normalized).size !== normalized.length) {
        context.addIssue({
          code: "custom",
          message: "Reference columns must be unique",
        });
      }
    });

async function assertWriter(context: { userId: string; supabase: SupabaseClient }, tenantId: string) {
  const [{ data: admin }, { data: analyst }] = await Promise.all([
    context.supabase.rpc("has_tenant_role", { _user_id: context.userId, _tenant_id: tenantId, _role: "tenant_admin" }),
    context.supabase.rpc("has_tenant_role", { _user_id: context.userId, _tenant_id: tenantId, _role: "tenant_analyst" }),
  ]);
  if (!admin && !analyst) throw new Error("Forbidden: analyst or admin required");
}

export const listReferenceTables = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reference_data_tables").select("*")
      .eq("tenant_id", data.tenant_id).order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const ReferenceTablePageSchema = z.object({
  tenant_id: tid,
  page: z.number().int().min(0).max(100_000).default(0),
  page_size: z.number().int().min(10).max(100).default(25),
  search: z.string().max(100).default(""),
  public_id_search: z.string().max(100).default(""),
  updated_from: utcCalendarDateFilter,
  updated_to: utcCalendarDateFilter,
  type: z.enum(["all", "enrichment", "validation"]).default("all"),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  sort: z.enum(["name_asc", "name_desc", "updated_desc", "updated_asc"]).default("name_asc"),
}).superRefine((value, issue) => {
  if (value.updated_from && value.updated_to && value.updated_from > value.updated_to) {
    issue.addIssue({ code: "custom", path: ["updated_to"], message: "Updated-to date must be on or after updated-from date" });
  }
});

function isMissingPublicIdColumn(error: unknown) {
  const detail = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const message = `${String(detail.code ?? "")} ${String(detail.message ?? "")}`.toLowerCase();
  return message.includes("pgrst204") || message.includes("42703") ||
    (message.includes("public_id") && message.includes("column") &&
      (message.includes("does not exist") || message.includes("not found") || message.includes("schema cache")));
}

export const listReferenceTablesPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ReferenceTablePageSchema.parse(d))
  .handler(async ({ data, context }) => {
    const search = data.search.trim().replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 100);
    const publicIdSearch = data.public_id_search.trim().replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 100);
    let query = context.supabase
      .from("reference_data_tables")
      .select("id,tenant_id,name,description,key_columns,value_columns,row_count,is_active,created_at,updated_at", { count: "exact" })
      .eq("tenant_id", data.tenant_id);
    if (search) query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    if (publicIdSearch) query = query.ilike("public_id", `%${publicIdSearch.replace(/[%_]/g, "\\$&")}%`);
    if (data.updated_from) query = query.gte("updated_at", `${data.updated_from}T00:00:00.000Z`);
    if (data.updated_to) {
      const exclusiveEnd = new Date(`${data.updated_to}T00:00:00.000Z`);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      query = query.lt("updated_at", exclusiveEnd.toISOString());
    }
    if (data.status === "active") query = query.eq("is_active", true);
    if (data.status === "inactive") query = query.eq("is_active", false);
    if (data.type === "enrichment") query = query.not("value_columns", "eq", "{}");
    if (data.type === "validation") query = query.filter("value_columns", "eq", "{}");
    const sortColumn = data.sort.startsWith("name") ? "name" : "updated_at";
    const { data: rows, error, count } = await query
      .order(sortColumn, { ascending: data.sort === "name_asc" || data.sort === "updated_asc", nullsFirst: false })
      .order("id", { ascending: true })
      .range(data.page * data.page_size, data.page * data.page_size + data.page_size - 1);
    if (error && publicIdSearch && isMissingPublicIdColumn(error)) {
      throw new Error("Public ID search is not available on this environment yet. Clear that filter or contact your administrator.");
    }
    if (error) throw new Error("Reference table list unavailable");
    if (typeof count !== "number") throw new Error("Reference table count is temporarily unavailable. Please try again.");
    return { rows: rows ?? [], total: count, page: data.page, page_size: data.page_size };
  });

export const upsertReferenceTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      name: z.string().min(2).max(80),
      description: z.string().max(500).optional().nullable(),
      key_columns: uniqueColumns(1),
      value_columns: uniqueColumns(0).default([]),
      is_active: z.boolean().default(true),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    if (data.id) {
      const { data: owned } = await context.supabase.from("reference_data_tables")
        .select("id").eq("id", data.id).eq("tenant_id", data.tenant_id).maybeSingle();
      if (!owned) throw new Error("Reference table not found");
    }
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("reference_data_tables").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "reference_data.table.update" : "reference_data.table.create",
      resource_type: "reference_data_tables", resource_id: row.id,
      context: { name: data.name },
    } as any);
    return row;
  });

export const listReferenceVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      table_id: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(25),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reference_data_versions")
      .select("id,version_number,status,effective_from,effective_to,row_count,content_sha256,change_note,created_by,created_at,submitted_by,submitted_at,decided_by,decided_at,decision_reason,published_at")
      .eq("tenant_id", data.tenant_id)
      .eq("table_id", data.table_id)
      .order("version_number", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const StageReferenceVersion = z.object({
  tenant_id: tid,
  table_id: z.string().uuid(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(10000),
  effective_from: isoDate,
  effective_to: isoDate.optional().nullable(),
  change_note: z.string().trim().min(3).max(1000),
}).superRefine((value, context) => {
  if (value.effective_to && value.effective_to < value.effective_from) {
    context.addIssue({ code: "custom", path: ["effective_to"], message: "Effective-to date cannot precede effective-from" });
  }
});

export const stageReferenceVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => StageReferenceVersion.parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: result, error } = await context.supabase.rpc("stage_reference_data_version", {
      _tenant_id: data.tenant_id,
      _table_id: data.table_id,
      _rows: data.rows as unknown as Json,
      _effective_from: data.effective_from,
      _effective_to: data.effective_to ?? "9999-12-31",
      _change_note: data.change_note,
    });
    if (error) throw new Error(error.message);
    const version = Array.isArray(result) ? result[0] : result;
    if (!version) throw new Error("Reference version was not staged");
    const { data: persisted, error: readbackError } = await context.supabase
      .from("reference_data_versions")
      .select("id,status,content_sha256,row_count")
      .eq("id", version.version_id)
      .eq("tenant_id", data.tenant_id)
      .eq("table_id", data.table_id)
      .maybeSingle();
    if (readbackError || persisted?.status !== "draft"
        || persisted.content_sha256 !== version.content_sha256
        || persisted.row_count !== version.row_count) {
      throw new Error("Reference version staging readback failed");
    }
    return version;
  });

export const submitReferenceVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid, version_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: status, error } = await context.supabase.rpc("submit_reference_data_version", {
      _tenant_id: data.tenant_id,
      _version_id: data.version_id,
    });
    if (error) throw new Error(error.message);
    if (status !== "pending_approval") throw new Error("Reference version submission failed");
    const { data: persisted, error: readbackError } = await context.supabase
      .from("reference_data_versions")
      .select("status")
      .eq("id", data.version_id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (readbackError || persisted?.status !== "pending_approval") {
      throw new Error("Reference version submission readback failed");
    }
    return { status };
  });

export const decideReferenceVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    version_id: z.string().uuid(),
    approve: z.boolean(),
    reason: z.string().trim().max(1000).optional().nullable(),
  }).superRefine((value, context) => {
    if (!value.approve && (value.reason?.length ?? 0) < 3) {
      context.addIssue({ code: "custom", path: ["reason"], message: "A rejection reason is required" });
    }
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: status, error } = await context.supabase.rpc("decide_reference_data_version", {
      _tenant_id: data.tenant_id,
      _version_id: data.version_id,
      _approve: data.approve,
      _reason: data.reason ?? undefined,
    });
    if (error) throw new Error(error.message);
    const expectedStatus = data.approve ? "published" : "rejected";
    if (status !== expectedStatus) throw new Error("Reference version decision failed");
    const { data: persisted, error: readbackError } = await context.supabase
      .from("reference_data_versions")
      .select("status")
      .eq("id", data.version_id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (readbackError || persisted?.status !== expectedStatus) {
      throw new Error("Reference version decision readback failed");
    }
    return { status };
  });

export const requestReferenceRollback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    table_id: z.string().uuid(),
    source_version_id: z.string().uuid(),
    effective_from: isoDate,
    reason: z.string().trim().min(3).max(1000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("request_reference_data_rollback", {
      _tenant_id: data.tenant_id,
      _table_id: data.table_id,
      _source_version_id: data.source_version_id,
      _effective_from: data.effective_from,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    const version = Array.isArray(result) ? result[0] : result;
    if (!version) throw new Error("Rollback draft was not created");
    const { data: persisted, error: readbackError } = await context.supabase
      .from("reference_data_versions")
      .select("status,content_sha256,row_count")
      .eq("id", version.version_id)
      .eq("tenant_id", data.tenant_id)
      .eq("table_id", data.table_id)
      .maybeSingle();
    if (readbackError || persisted?.status !== "draft"
        || persisted.content_sha256 !== version.content_sha256
        || persisted.row_count !== version.row_count) {
      throw new Error("Rollback draft readback failed");
    }
    return version;
  });

export const resolveReferenceVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    table_id: z.string().uuid(),
    as_of: isoDate,
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("resolve_reference_data_version", {
      _tenant_id: data.tenant_id,
      _table_id: data.table_id,
      _as_of: data.as_of,
    });
    if (error) throw new Error(error.message);
    return Array.isArray(result) ? result[0] : result;
  });

export const listReferenceRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: tid, table_id: z.string().uuid(), limit: z.number().int().max(500).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reference_data_rows").select("id, row_data, created_at")
      .eq("table_id", data.table_id).eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
