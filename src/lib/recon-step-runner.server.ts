/**
 * Worker step runner with circuit-breaker + automatic retries.
 *
 * Every attempt — success or failure — flows through the SECURITY DEFINER
 * RPCs `worker_check_breaker`, `worker_record_failure`, `worker_record_success`,
 * which write to `worker_retry_attempts`, `worker_circuit_breakers`, and the
 * hash-chained `audit_log` (`worker.step.retry`, `worker.breaker.open`,
 * `worker.breaker.close`). Callers therefore inherit the full audit trail
 * for free.
 *
 * Usage:
 *   await runStepWithBreaker({
 *     tenantId, scope: 'pipeline', target: pipelineId, step: 'ingest',
 *     runId, maxAttempts: 3, baseBackoffSec: 5,
 *   }, async () => { ... actual work ... });
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type BreakerScope = "pipeline" | "data_source";

export interface RunStepOptions {
  tenantId: string;
  scope: BreakerScope;
  target: string;
  step: string;
  runId?: string | null;
  maxAttempts?: number;
  baseBackoffSec?: number;
}

export interface StepOutcome<T> {
  ok: boolean;
  attempts: number;
  result?: T;
  error?: string;
  breakerState?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runStepWithBreaker<T>(
  opts: RunStepOptions,
  fn: () => Promise<T>,
): Promise<StepOutcome<T>> {
  const max = Math.max(1, opts.maxAttempts ?? 3);
  const base = Math.max(1, opts.baseBackoffSec ?? 2);
  const runId = opts.runId ?? null;

  // Pre-flight breaker check
  const { data: pre, error: preErr } = await supabaseAdmin.rpc("worker_check_breaker", {
    _tenant: opts.tenantId, _scope: opts.scope, _target: opts.target,
  });
  if (preErr) throw new Error(`breaker_check_failed: ${preErr.message}`);
  const preRow = Array.isArray(pre) ? pre[0] : pre;
  if (preRow && (preRow as any).state === "open") {
    return { ok: false, attempts: 0, error: "circuit_open", breakerState: "open" };
  }

  let lastErr = "";
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const result = await fn();
      await supabaseAdmin.rpc("worker_record_success", {
        _tenant: opts.tenantId, _scope: opts.scope, _target: opts.target,
        _step: opts.step, _run_id: runId as any, _attempt: attempt,
      });
      return { ok: true, attempts: attempt, result, breakerState: "closed" };
    } catch (e: any) {
      lastErr = String(e?.message || e);
      const backoff = base * Math.pow(2, attempt - 1);
      const { data: failRes } = await supabaseAdmin.rpc("worker_record_failure", {
        _tenant: opts.tenantId, _scope: opts.scope, _target: opts.target,
        _step: opts.step, _run_id: runId as any, _attempt: attempt,
        _max_attempts: max, _error: lastErr, _backoff_seconds: backoff,
      });
      const row = Array.isArray(failRes) ? failRes[0] : failRes;
      const state = (row as any)?.breaker_state ?? "closed";
      const action = (row as any)?.action ?? "";
      if (state === "open" || action === "retry_exhausted" || attempt >= max) {
        return { ok: false, attempts: attempt, error: lastErr, breakerState: state };
      }
      await sleep(backoff * 1000);
    }
  }
  return { ok: false, attempts: max, error: lastErr, breakerState: "unknown" };
}
