import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { connectorExecutionMode } from "@/lib/connectors.functions";

// Invoked by pg_cron every minute. Picks schedules whose cron expression matches the current minute
// (basic minute/hour/dow/dom match — no seconds, no per-second math).
function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const s = Number(step);
      if (range === "*") { if (value % s === 0) return true; continue; }
      const [a, b] = range.split("-").map(Number);
      for (let v = a; v <= (b ?? a); v += s) if (v === value) return true;
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (value >= a && value <= b) return true;
    } else if (Number(part) === value) return true;
  }
  return false;
}

function cronMatches(expr: string, d: Date): boolean {
  const [mi, ho, dom, mo, dow] = expr.trim().split(/\s+/);
  return (
    fieldMatches(mi, d.getUTCMinutes()) &&
    fieldMatches(ho, d.getUTCHours()) &&
    fieldMatches(dom, d.getUTCDate()) &&
    fieldMatches(mo, d.getUTCMonth() + 1) &&
    fieldMatches(dow, d.getUTCDay())
  );
}

export function scheduledConnectorAgentIdempotencyKey(scheduleId: string, date: Date) {
  const minute = date.toISOString().slice(0, 16);
  return `cron-agent-${scheduleId}-${minute}`;
}

export const Route = createFileRoute("/api/public/cron/run-schedules")({
  server: {
    handlers: {
      POST: async ({ request }) => { const _unauth = verifyCronSecret(request); if (_unauth) return _unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runSchedule } = await import("@/lib/connectors.server");
        const { data: schedules } = await supabaseAdmin
          .from("data_source_schedules").select("id, tenant_id, connector_type, cron_expression, enabled, created_by")
          .eq("enabled", true);
        const now = new Date();
        const due = (schedules ?? []).filter((s: any) => cronMatches(s.cron_expression, now));
        const results: any[] = [];
        for (const s of due) {
          try {
            if (connectorExecutionMode(s.connector_type) === "agent_required") {
              if (!s.created_by) throw new Error("Agent schedule has no accountable creator");
              const admin = supabaseAdmin as unknown as SupabaseClient;
              const { data: queued, error } = await admin.rpc("enqueue_workflow_api_job", {
                _tenant_id: s.tenant_id,
                _token_id: null,
                _actor_user_id: s.created_by,
                _job_kind: "connector_run",
                _resource_id: s.id,
                _idempotency_key: scheduledConnectorAgentIdempotencyKey(s.id, now),
              });
              if (error || !queued?.[0]) throw new Error(error?.message ?? "Agent queue unavailable");
              results.push({ id: s.id, ok: true, queued: true, job_id: queued[0].job_id });
              continue;
            }
            const r = await runSchedule(s.id, s.tenant_id, "cron");
            results.push({ id: s.id, ok: true, rows: r.rows });
          } catch (e: any) {
            results.push({ id: s.id, ok: false, error: e.message });
          }
        }
        return Response.json({ checked: schedules?.length ?? 0, executed: results.length, results });
      },
    },
  },
});
