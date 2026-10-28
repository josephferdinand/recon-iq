import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSafeOutboundUrl, safeFetch } from "@/lib/ssrf-guard.server";

type AidpJob = {
  id: string;
  tenant_id: string;
  document_id: string;
  callback_url: string | null;
  attempts: number;
  max_attempts: number;
};

export function predictionAttemptIdempotencyKey(
  jobId: string,
  attempt: number,
): string {
  return `aidp-job:${jobId}:attempt:${attempt}`;
}

export async function processOneAidpApiJob(jobId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as unknown as SupabaseClient;
  const { data: claimRows, error: claimError } = await sb.rpc("claim_aidp_api_job", {
    _job_id: jobId ?? null,
  });
  if (claimError) throw new Error(`AIDP queue claim failed: ${claimError.message}`);
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim?.claimed || !claim.job) return { processed: 0, reason: "not_claimed" };
  const job = claim.job as AidpJob;

  try {
    const { runPredictAsTenant } = await import("@/lib/aidp-predict-internal.server");
    const prediction = await runPredictAsTenant({
      tenant_id: job.tenant_id,
      document_id: job.document_id,
      // The API job is idempotent at the queue boundary. Each retry gets its
      // own prediction key so a failed prediction can never be replayed as a
      // successful zero-field result.
      idempotency_key: predictionAttemptIdempotencyKey(job.id, job.attempts),
    });
    const { data: fields, error: fieldsError } = await sb.from("aidp_prediction_fields")
      .select(`
        id, confidence, bbox, value_text, value_number, value_date, value_json,
        aidp_entity_types ( key, label, datatype, review_policy )
      `)
      .eq("prediction_id", prediction.prediction_id);
    if (fieldsError) throw fieldsError;

    const flat = (fields ?? []).map((field) => {
      const entity = Array.isArray(field.aidp_entity_types)
        ? field.aidp_entity_types[0]
        : field.aidp_entity_types;
      return {
        field_id: field.id,
        key: entity?.key,
        label: entity?.label,
        datatype: entity?.datatype,
        confidence: field.confidence,
        value: field.value_text ?? field.value_number ?? field.value_date ?? field.value_json,
        bbox: field.bbox,
      };
    });
    const response = {
      api_version: "v1",
      job_id: job.id,
      document_id: job.document_id,
      prediction_id: prediction.prediction_id,
      auto_accepted_count: prediction.auto_accepted_count,
      pending_review_count: prediction.pending_review_count,
      fields: flat,
      status: "succeeded",
    };

    const { error: finishError } = await sb.from("aidp_api_jobs").update({
      status: "succeeded",
      prediction_id: prediction.prediction_id,
      response,
      completed_at: new Date().toISOString(),
      locked_at: null,
      last_error: null,
    }).eq("id", job.id).eq("status", "running");
    if (finishError) throw finishError;

    await supabaseAdmin.from("audit_log").insert({
      tenant_id: job.tenant_id,
      scope: "tenant",
      action: "aidp.api.completed",
      resource_type: "aidp_api_jobs",
      resource_id: job.id,
      context: {
        document_id: job.document_id,
        prediction_id: prediction.prediction_id,
        field_count: flat.length,
      },
    } as never);

    if (job.callback_url) {
      try {
        await assertSafeOutboundUrl(job.callback_url);
        await safeFetch(job.callback_url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-aidp-callback": "v1" },
          body: JSON.stringify(response),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        await supabaseAdmin.from("security_events").insert({
          tenant_id: job.tenant_id,
          severity: "warning",
          event_type: "aidp.callback.failed",
          context: {
            job_id: job.id,
            document_id: job.document_id,
            error: error instanceof Error ? error.message.slice(0, 300) : "callback_failed",
          },
        } as never);
      }
    }
    return { processed: 1, job_id: job.id, status: "succeeded", prediction_id: prediction.prediction_id };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "AIDP processing failed";
    const retry = job.attempts < job.max_attempts;
    const delaySeconds = Math.min(900, 30 * 2 ** Math.max(0, job.attempts - 1));
    await sb.from("aidp_api_jobs").update({
      status: retry ? "queued" : "dead",
      available_at: retry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : new Date().toISOString(),
      locked_at: null,
      last_error: message,
      completed_at: retry ? null : new Date().toISOString(),
    }).eq("id", job.id);
    if (!retry) {
      await supabaseAdmin.from("aidp_documents").update({
        status: "failed",
        error: "AIDP job exhausted retry limit",
      } as never).eq("id", job.document_id).eq("tenant_id", job.tenant_id);
    }
    await supabaseAdmin.from("audit_log").insert({
      tenant_id: job.tenant_id,
      scope: "tenant",
      action: retry ? "aidp.api.retry_scheduled" : "aidp.api.dead",
      resource_type: "aidp_api_jobs",
      resource_id: job.id,
      context: { document_id: job.document_id, attempt: job.attempts, delay_seconds: retry ? delaySeconds : 0 },
    } as never);
    return { processed: 1, job_id: job.id, status: retry ? "queued" : "dead" };
  }
}
