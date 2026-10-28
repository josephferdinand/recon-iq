import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { authorizeTenantApiRequest, workflowApiCors, workflowApiJson } from "@/lib/public-workflow-api.server";
import { publicApiRequestContext, writePublicApiAudit } from "@/lib/public-resource-api.server";

export const PUBLIC_REPORTS = Object.freeze([
  { id: "standard-operations", name: "Reconciliation operations", formats: ["json", "csv"] },
  { id: "standard-break-risk", name: "Break risk and aging", formats: ["json", "csv"] },
  { id: "standard-full", name: "Full reconciliation assurance", formats: ["json", "csv"] },
]);

const reportRequest = z.object({
  days: z.number().int().min(7).max(180).default(30),
  lifecycle: z.array(z.enum(["new", "assigned", "investigating", "pending_counterparty", "resolved", "written_off"])).max(6).optional(),
  priority: z.array(z.enum(["P1", "P2", "P3", "P4"])).max(4).optional(),
});

function csvCell(value: unknown) {
  const raw = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const text = typeof value === "string" && /^[=+@-]/u.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "\n";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `${columns.map(csvCell).join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

type ReportRun = {
  id: string;
  definition_id: string;
  started_at: string;
  completed_at: string | null;
  matched_count: number;
  exception_count: number;
  total_rows: number;
  status: string;
  definition: unknown;
};

type ReportBreak = {
  id: string;
  run_id: string;
  reason: string;
  severity: string;
  status: string;
  lifecycle_state: string;
  priority: string;
  due_date: string | null;
  root_cause: string | null;
  assignee: string | null;
  created_at: string;
  resolved_at: string | null;
};

async function buildReport(admin: SupabaseClient, tenantId: string, input: z.infer<typeof reportRequest>) {
  const since = new Date(Date.now() - input.days * 86_400_000).toISOString();
  const [runsResult, exceptionsResult] = await Promise.all([
    admin.from("recon_runs")
      .select("id,definition_id,started_at,completed_at,matched_count,exception_count,total_rows,status,definition:recon_definitions(name)")
      .eq("tenant_id", tenantId).gte("started_at", since).order("started_at", { ascending: false }).limit(5000),
    admin.from("recon_exceptions")
      .select("id,run_id,reason,severity,status,lifecycle_state,priority,due_date,root_cause,assignee,created_at,resolved_at")
      .eq("tenant_id", tenantId).gte("created_at", since).order("created_at", { ascending: false }).limit(10000),
  ]);
  if (runsResult.error || exceptionsResult.error) throw new Error("report_lookup_unavailable");
  const runs = (runsResult.data ?? []) as ReportRun[];
  let exceptions = (exceptionsResult.data ?? []) as ReportBreak[];
  if (input.lifecycle?.length) exceptions = exceptions.filter((row) => input.lifecycle!.includes(row.lifecycle_state as never));
  if (input.priority?.length) exceptions = exceptions.filter((row) => input.priority!.includes(row.priority as never));
  const matched = runs.reduce((sum, row) => sum + Number(row.matched_count ?? 0), 0);
  const reportedExceptions = runs.reduce((sum, row) => sum + Number(row.exception_count ?? 0), 0);
  const completed = runs.filter((row) => ["completed", "succeeded"].includes(row.status)).length;
  const failed = runs.filter((row) => row.status === "failed").length;
  const open = exceptions.filter((row) => !["resolved", "written_off"].includes(row.lifecycle_state) && !["resolved", "wont_fix"].includes(row.status));
  const overdue = open.filter((row) => row.due_date && Date.parse(row.due_date) < Date.now());
  const denominator = matched + reportedExceptions;
  return {
    generated_at: new Date().toISOString(),
    window_days: input.days,
    filters: { lifecycle: input.lifecycle ?? [], priority: input.priority ?? [] },
    operations: {
      runs: runs.length,
      completed,
      failed,
      matched,
      exceptions: reportedExceptions,
      match_rate_pct: denominator ? Math.round((matched / denominator) * 1000) / 10 : 0,
    },
    risk: {
      open_breaks: open.length,
      overdue: overdue.length,
      critical: open.filter((row) => row.severity === "critical").length,
      high: open.filter((row) => row.severity === "high").length,
    },
    runs,
    breaks: exceptions,
  };
}

export async function listPublicReports(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({ request, tenantSlug, requiredScope: "reports.read", methods: "GET" });
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin.from("tenant_report_definitions")
    .select("id,name,description,category,format,is_active,last_run_at,updated_at")
    .eq("tenant_id", auth.principal.tenantId).order("name");
  if (error) return workflowApiJson(503, { error: "report_catalog_unavailable" }, auth.cors);
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug, action: "api.report.list", resourceType: "report", resourceId: null, context: publicApiRequestContext(request) });
  } catch { return workflowApiJson(503, { error: "report_audit_unavailable" }, auth.cors); }
  return workflowApiJson(200, { standard: PUBLIC_REPORTS, saved: data ?? [] }, auth.cors);
}

export async function runPublicReport(request: Request, tenantSlug: string, reportId: string) {
  const auth = await authorizeTenantApiRequest({ request, tenantSlug, requiredScope: "reports.read", methods: "POST" });
  if (!auth.ok) return auth.response;
  if (!PUBLIC_REPORTS.some((report) => report.id === reportId)) {
    return workflowApiJson(404, { error: "executable_report_not_found" }, auth.cors);
  }
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return workflowApiJson(400, { error: "invalid_json" }, auth.cors);
  }
  const parsed = reportRequest.safeParse(raw);
  if (!parsed.success) return workflowApiJson(422, { error: "validation_error", details: parsed.error.flatten() }, auth.cors);
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (!/^(json|csv)$/u.test(format)) return workflowApiJson(422, { error: "unsupported_format", supported: ["json", "csv"] }, auth.cors);
  let full;
  try { full = await buildReport(auth.admin, auth.principal.tenantId, parsed.data); }
  catch { return workflowApiJson(503, { error: "report_generation_unavailable" }, auth.cors); }
  const payload = reportId === "standard-operations"
    ? [{ generated_at: full.generated_at, window_days: full.window_days, ...full.operations }]
    : reportId === "standard-break-risk"
      ? full.breaks
      : [full];
  try {
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.report.run",
      resourceType: "report",
      resourceId: reportId,
      context: { format, days: parsed.data.days, row_count: payload.length, ...publicApiRequestContext(request) },
    });
  } catch {
    return workflowApiJson(503, { error: "report_audit_unavailable" }, auth.cors);
  }
  const filename = `fvi-${reportId}-${new Date().toISOString().slice(0, 10)}.${format}`;
  if (format === "csv") {
    return new Response(rowsToCsv(payload as Record<string, unknown>[]), {
      status: 200,
      headers: {
        ...auth.cors,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  return workflowApiJson(200, { report_id: reportId, data: payload }, {
    ...auth.cors,
    "content-disposition": `attachment; filename="${filename}"`,
  });
}

export function publicReportCors(request: Request, methods: string) {
  return workflowApiCors(request, methods);
}
