import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260914190000_harden_recon_orchestrator.sql",
  "utf8",
);
const runtime = readFileSync("src/lib/recon-orchestrator.server.ts", "utf8");
const cronRoute = readFileSync("src/routes/api/public/cron/recon-orchestrator.ts", "utf8");
const schedules = readFileSync("src/lib/recon-schedules.functions.ts", "utf8");
const scheduleUi = readFileSync("src/components/recon-schedules-tab.tsx", "utf8");
const runHistoryUi = readFileSync("src/components/run-history-tab.tsx", "utf8");
const runDetailUi = readFileSync("src/components/recon-run-detail-dialog.tsx", "utf8");

describe("Recon Orchestrator durable control contract", () => {
  it("claims occurrences atomically and prevents concurrent runs", () => {
    expect(migration).toContain("claim_recon_schedule_run");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("recon_schedule_runs_one_running_uq");
    expect(migration).toContain("overlap_prevented");
    expect(runtime).toContain('"claim_recon_schedule_run"');
    expect(runtime).not.toContain('.from("recon_schedule_runs")\n    .insert');
  });

  it("persists bounded exponential retries and terminal audit", () => {
    expect(migration).toContain("retry_after");
    expect(migration).toContain("attempt < run_row.max_attempts");
    expect(migration).toContain("recon.schedule.run.retry_scheduled");
    expect(migration).toContain("recon.schedule.run.failed");
    expect(runtime).toContain('"finish_recon_schedule_run"');
    expect(cronRoute).toContain("retryClaimCutoff");
    expect(cronRoute).toContain('"retry"');
  });

  it("recovers missed occurrences without duplicate execution", () => {
    expect(migration).toContain("recon_schedule_runs_occurrence_attempt_uq");
    expect(migration).toContain("last_dispatched_for");
    expect(cronRoute).toContain("dueReconCronMinutes");
    expect(cronRoute).toContain("MAX_OCCURRENCES_PER_SCHEDULE");
    expect(cronRoute).toContain("occurrenceKey");
  });

  it("keeps run creation service-only and exposes retry evidence read-only", () => {
    expect(migration).toContain("REVOKE INSERT ON public.recon_schedule_runs FROM authenticated");
    expect(migration).toContain("TO service_role");
    expect(schedules).toContain("attempt, max_attempts, retry_after, superseded_by_id");
    expect(scheduleUi).toContain('queryKey: ["schedule-runs", id]');
  });

  it("offers an explicit, accessible edit action for existing schedules", () => {
    expect(scheduleUi).toContain('aria-label={`Edit schedule ${s.name}`}');
    expect(scheduleUi).toContain('onClick={() => openEdit(s)}');
    expect(scheduleUi).toContain('aria-label={`Delete schedule ${s.name}`}');
    expect(scheduleUi).toContain('aria-label={`View history for schedule ${scheduleName}`}');
    expect(schedules).toContain('.update(payload)');
    expect(schedules).toContain('.eq("tenant_id", data.tenant_id)');
    expect(scheduleUi).not.toContain('toast.error(e.message)');
    expect(scheduleUi).not.toContain('{s.last_error}');
  });

  it("keeps paused schedules clear of automatic dispatch timing and handles schedule states safely", () => {
    expect(scheduleUi).toContain("Automatic dispatch is paused.");
    expect(scheduleUi).not.toMatch(/Next (?:auto(?:matic)? )?(?:dispatch|run)[^\n]*\{[^}]*cron_expression/);
    expect(scheduleUi).toContain("schedQ.isPending");
    expect(scheduleUi).toContain("Schedule information is temporarily unavailable.");
    expect(scheduleUi).toContain("No recurring schedules are configured yet.");
    expect(scheduleUi).toContain("runsQ.isPending");
    expect(scheduleUi).toContain("Schedule history is temporarily unavailable.");
    expect(scheduleUi).not.toMatch(/one.time/i);
    expect(scheduleUi).not.toContain("Falcon Custody (BNY)");
    expect(scheduleUi).not.toContain("Falcon Nostro USD vs GL");
  });

  it("keeps the run list direct, responsive, and free of illustrative trends", () => {
    expect(runHistoryUi).toContain("overflow-x-auto");
    expect(runHistoryUi).toContain("min-w-[900px]");
    expect(runHistoryUi).toContain("q.isPending");
    expect(runHistoryUi).toContain("Run history is temporarily unavailable.");
    expect(runHistoryUi).toContain("Try again</Button>");
    expect(runHistoryUi).toContain("No runs are available in this workspace yet.");
    expect(runHistoryUi).toContain("setSelection({ definitionId: r.definition_id, runId: r.id })");
    expect(runHistoryUi).not.toContain("Trend");
    expect(runHistoryUi).not.toContain("Falcon Nostro USD vs GL");
    expect(runDetailUi).toContain("([1, 7, 14, 30, 90] as const)");
    expect(runDetailUi).toContain("definition_id: definitionId!");
    expect(runDetailUi).toContain("run_id: runId!");
  });
});
