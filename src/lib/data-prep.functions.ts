import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertSafeRegex } from "@/lib/safe-regex.server";
import { isDateLike, type InferredColumn, type InferredType } from "@/lib/csv-parse";
import { TRANSFORM_BY_KIND } from "@/lib/data-prep-transforms";
import type { Json } from "@/integrations/supabase/types";

// Compile a user-supplied regex pattern with ReDoS guards. Returns null when
// the pattern is empty or rejected so callers can fall back to a no-op.
function safeCompile(pattern: string | undefined | null, flags?: string): RegExp | null {
  if (!pattern) return null;
  try { const r = assertSafeRegex(pattern); return flags ? new RegExp(r.source, flags) : r; }
  catch { return null; }
}


async function assertWriter(ctx: any, tenantId: string) {
  const { data: a } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  const { data: b } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_analyst",
  });
  if (!a && !b) throw new Error("Forbidden: analyst or admin required");
}

const csvFields = z.array(z.string().trim().min(1).max(120)).min(1).max(100);
const UtcDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Use a UTC date in YYYY-MM-DD format")
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return year >= 1 && year <= 9998 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid UTC calendar date");

function utcDateStart(value: string) {
  return `${value}T00:00:00.000Z`;
}

function utcDateAfter(value: string) {
  return new Date(new Date(utcDateStart(value)).getTime() + 86_400_000).toISOString();
}
export const DataPrepStepSchema = z.object({
  kind: z.string().min(1).max(64),
  field: z.string().trim().min(1).max(120).optional(),
  to: z.string().trim().min(1).max(120).optional(),
  fields: csvFields.optional(),
  expr: z.string().trim().min(1).max(500).optional(),
  pattern: z.string().min(1).max(500).optional(),
  // free-form params bag for richer transforms
  params: z.record(z.string(), z.unknown()).optional(),
  find: z.string().min(1).max(500).optional(),
  replace: z.string().max(500).optional(),
  length: z.number().int().min(0).max(100_000).optional(),
  char: z.string().max(1).optional(),
  start: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  end: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  decimals: z.number().int().min(0).max(12).optional(),
  separator: z.string().max(100).optional(),
  delimiter: z.string().min(1).max(100).optional(),
  index: z.number().int().min(1).max(100_000).optional(),
  format: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY", "YYYYMMDD"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  value: z.unknown().optional(),
  left: z.string().trim().min(1).max(120).optional(),
  right: z.string().trim().min(1).max(120).optional(),
  op: z.enum(["+", "-", "*", "/"]).optional(),
  path: z.string().trim().min(1).max(500).optional(),
  token: z.string().max(200).optional(),
  show_last: z.number().int().min(0).max(64).optional(),
  amount_field: z.string().trim().min(1).max(120).optional(),
  indicator_field: z.string().trim().min(1).max(120).optional(),
  indicator_value: z.string().trim().min(1).max(120).optional(),
}).superRefine((step, context) => {
  const definition = TRANSFORM_BY_KIND[step.kind];
  if (!definition) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "Unknown transform kind" });
    return;
  }
  for (const parameter of definition.params) {
    const direct = step[parameter.name as keyof typeof step];
    const value = direct ?? step.params?.[parameter.name];
    if (parameter.required) {
      const missing = value === undefined || value === null || value === ""
        || (Array.isArray(value) && value.length === 0);
      if (missing) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [parameter.name],
          message: `${parameter.label} is required`,
        });
        continue;
      }
    }
    if (value === undefined || value === null || value === "") continue;
    if (parameter.kind === "csv" && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === ""))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [parameter.name], message: `${parameter.label} must be a non-empty field list` });
    }
    if (parameter.kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [parameter.name], message: `${parameter.label} must be a finite number` });
    }
    if (parameter.kind === "select" && !parameter.options.includes(String(value))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [parameter.name], message: `${parameter.label} is invalid` });
    }
  }
  if (["filter", "regex_replace"].includes(step.kind) && step.pattern) {
    try { assertSafeRegex(step.pattern); }
    catch { context.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "Unsafe or invalid regular expression" }); }
  }
  if (step.kind === "filter_expr" && step.expr && !/^(=|!=|>=|<=|>|<)\s*.+$/u.test(step.expr)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expr"], message: "Invalid filter expression" });
  }
  if (step.kind === "substring" && step.start !== undefined && step.end !== undefined && step.end < step.start) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "End must be greater than or equal to start" });
  }
});
export const DataQualityRuleSchema = z.object({
  id: z.string().min(1).max(64),
  field: z.string().min(1).max(120),
  kind: z.enum(["not_null","unique","regex","min","max","in_set","is_number","is_date","currency"]),
  params: z.record(z.string(), z.unknown()).optional(),
  severity: z.enum(["info","warning","critical"]).default("warning"),
}).superRefine((rule, context) => {
  const params = rule.params ?? {};
  if (rule.kind === "regex") {
    if (typeof params.pattern !== "string" || params.pattern.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["params", "pattern"], message: "Regex pattern is required" });
    } else {
      try { assertSafeRegex(params.pattern); }
      catch { context.addIssue({ code: z.ZodIssueCode.custom, path: ["params", "pattern"], message: "Unsafe or invalid regular expression" }); }
    }
  }
  if (["min", "max"].includes(rule.kind) && (typeof params.value !== "number" || !Number.isFinite(params.value))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["params", "value"], message: "Finite numeric limit is required" });
  }
  if (rule.kind === "in_set" && (!Array.isArray(params.values) || params.values.length === 0 || params.values.length > 1_000)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["params", "values"], message: "A non-empty set of at most 1000 values is required" });
  }
});

export type DataPrepRow = Record<string, Json | undefined>;
export type DataPrepStep = z.infer<typeof DataPrepStepSchema>;
export type DataQualityRule = z.infer<typeof DataQualityRuleSchema>;

export const DataPrepPipelineSchema = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional().nullable(),
  source_data_source_id: z.string().uuid().nullable().optional(),
  output_data_source_id: z.string().uuid().nullable().optional(),
  steps: z.array(DataPrepStepSchema).max(100),
  dq_rules: z.array(DataQualityRuleSchema).max(50),
  on_failure: z.enum(["block","warn","drop_rows"]),
  enabled: z.boolean(),
});

export const listPipelines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      page: z.number().int().min(0).default(0),
      page_size: z.number().int().min(1).max(100).default(25),
      search: z.string().max(120).default(""),
      status: z.enum(["all", "draft", "pending_approval", "approved", "archived"]).default("all"),
      steps: z.enum(["all", "zero", "one_two", "three_plus"]).default("all"),
      dq: z.enum(["all", "zero", "one_plus"]).default("all"),
      last_run: z.enum(["all", "7d", "30d", "90d", "never"]).default("all"),
      sort: z.enum(["updated_desc", "updated_asc", "name_asc", "last_run_desc"]).default("updated_desc"),
      updated_from: UtcDateOnly.optional(),
      updated_through: UtcDateOnly.optional(),
    }).superRefine((input, issueContext) => {
      if (input.updated_from && input.updated_through && input.updated_from > input.updated_through) {
        issueContext.addIssue({ code: "custom", path: ["updated_through"], message: "Updated through must be on or after Updated from" });
      }
    }).parse(d))
  .handler(async ({ data, context }) => {
    const columns = "id, public_uid, status, version, approved_at, approved_by, name, description, source_data_source_id, output_data_source_id, steps, dq_rules, on_failure, enabled, lifecycle_state, parent_pipeline_id, promotion_status, promotion_requested_at, promotion_requested_by, last_run_at, last_status, last_error, updated_at";
    const batchSize = 500;
    const collected: any[] = [];
    // Apply persisted UTC date boundaries at the RLS-scoped read. JSON-array
    // step/DQ filters still require scanning all matching rows; indexed
    // generated counts or a governed RPC are needed as tenant volume grows.
    for (let from = 0; ; from += batchSize) {
      let query = context.supabase.from("data_prep_pipelines")
        .select(columns).eq("tenant_id", data.tenant_id);
      if (data.updated_from) query = query.gte("updated_at", utcDateStart(data.updated_from));
      if (data.updated_through) query = query.lt("updated_at", utcDateAfter(data.updated_through));
      const { data: batch, error } = await query
        .order("updated_at", { ascending: false }).order("id", { ascending: true })
        .range(from, from + batchSize - 1);
      if (error) throw new Error("Unable to load Data Prep pipelines");
      collected.push(...(batch ?? []));
      if (!batch || batch.length < batchSize) break;
    }
    const search = data.search.trim().toLocaleLowerCase();
    const cutoff = data.last_run === "all" || data.last_run === "never" ? null : Date.now() - Number(data.last_run.slice(0, -1)) * 86400000;
    const matches = collected.filter((row) => {
      const stepCount = Array.isArray(row.steps) ? row.steps.length : 0;
      const dqCount = Array.isArray(row.dq_rules) ? row.dq_rules.length : 0;
      const status = row.lifecycle_state === "archived" ? "archived" : row.status;
      if (search && !String(row.name ?? "").toLocaleLowerCase().includes(search) && !String(row.public_uid ?? "").toLocaleLowerCase().includes(search)) return false;
      if (data.status !== "all" && status !== data.status) return false;
      if (data.steps === "zero" && stepCount !== 0 || data.steps === "one_two" && (stepCount < 1 || stepCount > 2) || data.steps === "three_plus" && stepCount < 3) return false;
      if (data.dq === "zero" && dqCount !== 0 || data.dq === "one_plus" && dqCount < 1) return false;
      if (data.last_run === "never" && row.last_run_at || cutoff !== null && (!row.last_run_at || new Date(row.last_run_at).getTime() < cutoff)) return false;
      return true;
    });
    if (data.sort === "name_asc") matches.sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
    else if (data.sort === "updated_asc") matches.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || String(a.id).localeCompare(String(b.id)));
    else if (data.sort === "last_run_desc") matches.sort((a, b) => String(b.last_run_at ?? "").localeCompare(String(a.last_run_at ?? "")) || String(a.id).localeCompare(String(b.id)));
    const start = data.page * data.page_size;
    return { rows: matches.slice(start, start + data.page_size), total: matches.length };
  });

// Approved pipelines a ReconIQ Studio side can consume — must have an output data source.
export const listApprovedPipelinesForRecon = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("data_prep_pipelines")
      .select("id, public_uid, name, output_data_source_id, version, approved_at")
      .eq("tenant_id", data.tenant_id)
      .eq("status", "approved")
      .not("output_data_source_id", "is", null)
      .order("approved_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof DataPrepPipelineSchema>) => DataPrepPipelineSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, tenant_id, ...payload } = data;
    // SQL NULL is the create signal here: upsert_data_prep_pipeline_for_api
    // inserts (server-generated id) when _pipeline_id IS NULL and updates
    // otherwise, raising "pipeline not found" for an unknown non-null id.
    // Postgres function args are nullable at runtime, but the generated
    // client type marks them string, so pass the create-case null through
    // this one boundary instead of inventing a sentinel UUID.
    const pipelineIdArg = (id ?? null) as unknown as string;
    const { data: result, error } = await context.supabase.rpc("upsert_data_prep_pipeline", {
      _tenant_id: tenant_id,
      _pipeline_id: pipelineIdArg,
      _payload: payload as unknown as Json,
    });
    if (error || !result?.[0]) throw new Error(error?.message ?? "Pipeline save failed");
    return { id: result[0].pipeline_id, public_uid: result[0].public_uid };
  });

export const approvePipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("approve_data_prep_pipeline", {
      _tenant_id: data.tenant_id,
      _pipeline_id: data.id,
    });
    if (error || !result?.[0]) throw new Error(error?.message ?? "Pipeline approval failed");
    return { id: result[0].pipeline_id, public_uid: result[0].public_uid, name: result[0].pipeline_name };
  });

export const revertPipelineToDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin",
    });
    if (!isAdmin) throw new Error("Forbidden: tenant_admin required");
    const { error } = await context.supabase.from("data_prep_pipelines")
      .update({ status: "draft", approved_at: null, approved_by: null })
      .eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: status, error } = await context.supabase.rpc("archive_data_prep_pipeline", {
      _tenant_id: data.tenant_id,
      _pipeline_id: data.id,
      _reason: "Archived from Data Prep workspace",
    });
    if (error || status !== "archived") throw new Error(error?.message ?? "Pipeline archival failed");
    return { ok: true, status };
  });

// -- Execution helpers (42-rule catalog) --
const COUNTRY_TO_ISO2: Record<string, string> = {
  "united states": "US", "usa": "US", "u.s.a.": "US", "u.s.": "US", "america": "US",
  "united kingdom": "GB", "uk": "GB", "great britain": "GB", "england": "GB",
  "india": "IN", "germany": "DE", "france": "FR", "spain": "ES", "italy": "IT",
  "japan": "JP", "china": "CN", "canada": "CA", "australia": "AU", "brazil": "BR",
  "netherlands": "NL", "switzerland": "CH", "singapore": "SG", "hong kong": "HK",
  "uae": "AE", "united arab emirates": "AE", "saudi arabia": "SA", "south africa": "ZA",
  "ireland": "IE", "sweden": "SE", "norway": "NO", "denmark": "DK", "finland": "FI",
};

function getStr(r: any, f?: string): string { return f && r[f] != null ? String(r[f]) : ""; }

function parseDateWithFormat(s: string, fmt: string): string | null {
  const v = String(s ?? "").trim(); if (!v) return null;
  const map: any = {};
  const tokenRx = /(YYYY|YY|MMM|MM|DD)/g;
  const tokens: string[] = []; let m: RegExpExecArray | null;
  while ((m = tokenRx.exec(fmt))) tokens.push(m[1]);
  const reSrc = fmt.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/YYYY/g, "(\\d{4})").replace(/YY/g, "(\\d{2})")
    .replace(/MMM/g, "([A-Za-z]{3})").replace(/MM/g, "(\\d{2})").replace(/DD/g, "(\\d{2})");
  const re = new RegExp("^" + reSrc + "$");
  const mm = v.match(re); if (!mm) return null;
  tokens.forEach((t, i) => { map[t] = mm[i + 1]; });
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  let yyyy = map.YYYY ? Number(map.YYYY) : (map.YY ? 2000 + Number(map.YY) : NaN);
  let mo = map.MM ? Number(map.MM) : (map.MMM ? months.indexOf(String(map.MMM).toLowerCase()) + 1 : NaN);
  const dd = map.DD ? Number(map.DD) : NaN;
  if (!yyyy || !mo || !dd) return null;
  const d = new Date(Date.UTC(yyyy, mo - 1, dd));
  if (
    isNaN(+d)
    || d.getUTCFullYear() !== yyyy
    || d.getUTCMonth() !== mo - 1
    || d.getUTCDate() !== dd
  ) return null;
  return d.toISOString();
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function evalFilterExpr(v: any, expr: string): boolean {
  const m = expr.trim().match(/^(=|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) return true;
  const [, op, raw] = m;
  const right = raw.replace(/^['"]|['"]$/g, "");
  const n = Number(right);
  const useNum = !Number.isNaN(n) && right !== "";
  const L = useNum ? Number(v) : String(v ?? "");
  const R: any = useNum ? n : right;
  switch (op) {
    case "=": return String(L) === String(R);
    case "!=": return String(L) !== String(R);
    case ">": return Number(L) > Number(R);
    case "<": return Number(L) < Number(R);
    case ">=": return Number(L) >= Number(R);
    case "<=": return Number(L) <= Number(R);
  }
  return true;
}

export async function applyDataPrepStep(rows: DataPrepRow[], inputStep: DataPrepStep): Promise<DataPrepRow[]> {
  const step = DataPrepStepSchema.parse(inputStep);
  const f = step.field as string | undefined;
  const setF = (r: any, val: any) => ({ ...r, [f!]: val });

  switch (step.kind) {
    // Cleanse
    case "trim": return rows.map((r) => setF(r, getStr(r, f).trim()));
    case "ltrim": return rows.map((r) => setF(r, getStr(r, f).replace(/^\s+/, "")));
    case "rtrim": return rows.map((r) => setF(r, getStr(r, f).replace(/\s+$/, "")));
    case "collapse_whitespace": return rows.map((r) => setF(r, getStr(r, f).replace(/\s+/g, " ").trim()));
    case "uppercase": return rows.map((r) => setF(r, getStr(r, f).toUpperCase()));
    case "lowercase": return rows.map((r) => setF(r, getStr(r, f).toLowerCase()));
    case "titlecase": return rows.map((r) => setF(r, getStr(r, f).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())));
    case "remove_non_printable": return rows.map((r) => setF(r, getStr(r, f).replace(/[\u0000-\u001F\u007F\u200B-\u200F\uFEFF]/g, "")));
    case "pad_left": return rows.map((r) => setF(r, getStr(r, f).padStart(step.length ?? 0, step.char || " ")));
    case "pad_right": return rows.map((r) => setF(r, getStr(r, f).padEnd(step.length ?? 0, step.char || " ")));
    case "substring": return rows.map((r) => setF(r, getStr(r, f).slice(step.start ?? 0, step.end ?? undefined)));
    case "replace": return rows.map((r) => setF(r, getStr(r, f).split(step.find ?? "").join(step.replace ?? "")));
    case "regex_replace": { const rx = safeCompile(step.pattern, "g"); return rx ? rows.map((r) => setF(r, getStr(r, f).replace(rx, step.replace ?? ""))) : rows; }

    // Cast & Parse
    case "cast_number": return rows.map((r) => { const n = Number(getStr(r, f).replace(/[, ]/g, "")); return setF(r, Number.isFinite(n) ? n : null); });
    case "cast_int": return rows.map((r) => { const n = Number(getStr(r, f).replace(/[, ]/g, "")); return setF(r, Number.isFinite(n) ? Math.round(n) : null); });
    case "cast_boolean": return rows.map((r) => {
      const value = getStr(r, f).trim().toLowerCase();
      if (["true","1","yes","y","t"].includes(value)) return setF(r, true);
      if (["false","0","no","n","f"].includes(value)) return setF(r, false);
      return setF(r, null);
    });
    case "cast_date": return rows.map((r) => { const d = new Date(String(r[f!] ?? "")); return setF(r, isNaN(+d) ? null : d.toISOString()); });
    case "parse_date_format": return rows.map((r) => setF(r, parseDateWithFormat(getStr(r, f), step.format ?? "YYYY-MM-DD")));
    case "round": return rows.map((r) => { const n = Number(r[f!]); const k = Math.pow(10, step.decimals ?? 0); return setF(r, Number.isFinite(n) ? Math.round(n * k) / k : null); });
    case "abs": return rows.map((r) => { const n = Number(r[f!]); return setF(r, Number.isFinite(n) ? Math.abs(n) : null); });

    // Structure
    case "rename": return rows.map((r) => { const c = { ...r }; if (f && step.to) { c[step.to] = c[f]; delete c[f]; } return c; });
    case "drop_columns": return rows.map((r) => { const c = { ...r }; (step.fields ?? []).forEach((x: string) => delete c[x]); return c; });
    case "select_columns": return rows.map((r) => { const c: any = {}; (step.fields ?? []).forEach((x: string) => { c[x] = r[x]; }); return c; });
    case "fill_null": return rows.map((r) => (r[f!] == null || r[f!] === "" ? setF(r, step.value) : r));
    case "coalesce": return rows.map((r) => { const v = (step.fields ?? []).map((x: string) => r[x]).find((x: any) => x != null && x !== ""); return { ...r, [step.to ?? "coalesced"]: v ?? null }; });
    case "dedupe": {
      const seen = new Set<string>(); const keys: string[] = step.fields ?? [];
      return rows.filter((r) => { const k = keys.map((x) => String(r[x] ?? "")).join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    case "sort": {
      const dir = step.direction === "desc" ? -1 : 1;
      return [...rows].sort((a, b) => {
        const left = a[f!]; const right = b[f!];
        const leftNumber = typeof left === "number" ? left : Number.NaN;
        const rightNumber = typeof right === "number" ? right : Number.NaN;
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
          return (leftNumber - rightNumber) * dir;
        }
        return String(left ?? "").localeCompare(String(right ?? "")) * dir;
      });
    }
    case "filter": { const rx = safeCompile(step.pattern); return rx && f ? rows.filter((r) => rx.test(getStr(r, f))) : rows; }
    case "filter_expr": return rows.filter((r) => f && step.expr ? evalFilterExpr(r[f], step.expr) : true);

    // Derive
    case "derive_concat": return rows.map((r) => ({ ...r, [step.to ?? "derived"]: (step.fields ?? []).map((x: string) => r[x] ?? "").join(step.separator ?? " ") }));
    case "derive_arithmetic": return rows.map((r) => {
      const a = Number(r[step.left!]); const b = Number(r[step.right!]);
      let v: number | null = null;
      if (Number.isFinite(a) && Number.isFinite(b)) {
        v = step.op === "+" ? a + b : step.op === "-" ? a - b : step.op === "*" ? a * b : step.op === "/" ? (b === 0 ? null : a / b) : null;
      }
      return { ...r, [step.to ?? "derived"]: v };
    });
    case "split": return rows.map((r) => { const parts = getStr(r, f).split(step.delimiter ?? ","); const i = Math.max(1, step.index ?? 1) - 1; return { ...r, [step.to ?? "token"]: parts[i] ?? null }; });
    case "json_extract": return rows.map((r) => {
      let v: any = r[f!];
      if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
      for (const p of String(step.path ?? "").split(".").filter(Boolean)) v = v == null ? null : v[p];
      return { ...r, [step.to ?? "extracted"]: v ?? null };
    });

    // Finance & Identifiers
    case "normalize_currency_amount": return rows.map((r) => { const s = getStr(r, f).replace(/[^\d.\-,]/g, "").replace(/,(?=\d{3}(\D|$))/g, ""); const n = Number(s.replace(",", ".")); return setF(r, Number.isFinite(n) ? n : null); });
    case "flip_sign_when": return rows.map((r) => {
      const n = Number(r[step.amount_field!]);
      const match = String(r[step.indicator_field!] ?? "").trim().toUpperCase() === String(step.indicator_value ?? "").trim().toUpperCase();
      return { ...r, [step.amount_field!]: Number.isFinite(n) ? (match ? -n : n) : null };
    });
    case "normalize_iban": return rows.map((r) => setF(r, getStr(r, f).replace(/\s+/g, "").toUpperCase()));
    case "normalize_bic": return rows.map((r) => setF(r, getStr(r, f).replace(/\s+/g, "").toUpperCase()));
    case "normalize_isin": return rows.map((r) => setF(r, getStr(r, f).replace(/\s+/g, "").toUpperCase()));
    case "normalize_country": return rows.map((r) => { const k = getStr(r, f).trim().toLowerCase(); return setF(r, COUNTRY_TO_ISO2[k] ?? (k.length === 2 ? k.toUpperCase() : getStr(r, f))); });

    // Privacy
    case "mask_pii": return rows.map((r) => { const s = getStr(r, f); const n = step.show_last ?? 4; return setF(r, s.length <= n ? s : "*".repeat(s.length - n) + s.slice(-n)); });
    case "hash_field": { const out: any[] = []; for (const r of rows) out.push(setF(r, await sha256Hex(getStr(r, f)))); return out; }
    case "redact": return rows.map((r) => setF(r, step.token ?? "[REDACTED]"));

    default: throw new Error(`Unsupported transform kind: ${step.kind}`);
  }
}

export function validateDataQualityRule(rows: DataPrepRow[], inputRule: DataQualityRule) {
  const rule = DataQualityRuleSchema.parse(inputRule);
  let failures = 0;
  const seen = new Set<unknown>();
  for (const r of rows) {
    const v = r[rule.field];
    let ok = true;
    switch (rule.kind) {
      case "not_null": ok = v !== null && v !== undefined && v !== ""; break;
      case "unique":   ok = !seen.has(v); seen.add(v); break;
      case "regex":    { const pattern = typeof rule.params?.pattern === "string" ? rule.params.pattern : null; const rx = safeCompile(pattern); ok = rx ? rx.test(String(v ?? "")) : true; break; }
      case "min":      { const limit = typeof rule.params?.value === "number" ? rule.params.value : Number.NaN; ok = typeof v === "number" && v >= limit; break; }
      case "max":      { const limit = typeof rule.params?.value === "number" ? rule.params.value : Number.NaN; ok = typeof v === "number" && v <= limit; break; }
      case "in_set":   ok = Array.isArray(rule.params?.values) ? rule.params!.values.includes(v) : true; break;
      case "is_number":ok = typeof v === "number" && Number.isFinite(v); break;
      case "is_date":  ok = !isNaN(+new Date(String(v ?? ""))); break;
      case "currency": ok = /^[A-Z]{3}$/.test(String(v ?? "")); break;
    }
    if (!ok) failures++;
  }
  return { rule_id: rule.id, field: rule.field, kind: rule.kind, severity: rule.severity ?? "warning", failures, total: rows.length };
}

export function invalidDataQualityRowIndexes(rows: DataPrepRow[], rules: DataQualityRule[]): Set<number> {
  const invalid = new Set<number>();
  const uniqueValues = new Map<string, Set<unknown>>();

  rules.forEach((rule) => {
    if (rule.kind === "unique") uniqueValues.set(rule.id, new Set<unknown>());
  });

  rows.forEach((row, index) => {
    for (const rule of rules) {
      if (rule.kind === "unique") {
        const values = uniqueValues.get(rule.id)!;
        const value = row[rule.field];
        if (values.has(value)) invalid.add(index);
        else values.add(value);
        continue;
      }
      if (validateDataQualityRule([row], rule).failures > 0) invalid.add(index);
    }
  });

  return invalid;
}

function inferValueType(values: unknown[]): InferredType {
  const populated = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (populated.length === 0) return "null";
  if (populated.every((value) => typeof value === "boolean")) return "boolean";
  if (populated.every((value) => typeof value === "number" && Number.isFinite(value))) return "number";
  if (populated.every((value) => typeof value === "string" && isDateLike(value))) return "date";
  return "string";
}

export function profileDataPrepRows(rows: DataPrepRow[]): { columns: InferredColumn[]; sample_rows: DataPrepRow[] } {
  const names = Array.from(new Set(rows.flatMap((row) => Object.keys(row ?? {}))));
  const columns = names.map((name): InferredColumn => {
    const values = rows.map((row) => row?.[name]);
    const first = values.find((value) => value !== null && value !== undefined && value !== "");
    const sample = first === undefined ? "" : String(first).slice(0, 80);
    return {
      name,
      inferred_type: inferValueType(values),
      nullable: values.some((value) => value === null || value === undefined || value === ""),
      sample,
    };
  });
  return { columns, sample_rows: rows.slice(0, 10) };
}

export const runPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: pipe, error: pErr } = await context.supabase
      .from("data_prep_pipelines").select("*")
      .eq("id", data.id).eq("tenant_id", data.tenant_id).maybeSingle();
    if (pErr || !pipe) throw new Error(pErr?.message ?? "Pipeline not found");

    const { data: run, error: rErr } = await context.supabase
      .from("data_prep_runs").insert({
        tenant_id: data.tenant_id, pipeline_id: pipe.id, triggered_by: context.userId,
      }).select("id, run_uid").single();
    if (rErr) throw new Error(rErr.message);

    try {
      let rows: DataPrepRow[] = [];
      if (pipe.source_data_source_id) {
        const { data: ups, error: uploadReadError } = await context.supabase
          .from("workspace_data_source_uploads").select("rows")
          .eq("data_source_id", pipe.source_data_source_id)
          .eq("tenant_id", data.tenant_id)
          .order("created_at", { ascending: false }).limit(1);
        if (uploadReadError) throw new Error(`Failed to read pipeline source: ${uploadReadError.message}`);
        rows = (ups?.[0]?.rows as DataPrepRow[]) ?? [];
      }
      const rowsIn = rows.length;
      for (const s of (pipe.steps as DataPrepStep[]) ?? []) rows = await applyDataPrepStep(rows, s);

      const rules = (pipe.dq_rules as DataQualityRule[]) ?? [];
      const dq = rules.map((r) => validateDataQualityRule(rows, r));
      const critical = dq.some((x) => x.failures > 0 && x.severity === "critical");
      const anyFail  = dq.some((x) => x.failures > 0);

      let finalRows = rows;
      let status: "success"|"warn"|"failed" = "success";
      if (pipe.on_failure === "block" && anyFail) status = "failed";
      else if (pipe.on_failure === "drop_rows" && anyFail) {
        const invalidIndexes = invalidDataQualityRowIndexes(rows, rules);
        finalRows = rows.filter((_row, index) => !invalidIndexes.has(index));
        status = anyFail ? "warn" : "success";
      } else if (anyFail) status = critical ? "failed" : "warn";

      if (status !== "failed" && pipe.output_data_source_id) {
        const profile = profileDataPrepRows(finalRows);
        const serialized = JSON.stringify(finalRows);
        const contentSha256 = await sha256Hex(serialized);
        const { data: outputUpload, error: outputError } = await context.supabase
          .from("workspace_data_source_uploads").insert({
          data_source_id: pipe.output_data_source_id, tenant_id: data.tenant_id,
          rows: finalRows, uploaded_by: context.userId,
          filename: `pipeline-${pipe.public_uid ?? pipe.id}-${run.run_uid}.json`,
          mime_type: "application/json",
          size_bytes: new TextEncoder().encode(serialized).byteLength,
          row_count: finalRows.length,
          columns: profile.columns as unknown as Json,
          sample_rows: profile.sample_rows,
          content_sha256: contentSha256,
        }).select("id").single();
        if (outputError || !outputUpload) {
          throw new Error(`Failed to publish pipeline output: ${outputError?.message ?? "upload was not created"}`);
        }

        const { data: updatedSource, error: sourceUpdateError } = await context.supabase
          .from("workspace_data_sources")
          .update({
            inferred_schema: profile.columns as unknown as Json,
            sample_rows: profile.sample_rows,
            row_count: finalRows.length,
            status: "ready",
            last_error: null,
          })
          .eq("id", pipe.output_data_source_id)
          .eq("tenant_id", data.tenant_id)
          .select("id")
          .single();
        if (sourceUpdateError || !updatedSource) {
          const { error: rollbackError } = await context.supabase
            .from("workspace_data_source_uploads")
            .delete()
            .eq("id", outputUpload.id)
            .eq("tenant_id", data.tenant_id);
          throw new Error(
            `Failed to refresh pipeline output source: ${sourceUpdateError?.message ?? "source was not updated"}`
            + (rollbackError ? `; output rollback also failed: ${rollbackError.message}` : ""),
          );
        }
      }

      const { error: runUpdateError } = await context.supabase.from("data_prep_runs").update({
        status, rows_in: rowsIn, rows_out: finalRows.length, dq_results: dq,
        finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      if (runUpdateError) throw new Error(`Failed to finalize pipeline run: ${runUpdateError.message}`);
      const { error: pipelineUpdateError } = await context.supabase.from("data_prep_pipelines").update({
        last_run_at: new Date().toISOString(), last_status: status, last_error: null,
      }).eq("id", pipe.id);
      if (pipelineUpdateError) throw new Error(`Failed to finalize pipeline: ${pipelineUpdateError.message}`);

      const { error: auditError } = await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId, tenant_id: data.tenant_id,
        scope: "workspace", action: "data_prep.run",
        resource_type: "data_prep_run", resource_id: run.id,
        context: { pipeline: pipe.name, status, rows_in: rowsIn, rows_out: finalRows.length, run_uid: run.run_uid },
      } as any);
      if (auditError) throw new Error(`Failed to audit pipeline run: ${auditError.message}`);

      return { run_id: run.id, run_uid: run.run_uid, status, rows_in: rowsIn, rows_out: finalRows.length, dq };
    } catch (e: any) {
      await context.supabase.from("data_prep_runs").update({
        status: "failed", error: e.message ?? String(e), finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      await context.supabase.from("data_prep_pipelines").update({
        last_run_at: new Date().toISOString(), last_status: "failed", last_error: e.message ?? String(e),
      }).eq("id", pipe.id);
      throw e;
    }
  });

export const listPipelineRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; pipeline_id?: string }) =>
    z.object({ tenant_id: z.string().uuid(), pipeline_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("data_prep_runs")
      .select("id, run_uid, pipeline_id, status, rows_in, rows_out, dq_results, error, started_at, finished_at, pipeline:data_prep_pipelines(name)")
      .eq("tenant_id", data.tenant_id).order("started_at", { ascending: false }).limit(100);
    if (data.pipeline_id) q = q.eq("pipeline_id", data.pipeline_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ─────────────────────────────────────────────────────────────
// Staging copies + 4-eyes promotion
// ─────────────────────────────────────────────────────────────

export const cloneAsStaging = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("clone_data_prep_staging", {
      _tenant_id: data.tenant_id,
      _pipeline_id: data.id,
    });
    if (error || !result?.[0]) throw new Error(error?.message ?? "Staging clone failed");
    return { id: result[0].staging_pipeline_id, public_uid: result[0].staging_public_uid };
  });

export const requestPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { staging_id: string; tenant_id: string; note?: string }) =>
    z.object({
      staging_id: z.string().uuid(),
      tenant_id: z.string().uuid(),
      note: z.string().max(500).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: status, error } = await context.supabase.rpc("request_data_prep_promotion", {
      _tenant_id: data.tenant_id,
      _staging_id: data.staging_id,
      _note: data.note ?? "",
    });
    if (error || status !== "pending") throw new Error(error?.message ?? "Promotion request failed");
    return { ok: true, status };
  });

export const approvePromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { staging_id: string; tenant_id: string; comment?: string }) =>
    z.object({
      staging_id: z.string().uuid(),
      tenant_id: z.string().uuid(),
      comment: z.string().max(500).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("decide_data_prep_promotion", {
      _tenant_id: data.tenant_id,
      _staging_id: data.staging_id,
      _approve: true,
      _comment: data.comment ?? "",
    });
    if (error || result?.[0]?.decision !== "approved") throw new Error(error?.message ?? "Promotion approval failed");
    return { ok: true, production_id: result[0].production_pipeline_id };
  });

export const rejectPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { staging_id: string; tenant_id: string; comment?: string }) =>
    z.object({
      staging_id: z.string().uuid(),
      tenant_id: z.string().uuid(),
      comment: z.string().max(500).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("decide_data_prep_promotion", {
      _tenant_id: data.tenant_id,
      _staging_id: data.staging_id,
      _approve: false,
      _comment: data.comment ?? "",
    });
    if (error || result?.[0]?.decision !== "rejected") throw new Error(error?.message ?? "Promotion rejection failed");
    return { ok: true, production_id: result[0].production_pipeline_id };
  });

export const discardStaging = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { staging_id: string; tenant_id: string }) =>
    z.object({ staging_id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: stg } = await context.supabase
      .from("data_prep_pipelines")
      .select("lifecycle_state")
      .eq("id", data.staging_id).eq("tenant_id", data.tenant_id).single();
    if (!stg || stg.lifecycle_state !== "staging") throw new Error("Not a staging copy");
    const { error } = await context.supabase.from("data_prep_pipelines")
      .delete().eq("id", data.staging_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "workspace", action: "data_prep.discard_staging",
      resource_type: "data_prep_pipeline", resource_id: data.staging_id,
      context: {},
    } as any);
    return { ok: true };
  });

export const diffStaging = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { staging_id: string; tenant_id: string }) =>
    z.object({ staging_id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: stg, error } = await context.supabase
      .from("data_prep_pipelines")
      .select("id, name, steps, dq_rules, on_failure, description, parent_pipeline_id")
      .eq("id", data.staging_id).eq("tenant_id", data.tenant_id).single();
    if (error || !stg?.parent_pipeline_id) throw new Error("Staging or parent not found");
    const { data: prod } = await context.supabase
      .from("data_prep_pipelines")
      .select("id, name, steps, dq_rules, on_failure, description, version")
      .eq("id", stg.parent_pipeline_id).single();
    const steps_added = (stg.steps as any[]).length - ((prod?.steps as any[])?.length ?? 0);
    const dq_added = (stg.dq_rules as any[]).length - ((prod?.dq_rules as any[])?.length ?? 0);
    return {
      staging: stg,
      production: prod,
      summary: {
        steps_delta: steps_added,
        dq_delta: dq_added,
        on_failure_changed: stg.on_failure !== prod?.on_failure,
        description_changed: (stg.description ?? "") !== (prod?.description ?? ""),
      },
    };
  });

export const listAffectedRecons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { pipeline_id: string; tenant_id: string }) =>
    z.object({ pipeline_id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: pipe } = await context.supabase
      .from("data_prep_pipelines")
      .select("output_data_source_id, parent_pipeline_id")
      .eq("id", data.pipeline_id).eq("tenant_id", data.tenant_id).single();
    // affected recons reference the PROD pipeline's output_data_source_id
    const parentId = pipe?.parent_pipeline_id ?? data.pipeline_id;
    const { data: prod } = await context.supabase
      .from("data_prep_pipelines").select("output_data_source_id")
      .eq("id", parentId).single();
    const outId = prod?.output_data_source_id;
    if (!outId) return [];
    const { data: recons, error } = await context.supabase
      .from("recon_definitions")
      .select("id, name, sides")
      .eq("tenant_id", data.tenant_id);
    if (error) return [];
    return (recons ?? []).filter((r: any) =>
      Array.isArray(r.sides) && r.sides.some((s: any) => s?.source_data_source_id === outId)
    ).map((r: any) => ({ id: r.id, name: r.name }));
  });
