import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { safeErrorResponse, safeSupabaseError } from "@/lib/safe-error.server";
import { dueReconCronMinutes } from "@/lib/recon-cron";
import type { OrchestratorResult } from "@/lib/recon-orchestrator.server";

const PATH = "/api/public/cron/recon-orchestrator";

// Rekon Orchestrator: invoked by pg_cron once per minute.
// Recovers bounded missed occurrences, claims each occurrence atomically and
// drains persisted retries before dispatching new work.

const MAX_RETRIES_PER_TICK = 10;
const MAX_OCCURRENCES_PER_SCHEDULE = 20;

interface RetryCandidate {
  id: number | string;
  schedule_id: string;
  tenant_id: string;
  actor_user_id: string | null;
  scheduled_for: string;
  occurrence_key: string;
  attempt: number;
  max_attempts: number;
}

interface ScheduleRecord {
  id: string;
  tenant_id: string;
  cron_expression: string;
  last_dispatched_for: string;
  catch_up_window_minutes: number;
}

type TickResult = OrchestratorResult | {
  schedule_id: string;
  ok: false;
  disposition: "failed";
  error: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const Route = createFileRoute("/api/public/cron/recon-orchestrator")({
  server: {
    handlers: {
      POST: async ({ request }) => { const _unauth = verifyCronSecret(request); if (_unauth) return _unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { executeReconSchedule } = await import("@/lib/recon-orchestrator.server");

        const now = new Date();
        now.setUTCSeconds(0, 0);
        const retryClaimCutoff = new Date(now.getTime() - 5 * 60_000).toISOString();
        const { data: retryCandidates, error: retryError } = await supabaseAdmin
          .from("recon_schedule_runs")
          .select("*")
          .eq("status", "failed")
          .is("superseded_by_id" as never, null)
          .not("retry_after" as never, "is", null)
          .lte("retry_after" as never, now.toISOString())
          .or(`retry_claimed_at.is.null,retry_claimed_at.lt.${retryClaimCutoff}`)
          .order("retry_after" as never, { ascending: true })
          .limit(MAX_RETRIES_PER_TICK);
        if (retryError) {
          return safeErrorResponse(safeSupabaseError(retryError, { path: PATH }));
        }

        const retryResults: OrchestratorResult[] = [];
        for (const candidate of ((retryCandidates ?? []) as unknown as RetryCandidate[]).filter(
          (row) => Number(row.attempt) < Number(row.max_attempts),
        )) {
          // The executor authorizes the persisted actor before claim_recon_schedule_run
          // atomically claims and supersedes this retry parent. Avoid a service-role
          // lease write here before the definition-level run decision.
          const retried = await executeReconSchedule(candidate.schedule_id, candidate.tenant_id, "retry", candidate.actor_user_id, {
            scheduledFor: candidate.scheduled_for,
            occurrenceKey: candidate.occurrence_key,
            attempt: Number(candidate.attempt) + 1,
            parentScheduleRunId: Number(candidate.id),
          });
          retryResults.push(retried);
        }

        const { data: schedules, error } = await supabaseAdmin
          .from("recon_schedules")
          .select("*")
          .eq("enabled", true);

        if (error) {
          return safeErrorResponse(safeSupabaseError(error, { path: PATH }));
        }

        const results: TickResult[] = [];
        let dueCount = 0;
        const scheduleRows = (schedules ?? []) as unknown as ScheduleRecord[];
        for (const schedule of scheduleRows) {
          const catchUpFloor = new Date(
            now.getTime() - Number(schedule.catch_up_window_minutes ?? 60) * 60_000,
          );
          const lastDispatched = new Date(schedule.last_dispatched_for ?? now);
          const after = lastDispatched > catchUpFloor ? lastDispatched : catchUpFloor;
          const due = dueReconCronMinutes(
            schedule.cron_expression,
            after,
            now,
            MAX_OCCURRENCES_PER_SCHEDULE,
          );
          dueCount += due.length;
          for (const scheduledFor of due) {
            try {
              const occurrenceKey = `cron:${scheduledFor.toISOString()}`;
              results.push(await executeReconSchedule(schedule.id, schedule.tenant_id, "cron", null, {
                scheduledFor: scheduledFor.toISOString(),
                occurrenceKey,
              }));
            } catch (e: unknown) {
              results.push({
                schedule_id: schedule.id,
                ok: false,
                disposition: "failed",
                error: errorMessage(e).slice(0, 500),
              });
            }
          }
        }

        return Response.json({
          checked: scheduleRows.length,
          due: dueCount,
          executed: results.length,
          retries: retryResults.length,
          completed: [...retryResults, ...results].filter((result) => result.disposition === "completed").length,
          failed: [...retryResults, ...results].filter((result) => result.disposition === "failed").length,
          overlap_prevented: [...retryResults, ...results].filter((result) => result.disposition === "overlap").length,
          results,
          retry_results: retryResults,
          ts: now.toISOString(),
        });
      },
    },
  },
});
