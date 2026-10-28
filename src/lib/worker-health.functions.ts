import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createErrorReference, USER_FACING_ERRORS } from "./user-facing-errors";

function workerHealthError(error: unknown): Error {
  const referenceId = createErrorReference();
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  console.error("[WORKER_HEALTH_ERROR]", {
    referenceId, code: typeof detail.code === "string" ? detail.code : undefined,
  });
  const copy = USER_FACING_ERRORS.service;
  return new Error(`${copy.message} ${copy.action} Error Reference ID: ${referenceId}`);
}

/* ------------------------ Reads (tenant or platform) ------------------------ */

const TenantArg = z.object({ tenant_id: z.string().uuid().nullable().optional() });

export const listCircuitBreakers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => TenantArg.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("worker_circuit_breakers")
      .select("id, tenant_id, scope, target_id, state, consecutive_failures, failure_threshold, cooldown_seconds, opened_at, next_probe_at, last_failure_at, last_success_at, last_error, updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q;
    if (error) throw workerHealthError(error);
    return (rows ?? []).map(({ last_error, ...row }: any) => ({
      ...row, last_failure_needs_attention: !!last_error,
    }));
  });

const RetryFilter = z.object({
  tenant_id: z.string().uuid().nullable().optional(),
  pipeline_id: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const listRetryAttempts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => RetryFilter.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("worker_retry_attempts")
      .select("id, tenant_id, pipeline_id, data_source_id, run_id, step, attempt, max_attempts, status, error, backoff_seconds, breaker_state, attempted_at")
      .order("attempted_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.pipeline_id) q = q.eq("pipeline_id", data.pipeline_id);
    const { data: rows, error } = await q;
    if (error) throw workerHealthError(error);
    return (rows ?? []).map(({ error: attemptError, ...row }: any) => ({
      ...row, attempt_needs_attention: !!attemptError,
    }));
  });

export const listWorkerHeartbeats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("worker_health_heartbeats")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(200);
    if (error) throw workerHealthError(error);
    return data ?? [];
  });

/* ------------------------ Manual reset ------------------------ */

const ResetInput = z.object({ breaker_id: z.string().uuid() });
export const resetBreaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ResetInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("worker_breaker_reset", {
      _breaker_id: data.breaker_id,
    });
    if (error) throw workerHealthError(error);
    return { ok: true };
  });
