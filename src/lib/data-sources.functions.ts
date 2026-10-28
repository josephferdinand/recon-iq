import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

async function assertTenantWriter(ctx: any, tenantId: string) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
    _role: "tenant_admin",
  });
  const { data: isAnalyst } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
    _role: "tenant_analyst",
  });
  if (!isAdmin && !isAnalyst) throw new Error("Forbidden: analyst or admin role required");
}

export const listDataSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("workspace_data_sources")
      .select("id, name, description, source_type, status, row_count, inferred_schema, sample_rows, last_error, created_at, updated_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const DataSourceOptionsInput = z.object({
  tenant_id: z.string().uuid(),
  search: z.string().trim().max(120).default(""),
  selected_ids: z.array(z.string().uuid()).max(10).default([]),
  include_schema: z.boolean().default(false),
});

const DATA_SOURCE_OPTIONS_LIMIT = 1000;

export type DataSourceOption = {
  id: string;
  name: string;
  inferred_schema?: { name: string }[] | null;
};

export const listDataSourceOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => DataSourceOptionsInput.parse(input))
  .handler(async ({ data, context }): Promise<{
    rows: DataSourceOption[];
    selected: DataSourceOption[];
    total: number;
    limit: number;
    truncated: boolean;
  }> => {
    const projection = data.include_schema ? "id, name, inferred_schema" : "id, name";
    let query = context.supabase.from("workspace_data_sources")
      .select(projection, { count: "exact" })
      .eq("tenant_id", data.tenant_id)
      .order("name")
      .order("id")
      .limit(DATA_SOURCE_OPTIONS_LIMIT);
    if (data.search) {
      query = query.ilike("name", `%${escapePostgrestLikeTerm(data.search)}%`);
    }

    const { data: rows, count, error } = await query;
    if (error || !Array.isArray(rows) || typeof count !== "number") {
      throw new Error("Data source options are temporarily unavailable. Please try again.");
    }

    const selectedQuery = data.selected_ids.length
      ? await context.supabase.from("workspace_data_sources")
        .select(projection)
        .eq("tenant_id", data.tenant_id)
        .in("id", data.selected_ids)
      : { data: [], error: null };
    if (selectedQuery.error) {
      throw new Error("Selected data source details are temporarily unavailable. Please try again.");
    }

    const toOption = (row: any): DataSourceOption => ({
      id: row.id,
      name: row.name,
      ...(data.include_schema ? {
        inferred_schema: Array.isArray(row.inferred_schema)
          ? row.inferred_schema.flatMap((column: unknown) =>
            column && typeof column === "object" && !Array.isArray(column) &&
            typeof (column as Record<string, unknown>).name === "string"
              ? [{ name: (column as { name: string }).name }]
              : [])
          : null,
      } : {}),
    });
    return {
      rows: rows.map(toOption),
      selected: (selectedQuery.data ?? []).map(toOption),
      total: count,
      limit: DATA_SOURCE_OPTIONS_LIMIT,
      truncated: count > DATA_SOURCE_OPTIONS_LIMIT,
    };
  });

export const DATA_SOURCE_PAGE_FILTERS = {
  status: ["draft", "ready", "error", "archived"],
  source_type: ["csv", "xlsx", "json", "api", "database", "manual"],
  sort_by: ["updated_at", "name", "source_type", "status", "row_count", "created_at"],
  max_page_size: 100,
} as const;

const DataSourcePageInput = z.object({
  tenant_id: z.string().uuid(),
  page: z.number().int().min(1).max(1_000_000).default(1),
  page_size: z.number().int().min(1).max(DATA_SOURCE_PAGE_FILTERS.max_page_size).default(25),
  search: z.string().trim().max(120)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "Search contains unsupported characters")
    .optional()
    .transform((value) => value || undefined),
  public_id_search: z.string().trim().max(80).regex(/^[A-Za-z0-9-]*$/u, "Public ID search contains unsupported characters")
    .optional()
    .transform((value) => value || undefined),
  updated_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(isUtcDate, "Enter a valid UTC calendar date").optional(),
  updated_through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(isUtcDate, "Enter a valid UTC calendar date").optional(),
  status: z.enum(DATA_SOURCE_PAGE_FILTERS.status).optional(),
  source_type: z.enum(DATA_SOURCE_PAGE_FILTERS.source_type).optional(),
  sort_by: z.enum(DATA_SOURCE_PAGE_FILTERS.sort_by).default("updated_at"),
  sort_direction: z.enum(["asc", "desc"]).default("desc"),
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

export type DataSourcePageInput = z.infer<typeof DataSourcePageInput>;
type WorkspaceDataSourceRow = Database["public"]["Tables"]["workspace_data_sources"]["Row"];
type WorkspaceDataSourceUploadRow = Database["public"]["Tables"]["workspace_data_source_uploads"]["Row"];
export type DataSourceSchemaColumn = {
  name: string;
  inferred_type: string;
  nullable: boolean | null;
};

export type DataSourceListPageRow = Omit<Pick<
  WorkspaceDataSourceRow,
  "id" | "name" | "description" | "source_type" | "status" | "row_count" |
    "inferred_schema" | "created_at" | "updated_at"
>, "inferred_schema"> & {
  inferred_schema: DataSourceSchemaColumn[] | null;
};

export type DataSourcePageResult = {
  rows: DataSourceListPageRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type DataSourceUploadHistoryRow = Pick<
  WorkspaceDataSourceUploadRow,
  "id" | "filename" | "mime_type" | "size_bytes" | "row_count" | "created_at"
> & {
  column_count: number | null;
};

export type DataSourceDetail = DataSourceListPageRow & {
  uploads: DataSourceUploadHistoryRow[];
};

const DATA_SOURCE_PAGE_FIELDS =
  "id, name, description, source_type, status, row_count, inferred_schema, created_at, updated_at";

function escapePostgrestLikeTerm(value: string) {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/%/gu, "\\%")
    .replace(/_/gu, "\\_")
    .replace(/"/gu, "\\\"");
}

function safeSchemaColumns(value: unknown): DataSourceSchemaColumn[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((column: unknown) => {
    if (!column || typeof column !== "object" || Array.isArray(column)) return [];
    const candidate = column as Record<string, unknown>;
    if (typeof candidate.name !== "string" || typeof candidate.inferred_type !== "string") return [];
    return [{
      name: candidate.name,
      inferred_type: candidate.inferred_type,
      nullable: typeof candidate.nullable === "boolean" ? candidate.nullable : null,
    }];
  });
}

export const listDataSourcesPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => DataSourcePageInput.parse(input))
  .handler(async ({ data, context }): Promise<DataSourcePageResult> => {
    const from = (data.page - 1) * data.page_size;
    const to = from + data.page_size - 1;
    let query = context.supabase.from("workspace_data_sources")
      .select(DATA_SOURCE_PAGE_FIELDS, { count: "exact" })
      .eq("tenant_id", data.tenant_id);

    if (data.search) {
      const pattern = `"%${escapePostgrestLikeTerm(data.search)}%"`;
      query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
    }
    if (data.source_type) query = query.eq("source_type", data.source_type);
    if (data.status) query = query.eq("status", data.status);
    if (data.public_id_search) query = (query as any).ilike("public_id", `%${data.public_id_search}%`);
    if (data.updated_from) query = query.gte("updated_at", `${data.updated_from}T00:00:00.000Z`);
    if (data.updated_through) query = query.lt("updated_at", utcDayAfter(data.updated_through));

    if (data.sort_by === "updated_at") {
      query = query.order("updated_at", { ascending: data.sort_direction === "asc", nullsFirst: false })
        .order("id", { ascending: data.sort_direction === "asc" });
    } else {
      query = query.order(data.sort_by, { ascending: data.sort_direction === "asc", nullsFirst: false })
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });
    }

    const { data: rows, count, error } = await query.range(from, to);
    if (error || !Array.isArray(rows) || typeof count !== "number") {
      throw new Error("Data source list is temporarily unavailable. Please try again.");
    }

    const safeRows: DataSourceListPageRow[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      source_type: row.source_type,
      status: row.status,
      row_count: row.row_count,
      inferred_schema: safeSchemaColumns(row.inferred_schema),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return {
      rows: safeRows,
      total: count,
      page: data.page,
      page_size: data.page_size,
      total_pages: Math.ceil(count / data.page_size),
    };
  });

export const getDataSource = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<DataSourceDetail> => {
    const { data: row, error } = await context.supabase
      .from("workspace_data_sources")
      .select(DATA_SOURCE_PAGE_FIELDS)
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (error) throw new Error("Data source details are temporarily unavailable. Please try again.");
    if (!row) throw new Error("This data source is no longer available in this workspace.");
    const { data: uploads, error: uploadsError } = await context.supabase
      .from("workspace_data_source_uploads")
      .select("id, filename, mime_type, size_bytes, row_count, columns, created_at")
      .eq("tenant_id", data.tenant_id)
      .eq("data_source_id", data.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (uploadsError) throw new Error("Uploaded file history is temporarily unavailable. Please try again.");
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      source_type: row.source_type,
      status: row.status,
      row_count: row.row_count,
      inferred_schema: safeSchemaColumns(row.inferred_schema),
      created_at: row.created_at,
      updated_at: row.updated_at,
      uploads: (uploads ?? []).map((upload) => ({
        id: upload.id,
        filename: upload.filename,
        mime_type: upload.mime_type,
        size_bytes: upload.size_bytes,
        row_count: upload.row_count,
        created_at: upload.created_at,
        column_count: safeSchemaColumns(upload.columns)?.length ?? null,
      })),
    };
  });

const CreateDS = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional().nullable(),
  source_type: z.enum(["csv", "xlsx", "json", "api", "database", "manual"]),
  connection_config: z.record(z.string(), z.any()).optional(),
});

export const createDataSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof CreateDS>) => CreateDS.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantWriter(context, data.tenant_id);
    const { data: row, error } = await context.supabase
      .from("workspace_data_sources")
      .insert({
        tenant_id: data.tenant_id,
        name: data.name,
        description: data.description ?? null,
        source_type: data.source_type,
        connection_config: data.connection_config ?? {},
        created_by: context.userId,
      })
      .select("id, name, source_type, status")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "workspace",
      action: "data_source.create",
      resource_type: "workspace_data_source",
      resource_id: row.id,
      context: { name: row.name, source_type: row.source_type },
    } as any);
    return row;
  });

const UpdateDS = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional().nullable(),
  status: z.enum(["draft", "ready", "error", "archived"]).optional(),
});

export const updateDataSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof UpdateDS>) => UpdateDS.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantWriter(context, data.tenant_id);
    const patch: Record<string, any> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.status !== undefined) patch.status = data.status;
    const { error } = await context.supabase
      .from("workspace_data_sources")
      .update(patch as any)
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "workspace",
      action: "data_source.update",
      resource_type: "workspace_data_source",
      resource_id: data.id,
      context: patch,
    } as any);
    return { ok: true };
  });

export const deleteDataSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertTenantWriter(context, data.tenant_id);
    const { error } = await context.supabase
      .from("workspace_data_sources")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "workspace",
      action: "data_source.delete",
      resource_type: "workspace_data_source",
      resource_id: data.id,
      context: {},
    } as any);
    return { ok: true };
  });

const ColumnSchema = z.object({
  name: z.string(),
  inferred_type: z.enum(["string", "number", "date", "boolean", "null"]),
  nullable: z.boolean().optional(),
  sample: z.string().optional(),
});

const MAX_UPLOAD_BYTES = 10_000_000;
const MAX_ROW_BYTES = 16 * 1024;
const MAX_UPLOAD_ROWS = 50_000;

const RegisterUpload = z.object({
  data_source_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mime_type: z.string().max(120).optional(),
  size_bytes: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  row_count: z.number().int().nonnegative(),
  columns: z.array(ColumnSchema).max(500),
  sample_rows: z.array(z.record(z.string(), z.any())).max(20),
  rows: z.array(z.record(z.string(), z.any())).max(MAX_UPLOAD_ROWS).optional(),
  content_sha256: z.string().length(64).optional(),
});

export const registerUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof RegisterUpload>) => RegisterUpload.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantWriter(context, data.tenant_id);
    const { assertTenantIpAllowed } = await import("@/lib/ip-guard.server");
    await assertTenantIpAllowed(context.supabase, data.tenant_id, context.userId);

    // Verify reported metadata against the rows actually received: bound each
    // row and the total payload, and reject counts/sizes that disagree.
    const rows = data.rows ?? [];
    const encoder = new TextEncoder();
    let rowsBytes = 0;
    for (const row of [...rows, ...data.sample_rows]) {
      const rowBytes = encoder.encode(JSON.stringify(row)).byteLength;
      if (rowBytes > MAX_ROW_BYTES) {
        throw new Error("An uploaded row exceeds the 16 KB limit. Remove oversized cells and upload the file again.");
      }
      rowsBytes += rowBytes;
      if (rowsBytes > MAX_UPLOAD_BYTES) {
        throw new Error("The uploaded rows exceed the 10 MB limit. Split the file and upload it in smaller parts.");
      }
    }
    // `rows` is capped at MAX_UPLOAD_ROWS, so a larger reported count is only
    // consistent when the stored rows are already at that cap.
    const truncatedAtRowCap = rows.length >= MAX_UPLOAD_ROWS;
    if (
      data.sample_rows.length > rows.length
      || data.row_count < rows.length
      || (!truncatedAtRowCap && data.row_count !== rows.length)
      || (rows.length > 0 && data.size_bytes === 0)
    ) {
      throw new Error("The uploaded file metadata does not match the uploaded rows. Upload the file again.");
    }

    // D1: per-tenant per-user upload rate limit
    const { enforceServerFnRateLimit } = await import("@/lib/rate-limit.server");
    const { data: sec } = await context.supabase
      .from("tenant_security_settings").select("max_uploads_per_hour")
      .eq("tenant_id", data.tenant_id).maybeSingle();
    await enforceServerFnRateLimit(
      context.supabase,
      `ds.upload:${data.tenant_id}:${context.userId}`,
      3600, sec?.max_uploads_per_hour ?? 60,
      { tenant_id: data.tenant_id, user_id: context.userId, event_type: "rate_limit.upload" },
    );
    const { data: up, error } = await context.supabase
      .from("workspace_data_source_uploads")
      .insert({
        data_source_id: data.data_source_id,
        tenant_id: data.tenant_id,
        filename: data.filename,
        mime_type: data.mime_type ?? null,
        size_bytes: data.size_bytes,
        row_count: data.row_count,
        columns: data.columns,
        sample_rows: data.sample_rows,
        rows: data.rows ?? [],
        content_sha256: data.content_sha256 ?? null,
        uploaded_by: context.userId,
      } as any)
      .select("id, filename, row_count, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Update parent data source with inferred schema + sample + status
    const { error: updErr } = await context.supabase
      .from("workspace_data_sources")
      .update({
        inferred_schema: data.columns,
        sample_rows: data.sample_rows,
        row_count: data.row_count,
        status: "ready",
        last_error: null,
      })
      .eq("id", data.data_source_id)
      .eq("tenant_id", data.tenant_id);
    if (updErr) throw new Error(updErr.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "workspace",
      action: "data_source.upload",
      resource_type: "workspace_data_source",
      resource_id: data.data_source_id,
      context: {
        upload_id: up.id,
        filename: data.filename,
        size_bytes: data.size_bytes,
        row_count: data.row_count,
        column_count: data.columns.length,
        content_sha256: data.content_sha256 ?? null,
      },
    } as any);

    return up;
  });
