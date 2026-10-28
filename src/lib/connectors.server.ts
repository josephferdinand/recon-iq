// Server-only: executes scheduled data-source pulls.
// Supports HTTP(S)/REST pulls today. Other connector kinds are retained as
// configuration records but fail closed until their governed adapters exist.
import type { TransformStep } from "@/lib/connectors.functions";
import { connectorExecutionMode } from "@/lib/connectors.functions";
import { safeFetch, assertSafeOutboundUrl } from "@/lib/ssrf-guard.server";

export const DIRECT_HTTP_CONNECTOR_TYPES = ["http", "https", "rest"] as const;

export function supportsDirectHttpPull(connectorType: string): boolean {
  return (DIRECT_HTTP_CONNECTOR_TYPES as readonly string[]).includes(connectorType);
}

export type ConnectorRunAuditContext = {
  actorUserId?: string;
  workflowJobId?: string;
  apiTokenId?: string;
};

export function connectorRunAuditRecord(
  tenantId: string,
  scheduleId: string,
  rows: number,
  trigger: "cron" | "manual",
  auditContext: ConnectorRunAuditContext = {},
) {
  return {
    actor_user_id: auditContext.actorUserId ?? null,
    tenant_id: tenantId,
    scope: "workspace",
    action: "connector.run",
    resource_type: "data_source_schedules",
    resource_id: scheduleId,
    context: {
      rows,
      trigger,
      ...(auditContext.workflowJobId ? { workflow_job_id: auditContext.workflowJobId } : {}),
      ...(auditContext.apiTokenId ? { api_token_id: auditContext.apiTokenId } : {}),
    },
  };
}

function applyTransforms(rows: any[], steps: TransformStep[]): any[] {
  let out = rows.slice();
  for (const s of steps) {
    if (s.op === "drop")
      out = out.map((r) => {
        const c = { ...r };
        delete c[s.column];
        return c;
      });
    else if (s.op === "rename")
      out = out.map((r) => {
        const c = { ...r };
        c[s.to] = c[s.from];
        delete c[s.from];
        return c;
      });
    else if (s.op === "trim")
      out = out.map((r) => ({ ...r, [s.column]: String(r[s.column] ?? "").trim() }));
    else if (s.op === "upper")
      out = out.map((r) => ({ ...r, [s.column]: String(r[s.column] ?? "").toUpperCase() }));
    else if (s.op === "lower")
      out = out.map((r) => ({ ...r, [s.column]: String(r[s.column] ?? "").toLowerCase() }));
    else if (s.op === "cast") {
      out = out.map((r) => {
        const v = r[s.column];
        let nv: any = v;
        if (s.to === "number") nv = Number(v);
        else if (s.to === "string") nv = v == null ? "" : String(v);
        else if (s.to === "boolean")
          nv = String(v).toLowerCase() === "true" || v === 1 || v === "1";
        else if (s.to === "date") {
          const d = new Date(v);
          nv = isNaN(+d) ? null : d.toISOString();
        }
        return { ...r, [s.column]: nv };
      });
    } else if (s.op === "filter") {
      // Simple equality / op filter: "= 'x'", "> 100", "!= null"
      const expr = s.expr.trim();
      const m = expr.match(/^(=|!=|>|<|>=|<=)\s*(.+)$/);
      if (m) {
        const [, op, rawVal] = m;
        const val = rawVal.replace(/^['"]|['"]$/g, "");
        const num = Number(val);
        out = out.filter((r) => {
          const v = r[s.column];
          const right: any = !Number.isNaN(num) && val !== "" ? num : val === "null" ? null : val;
          switch (op) {
            case "=":
              return String(v) === String(right);
            case "!=":
              return String(v) !== String(right);
            case ">":
              return Number(v) > Number(right);
            case "<":
              return Number(v) < Number(right);
            case ">=":
              return Number(v) >= Number(right);
            case "<=":
              return Number(v) <= Number(right);
          }
          return true;
        });
      }
    } else if (s.op === "derive") {
      // tiny safe expression: only concat columns with "+" -- e.g. "first_name + ' ' + last_name"
      const parts = s.expression.split("+").map((p) => p.trim());
      out = out.map((r) => {
        const v = parts
          .map((p) => {
            if (/^['"].*['"]$/.test(p)) return p.slice(1, -1);
            return r[p] ?? "";
          })
          .join("");
        return { ...r, [s.column]: v };
      });
    }
  }
  return out;
}

async function fetchHttp(config: any): Promise<{ rows: any[]; columns: string[] }> {
  const url = String(config.url ?? "");
  if (!/^https?:\/\//i.test(url)) throw new Error("Invalid http url");
  assertSafeOutboundUrl(url);
  const headers: Record<string, string> = config.headers ?? {};
  const r = await safeFetch(url, { headers, method: config.method ?? "GET" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const j = await r.json();
    const arr = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
    const columns = Array.from(new Set(arr.flatMap((x: any) => Object.keys(x ?? {})))) as string[];
    return { rows: arr, columns };
  }
  // CSV fallback
  const text = await r.text();
  const { parseCsv } = await import("@/lib/csv-parse");
  const p = parseCsv(text);
  return { rows: p.rows, columns: p.columns.map((column) => column.name) };
}

export async function runSchedule(
  scheduleId: string,
  tenantId: string,
  trigger: "cron" | "manual",
  auditContext: ConnectorRunAuditContext = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: schedule, error } = await supabaseAdmin
    .from("data_source_schedules")
    .select("*")
    .eq("id", scheduleId)
    .single();
  if (error || !schedule) throw new Error(error?.message ?? "Schedule not found");
  // Tenant ownership guard — service-role bypasses RLS; enforce isolation in code.
  if (schedule.tenant_id !== tenantId) throw new Error("Forbidden: schedule/tenant mismatch");

  const { data: run, error: runErr } = await supabaseAdmin
    .from("data_source_runs")
    .insert({ schedule_id: scheduleId, tenant_id: tenantId, status: "running", trigger })
    .select()
    .single();
  if (runErr) throw new Error(runErr.message);

  try {
    let fetched: { rows: any[]; columns: string[] };
    if (supportsDirectHttpPull(schedule.connector_type)) {
      fetched = await fetchHttp(schedule.config);
    } else if (schedule.connector_type === "manual")
      throw new Error("Manual schedules cannot run automatically");
    else if (connectorExecutionMode(schedule.connector_type) === "remote_gateway") {
      const { pullWithConnectorGateway } = await import("@/lib/connector-gateway-service.server");
      fetched = await pullWithConnectorGateway({
        admin: supabaseAdmin,
        tenantId,
        connectorType: schedule.connector_type,
        config: schedule.config as Record<string, unknown>,
      });
    } else throw new Error(`${schedule.connector_type} pull is not supported`);

    const transformed = applyTransforms(
      fetched.rows,
      (schedule.transformation as TransformStep[]) ?? [],
    );
    const cols = Array.from(new Set(transformed.flatMap((r) => Object.keys(r ?? {})))) as string[];

    // Hash content for dedupe
    const encoder = new TextEncoder();
    const buf = encoder.encode(JSON.stringify(transformed));
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    const hex = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { error: uploadErr } = await supabaseAdmin.from("workspace_data_source_uploads").insert({
      data_source_id: schedule.data_source_id,
      tenant_id: tenantId,
      filename: `${schedule.name}-${new Date().toISOString()}.json`,
      mime_type: "application/json",
      size_bytes: buf.length,
      row_count: transformed.length,
      columns: cols,
      sample_rows: transformed.slice(0, 10),
      rows: transformed.slice(0, 50000),
      content_sha256: hex,
    } as any);
    if (uploadErr) throw new Error(uploadErr.message);

    const { error: scheduleErr } = await supabaseAdmin
      .from("data_source_schedules")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: "success",
        last_rows_ingested: transformed.length,
        last_error: null,
      })
      .eq("id", scheduleId);
    if (scheduleErr) throw new Error(scheduleErr.message);

    const { error: finishErr } = await supabaseAdmin
      .from("data_source_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        rows_ingested: transformed.length,
      })
      .eq("id", run.id);
    if (finishErr) throw new Error(finishErr.message);

    await supabaseAdmin
      .from("audit_log")
      .insert(
        connectorRunAuditRecord(
          tenantId,
          scheduleId,
          transformed.length,
          trigger,
          auditContext,
        ) as never,
      );

    return { ok: true, rows: transformed.length };
  } catch (e: any) {
    await supabaseAdmin
      .from("data_source_schedules")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: "failed",
        last_error: e.message ?? "error",
      })
      .eq("id", scheduleId);
    await supabaseAdmin
      .from("data_source_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "failed",
        error: e.message ?? "error",
      })
      .eq("id", run.id);
    throw e;
  }
}
