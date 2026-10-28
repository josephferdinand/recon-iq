import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyDataPrepStep,
  invalidDataQualityRowIndexes,
  profileDataPrepRows,
  validateDataQualityRule,
  type DataPrepRow,
  type DataPrepStep,
  type DataQualityRule,
} from "@/lib/data-prep.functions";
import { runRecon, type ReconSpec, type SideData } from "@/lib/recon-engine";

type WorkflowJob = {
  id: string;
  tenant_id: string;
  token_id: string;
  actor_user_id: string;
  job_kind: "data_prep_run" | "recon_run" | "connector_run";
  resource_id: string;
  attempts: number;
  max_attempts: number;
};

async function must<T>(operation: PromiseLike<{ data: T; error: { message: string } | null }>, label: string) {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function executeDataPrepJob(sb: SupabaseClient, job: WorkflowJob) {
  const pipe = await must(
    sb.from("data_prep_pipelines").select("*").eq("id", job.resource_id).eq("tenant_id", job.tenant_id).maybeSingle(),
    "pipeline lookup failed",
  );
  if (!pipe) throw new Error("pipeline not found");
  const run = await must(
    sb.from("data_prep_runs").insert({
      tenant_id: job.tenant_id,
      pipeline_id: pipe.id,
      triggered_by: job.actor_user_id,
      trigger: "api",
    }).select("id,run_uid").single(),
    "pipeline run creation failed",
  );
  if (!run) throw new Error("pipeline run was not created");

  try {
    let rows: DataPrepRow[] = [];
    if (pipe.source_data_source_id) {
      const uploads = await must(
        sb.from("workspace_data_source_uploads")
          .select("rows")
          .eq("data_source_id", pipe.source_data_source_id)
          .eq("tenant_id", job.tenant_id)
          .order("created_at", { ascending: false })
          .limit(1),
        "pipeline source read failed",
      );
      rows = (uploads?.[0]?.rows as DataPrepRow[] | undefined) ?? [];
    }
    const rowsIn = rows.length;
    for (const step of (pipe.steps as DataPrepStep[] | null) ?? []) {
      rows = await applyDataPrepStep(rows, step);
    }
    const rules = (pipe.dq_rules as DataQualityRule[] | null) ?? [];
    const dq = rules.map((rule) => validateDataQualityRule(rows, rule));
    const anyFailure = dq.some((result) => result.failures > 0);
    const criticalFailure = dq.some(
      (result) => result.failures > 0 && result.severity === "critical",
    );
    let finalRows = rows;
    let workflowStatus: "success" | "warn" | "failed" = "success";
    if (pipe.on_failure === "block" && anyFailure) workflowStatus = "failed";
    else if (pipe.on_failure === "drop_rows" && anyFailure) {
      const invalid = invalidDataQualityRowIndexes(rows, rules);
      finalRows = rows.filter((_row, index) => !invalid.has(index));
      workflowStatus = "warn";
    } else if (anyFailure) workflowStatus = criticalFailure ? "failed" : "warn";

    if (workflowStatus !== "failed" && pipe.output_data_source_id) {
      const profile = profileDataPrepRows(finalRows);
      const serialized = JSON.stringify(finalRows);
      const hash = createHash("sha256").update(serialized).digest("hex");
      await must(
        sb.from("workspace_data_source_uploads").insert({
          data_source_id: pipe.output_data_source_id,
          tenant_id: job.tenant_id,
          filename: `pipeline-${pipe.public_uid ?? pipe.id}-${run.run_uid}.json`,
          mime_type: "application/json",
          size_bytes: Buffer.byteLength(serialized),
          row_count: finalRows.length,
          columns: profile.columns,
          sample_rows: profile.sample_rows,
          rows: finalRows,
          content_sha256: hash,
          uploaded_by: job.actor_user_id,
        } as never),
        "pipeline output publish failed",
      );
      await must(
        sb.from("workspace_data_sources").update({
          inferred_schema: profile.columns,
          sample_rows: profile.sample_rows,
          row_count: finalRows.length,
          status: "ready",
          last_error: null,
        } as never).eq("id", pipe.output_data_source_id).eq("tenant_id", job.tenant_id),
        "pipeline output source refresh failed",
      );
    }

    const completedAt = new Date().toISOString();
    await must(
      sb.from("data_prep_runs").update({
        status: workflowStatus,
        rows_in: rowsIn,
        rows_out: finalRows.length,
        dq_results: dq,
        finished_at: completedAt,
      } as never).eq("id", run.id).eq("tenant_id", job.tenant_id),
      "pipeline run finalization failed",
    );
    await must(
      sb.from("data_prep_pipelines").update({
        last_run_at: completedAt,
        last_status: workflowStatus,
        last_error: null,
      } as never).eq("id", pipe.id).eq("tenant_id", job.tenant_id),
      "pipeline finalization failed",
    );
    await must(
      sb.from("audit_log").insert({
        actor_user_id: job.actor_user_id,
        tenant_id: job.tenant_id,
        scope: "workspace",
        action: "data_prep.api.run.complete",
        resource_type: "data_prep_run",
        resource_id: run.id,
        context: { job_id: job.id, pipeline_id: pipe.id, status: workflowStatus, rows_in: rowsIn, rows_out: finalRows.length },
      } as never),
      "pipeline audit failed",
    );
    return {
      workflow_status: workflowStatus,
      run_id: run.id,
      run_uid: run.run_uid,
      rows_in: rowsIn,
      rows_out: finalRows.length,
      dq,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "pipeline execution failed";
    await sb.from("data_prep_runs").update({
      status: "failed",
      error: message,
      finished_at: new Date().toISOString(),
    } as never).eq("id", run.id).eq("tenant_id", job.tenant_id);
    await sb.from("data_prep_pipelines").update({
      last_run_at: new Date().toISOString(),
      last_status: "failed",
      last_error: message,
    } as never).eq("id", pipe.id).eq("tenant_id", job.tenant_id);
    throw error;
  }
}

async function executeReconJob(sb: SupabaseClient, job: WorkflowJob) {
  const definition = await must(
    sb.from("recon_definitions").select("*").eq("id", job.resource_id).eq("tenant_id", job.tenant_id).maybeSingle(),
    "reconciliation lookup failed",
  );
  if (!definition) throw new Error("reconciliation not found");
  const run = await must(
    sb.from("recon_runs").insert({
      tenant_id: job.tenant_id,
      definition_id: definition.id,
      status: "running",
      run_by: job.actor_user_id,
    }).select("id,run_uid").single(),
    "reconciliation run creation failed",
  );
  if (!run) throw new Error("reconciliation run was not created");

  try {
    const sides = definition.sides as ReconSpec["sides"];
    const sideData: SideData[] = [];
    for (const side of sides) {
      const uploads = await must(
        sb.from("workspace_data_source_uploads")
          .select("rows")
          .eq("data_source_id", side.data_source_id)
          .eq("tenant_id", job.tenant_id)
          .order("created_at", { ascending: false })
          .limit(1),
        "reconciliation source read failed",
      );
      sideData.push({ side_id: side.side_id, rows: (uploads?.[0]?.rows as SideData["rows"] | undefined) ?? [] });
    }
    const { hydrateManagedReferenceRules } = await import("@/lib/reference-data-resolver.server");
    const referenceResolution = await hydrateManagedReferenceRules(
      sb,
      job.tenant_id,
      definition.rules as ReconSpec["rules"],
      "service",
    );
    const result = runRecon({
      recon_type: definition.recon_type as ReconSpec["recon_type"],
      sides,
      rules: referenceResolution.rules,
    }, sideData);
    result.stats.reference_versions = referenceResolution.evidence;

    const matches = result.matches.map((match) => ({
      run_id: run.id,
      tenant_id: job.tenant_id,
      rule_id: match.rule_id,
      cardinality: match.cardinality,
      members: match.members,
      score: match.score,
    }));
    const exceptions = result.exceptions.map((exception) => ({
      run_id: run.id,
      tenant_id: job.tenant_id,
      side: exception.side ?? null,
      reason: exception.reason,
      severity: exception.severity,
      status: "open",
      payload: exception.payload,
    }));
    for (let index = 0; index < matches.length; index += 500) {
      await must(sb.from("recon_matches").insert(matches.slice(index, index + 500) as never), "match persistence failed");
    }
    for (let index = 0; index < exceptions.length; index += 500) {
      await must(sb.from("recon_exceptions").insert(exceptions.slice(index, index + 500) as never), "exception persistence failed");
    }
    await must(
      sb.from("recon_runs").update({
        status: "completed",
        matched_count: result.matches.length,
        exception_count: result.exceptions.length,
        total_rows: result.stats.total_rows,
        stats: result.stats,
        completed_at: new Date().toISOString(),
      } as never).eq("id", run.id).eq("tenant_id", job.tenant_id),
      "reconciliation finalization failed",
    );
    await must(
      sb.from("audit_log").insert({
        actor_user_id: job.actor_user_id,
        tenant_id: job.tenant_id,
        scope: "workspace",
        action: "recon.api.run.complete",
        resource_type: "recon_run",
        resource_id: run.id,
        context: {
          job_id: job.id,
          definition_id: definition.id,
          matched: result.matches.length,
          exceptions: result.exceptions.length,
          total_rows: result.stats.total_rows,
          reference_versions: referenceResolution.evidence,
        },
      } as never),
      "reconciliation audit failed",
    );
    return {
      workflow_status: "completed",
      run_id: run.id,
      run_uid: run.run_uid,
      matched_count: result.matches.length,
      exception_count: result.exceptions.length,
      total_rows: result.stats.total_rows,
      matched_records: result.stats.matched_records,
      reference_versions: referenceResolution.evidence,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "reconciliation execution failed";
    await sb.from("recon_runs").update({
      status: "failed",
      error: message,
      completed_at: new Date().toISOString(),
    } as never).eq("id", run.id).eq("tenant_id", job.tenant_id);
    throw error;
  }
}

async function executeConnectorJob(job: WorkflowJob) {
  const { runSchedule } = await import("@/lib/connectors.server");
  const result = await runSchedule(job.resource_id, job.tenant_id, "manual", {
    actorUserId: job.actor_user_id,
    workflowJobId: job.id,
    apiTokenId: job.token_id,
  });
  return { workflow_status: "success", schedule_id: job.resource_id, rows: result.rows };
}

export async function processOneWorkflowApiJob(jobId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as unknown as SupabaseClient;
  const claimed = await must(
    sb.rpc("claim_workflow_api_job", { _job_id: jobId ?? null }),
    "workflow queue claim failed",
  );
  const job = (Array.isArray(claimed) ? claimed[0] : claimed) as WorkflowJob | undefined;
  if (!job) return { processed: 0, reason: "not_claimed" };

  try {
    const result = job.job_kind === "data_prep_run"
      ? await executeDataPrepJob(sb, job)
      : job.job_kind === "connector_run"
        ? await executeConnectorJob(job)
        : await executeReconJob(sb, job);
    await must(
      sb.from("workflow_api_jobs").update({
        status: "succeeded",
        result,
        error_code: null,
        completed_at: new Date().toISOString(),
      } as never).eq("id", job.id).eq("status", "running"),
      "workflow job finalization failed",
    );
    return { processed: 1, job_id: job.id, status: "succeeded", result };
  } catch {
    const retry = job.attempts < job.max_attempts;
    const delaySeconds = Math.min(900, 30 * 2 ** Math.max(0, job.attempts - 1));
    const errorCode = `${job.job_kind}_failed`;
    await sb.from("workflow_api_jobs").update({
      status: retry ? "failed" : "dead",
      available_at: retry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : new Date().toISOString(),
      error_code: errorCode,
      completed_at: retry ? null : new Date().toISOString(),
    } as never).eq("id", job.id);
    await sb.from("audit_log").insert({
      actor_user_id: job.actor_user_id,
      tenant_id: job.tenant_id,
      scope: "workspace",
      action: retry ? "api.workflow.retry_scheduled" : "api.workflow.dead",
      resource_type: "workflow_api_job",
      resource_id: job.id,
      context: { job_kind: job.job_kind, attempt: job.attempts, delay_seconds: retry ? delaySeconds : 0 },
    } as never);
    return { processed: 1, job_id: job.id, status: retry ? "failed" : "dead", error: errorCode };
  }
}
