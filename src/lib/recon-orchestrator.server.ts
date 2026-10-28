// Server-only: Rekon Orchestrator runtime.
// Executes a reconciliation for a given schedule under service-role context.
// Mirrors src/lib/recons.functions.ts `runReconDefinition` while explicitly
// checking the accountable actor's current definition run decision before claim.

import { runRecon, type ReconSpec, type SideData } from "@/lib/recon-engine";

export type OrchestratorTrigger = "cron" | "manual" | "watcher" | "retry";

export interface OrchestratorExecutionOptions {
  scheduledFor?: string;
  occurrenceKey?: string;
  attempt?: number;
  parentScheduleRunId?: number;
}

interface ScheduleRunClaim {
  schedule_run_id: number | string | null;
  disposition: "claimed" | "duplicate" | "overlap" | "disabled";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface OrchestratorResult {
  schedule_id: string;
  schedule_run_id: number | null;
  recon_run_id: string | null;
  matched: number;
  exceptions: number;
  total_rows: number;
  ok: boolean;
  disposition: "completed" | "failed" | "duplicate" | "overlap" | "disabled";
  error?: string;
}

/**
 * Run a reconciliation by schedule id using the service-role client.
 * Writes a recon_run row, persists matches/exceptions, updates the schedule
 * stats, appends to recon_schedule_runs, and emits an audit log entry.
 */
export async function executeReconSchedule(
  scheduleId: string,
  expectedTenantId: string,
  trigger: OrchestratorTrigger,
  actorUserId?: string | null,
  options: OrchestratorExecutionOptions = {},
): Promise<OrchestratorResult> {
  if (!expectedTenantId) throw new Error("Expected reconciliation tenant is required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Look up schedule + definition
  const { data: sched, error: sErr } = await supabaseAdmin
    .from("recon_schedules")
    .select("id, tenant_id, definition_id, enabled, name, created_by")
    .eq("id", scheduleId)
    .eq("tenant_id", expectedTenantId)
    .maybeSingle();
  if (sErr || !sched) throw new Error(sErr?.message ?? "Schedule not found");

  const decisionActorId = actorUserId ?? sched.created_by;
  if (!decisionActorId) throw new Error("An accountable reconciliation actor is required");

  // Read and authorize the exact definition before the schedule claim (which
  // mutates retry/dispatch state) or any run/result writes. Service-role RLS
  // bypass makes this explicit actor-bound decision mandatory.
  const { data: def, error: dErr } = await supabaseAdmin
    .from("recon_definitions")
    .select("*")
    .eq("id", sched.definition_id)
    .eq("tenant_id", sched.tenant_id)
    .maybeSingle();
  if (dErr || !def) throw new Error(dErr?.message ?? "Definition not found");
  const { data: canRun, error: accessError } = await supabaseAdmin.rpc(
    "service_recon_actor_access_decision" as never,
    { _actor_user_id: decisionActorId, _recon_id: def.id, _action: "run" } as never,
  );
  if (accessError || canRun !== true) throw new Error("Reconciliation run is not authorized");

  const scheduledFor = options.scheduledFor ?? new Date().toISOString();
  const occurrenceKey = options.occurrenceKey ?? `${trigger}:${crypto.randomUUID()}`;
  const attempt = options.attempt ?? 1;
  const { data: claimRows, error: claimError } = await supabaseAdmin.rpc(
    "claim_recon_schedule_run_for_definition" as never,
    {
      _tenant_id: sched.tenant_id,
      _definition_id: def.id,
      _schedule_id: sched.id,
      _trigger: trigger,
      _scheduled_for: scheduledFor,
      _occurrence_key: occurrenceKey,
      _attempt: attempt,
      _actor_user_id: decisionActorId,
      _parent_run_id: options.parentScheduleRunId ?? null,
    } as never,
  );
  if (claimError) throw new Error(claimError.message);
  const claim = (claimRows as unknown as ScheduleRunClaim[] | null)?.[0];
  const claimDisposition = claim?.disposition;
  const scheduleRunId = claim?.schedule_run_id == null ? null : Number(claim.schedule_run_id);

  const result: OrchestratorResult = {
    schedule_id: sched.id,
    schedule_run_id: scheduleRunId,
    recon_run_id: null,
    matched: 0,
    exceptions: 0,
    total_rows: 0,
    ok: false,
    disposition: "failed",
  };

  if (claimDisposition !== "claimed") {
    result.disposition = claimDisposition ?? "failed";
    result.ok = claimDisposition === "duplicate";
    result.error = claimDisposition === "overlap"
      ? "A reconciliation run is already active; this occurrence was queued for retry."
      : claimDisposition === "disabled"
        ? "Schedule is disabled."
        : undefined;
    return result;
  }
  if (scheduleRunId === null) throw new Error("Orchestrator claim did not return a run id");

  try {
    const { data: runRows, error: rErr } = await supabaseAdmin.rpc(
      "create_recon_run_for_actor" as never,
      { _tenant_id: sched.tenant_id, _definition_id: def.id, _actor_user_id: decisionActorId } as never,
    );
    const run = (runRows as unknown as Array<{ id: string }> | null)?.[0];
    if (rErr || !run) throw new Error(rErr?.message ?? "Reconciliation run was not created");
    result.recon_run_id = run.id;

    // Latest upload per side
    const sides = def.sides as any[];
    const sideData: SideData[] = [];
    for (const s of sides) {
      const { data: ups } = await supabaseAdmin
        .from("workspace_data_source_uploads")
        .select("id, rows")
        .eq("data_source_id", s.data_source_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const up = ups?.[0];
      sideData.push({ side_id: s.side_id, rows: (up?.rows as any[]) ?? [] });
    }

    const { hydrateManagedReferenceRules } = await import("@/lib/reference-data-resolver.server");
    const referenceResolution = await hydrateManagedReferenceRules(
      supabaseAdmin,
      sched.tenant_id,
      def.rules as unknown as ReconSpec["rules"],
      "service",
    );

    const spec: ReconSpec = {
      recon_type: def.recon_type as any,
      sides: sides as any,
      rules: referenceResolution.rules,
    };
    const reconResult = runRecon(spec, sideData);
    reconResult.stats.reference_versions = referenceResolution.evidence;

    const matchRows = reconResult.matches.map((m) => ({
      run_id: run.id,
      tenant_id: sched.tenant_id,
      rule_id: m.rule_id,
      cardinality: m.cardinality,
      members: m.members,
      score: m.score,
    }));
    for (let i = 0; i < matchRows.length; i += 500) {
      const slice = matchRows.slice(i, i + 500);
      if (slice.length) {
        const { error } = await supabaseAdmin.from("recon_matches").insert(slice as any);
        if (error) throw new Error(error.message);
      }
    }

    const excRows = reconResult.exceptions.map((e) => ({
      run_id: run.id,
      tenant_id: sched.tenant_id,
      side: e.side ?? null,
      reason: e.reason,
      severity: e.severity,
      status: "open",
      payload: e.payload,
    }));
    for (let i = 0; i < excRows.length; i += 500) {
      const slice = excRows.slice(i, i + 500);
      if (slice.length) {
        const { error } = await supabaseAdmin.from("recon_exceptions").insert(slice as any);
        if (error) throw new Error(error.message);
      }
    }

    await supabaseAdmin
      .from("recon_runs")
      .update({
        status: "completed",
        matched_count: reconResult.matches.length,
        exception_count: reconResult.exceptions.length,
        total_rows: reconResult.stats.total_rows,
        stats: reconResult.stats,
        completed_at: new Date().toISOString(),
      } as any)
      .eq("id", run.id);

    result.matched = reconResult.matches.length;
    result.exceptions = reconResult.exceptions.length;
    result.total_rows = reconResult.stats.total_rows;
    result.ok = true;
    result.disposition = "completed";

    const { error: finishError } = await supabaseAdmin.rpc("finish_recon_schedule_run" as never, {
      _schedule_run_id: scheduleRunId,
      _status: "completed",
      _recon_run_id: run.id,
      _matched_count: result.matched,
      _exception_count: result.exceptions,
      _total_rows: result.total_rows,
      _error: null,
      _context: {
        definition_id: def.id,
        reference_versions: referenceResolution.evidence,
      },
    } as never);
    if (finishError) throw new Error(finishError.message);

    return result;
  } catch (err: unknown) {
    const msg = errorMessage(err);
    result.error = msg.slice(0, 1000);
    result.disposition = "failed";
    if (result.recon_run_id) {
      await supabaseAdmin
        .from("recon_runs")
        .update({
          status: "failed",
          error: msg,
          completed_at: new Date().toISOString(),
        } as any)
        .eq("id", result.recon_run_id);
    }
    const { error: finishError } = await supabaseAdmin.rpc("finish_recon_schedule_run" as never, {
      _schedule_run_id: scheduleRunId,
      _status: "failed",
      _recon_run_id: result.recon_run_id,
      _matched_count: 0,
      _exception_count: 0,
      _total_rows: 0,
      _error: result.error,
      _context: { trigger },
    } as never);
    if (finishError) result.error = `${result.error}; terminal update failed`;
    return result;
  }
}
