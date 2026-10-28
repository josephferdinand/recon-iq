/**
 * APM + SIEM outbound pipeline (server-only).
 *
 * Emits APM spans and security events over HTTP to configured collectors.
 * Configure via environment:
 *   APM_ENDPOINT       — OTLP/HTTP or vendor ingest URL (e.g. Datadog, New Relic)
 *   APM_API_KEY        — bearer / DD-API-KEY / etc.
 *   APM_SERVICE_NAME   — service tag (default: "fvi")
 *   SIEM_ENDPOINT      — SIEM HEC / syslog-over-HTTPS endpoint
 *   SIEM_API_KEY       — bearer / Splunk HEC token
 *
 * Silently no-ops when endpoints are unset so local/dev runs never fail.
 */
export interface ApmSpan {
  name: string;
  service?: string;
  duration_ms: number;
  status: "ok" | "error";
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  tenant_id?: string | null;
  user_id?: string | null;
  attributes?: Record<string, unknown>;
  error?: { type?: string; message?: string; stack?: string };
}

export interface SiemEvent {
  event_type: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  tenant_id?: string | null;
  user_id?: string | null;
  ip?: string | null;
  resource?: string;
  action?: string;
  outcome?: "success" | "failure" | "denied";
  attributes?: Record<string, unknown>;
  occurred_at?: string;
}

const APM_ENDPOINT = process.env.APM_ENDPOINT;
const APM_API_KEY = process.env.APM_API_KEY;
const APM_SERVICE = process.env.APM_SERVICE_NAME ?? "fvi";
const SIEM_ENDPOINT = process.env.SIEM_ENDPOINT;
const SIEM_API_KEY = process.env.SIEM_API_KEY;

/** Fire-and-forget: record a pipeline sample into the minute-bucket stats table. */
async function recordSample(sink: "apm" | "siem", status: "ok" | "drop" | "error", latency_ms: number): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("record_pipeline_sample", {
      _sink: sink,
      _status: status,
      _latency_ms: Math.max(0, Math.round(latency_ms)),
    });
  } catch { /* never let telemetry crash the caller */ }
}

function randHex(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newTraceId(): string { return randHex(16); }
export function newSpanId(): string { return randHex(8); }

export async function emitApmSpan(span: ApmSpan): Promise<void> {
  if (!APM_ENDPOINT) { void recordSample("apm", "drop", 0); return; }
  const payload = {
    service: span.service ?? APM_SERVICE,
    name: span.name,
    trace_id: span.trace_id ?? newTraceId(),
    span_id: span.span_id ?? newSpanId(),
    parent_span_id: span.parent_span_id,
    duration_ms: span.duration_ms,
    status: span.status,
    tags: {
      "tenant.id": span.tenant_id ?? undefined,
      "user.id": span.user_id ?? undefined,
      ...(span.attributes ?? {}),
    },
    error: span.error,
    timestamp: new Date().toISOString(),
  };
  const started = Date.now();
  try {
    const res = await fetch(APM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(APM_API_KEY ? { "Authorization": `Bearer ${APM_API_KEY}`, "DD-API-KEY": APM_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    void recordSample("apm", res.ok ? "ok" : "error", Date.now() - started);
  } catch {
    void recordSample("apm", "error", Date.now() - started);
  }
}

export async function emitSiemEvent(event: SiemEvent): Promise<void> {
  if (!SIEM_ENDPOINT) { void recordSample("siem", "drop", 0); return; }
  const payload = {
    event: event.event_type,
    severity: event.severity,
    time: event.occurred_at ?? new Date().toISOString(),
    source: APM_SERVICE,
    fields: {
      "tenant.id": event.tenant_id,
      "user.id": event.user_id,
      "network.client.ip": event.ip,
      "event.resource": event.resource,
      "event.action": event.action,
      "event.outcome": event.outcome,
      ...(event.attributes ?? {}),
    },
  };
  const started = Date.now();
  try {
    const res = await fetch(SIEM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SIEM_API_KEY ? { "Authorization": `Splunk ${SIEM_API_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    void recordSample("siem", res.ok ? "ok" : "error", Date.now() - started);
  } catch {
    void recordSample("siem", "error", Date.now() - started);
  }
}

/** Trace a promise-returning function and emit an APM span for it. */
export async function traced<T>(name: string, meta: Omit<ApmSpan, "name" | "duration_ms" | "status">, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const res = await fn();
    void emitApmSpan({ ...meta, name, duration_ms: Date.now() - start, status: "ok" });
    return res;
  } catch (err: any) {
    void emitApmSpan({
      ...meta, name, duration_ms: Date.now() - start, status: "error",
      error: { type: err?.name, message: err?.message, stack: err?.stack },
    });
    void emitSiemEvent({
      event_type: `error.${name}`, severity: "medium",
      tenant_id: meta.tenant_id, user_id: meta.user_id, outcome: "failure",
      attributes: { error: err?.message },
    });
    throw err;
  }
}

/* -------- Back-compat shims for existing callers -------- */

/** Create a trace handle used by aidp-predict.server. Emits an APM span on end(). */
export function createTrace(name: string, attributes?: Record<string, unknown>) {
  const start = Date.now();
  const trace_id = newTraceId();
  return {
    trace_id,
    end(status: "ok" | "error", extra?: Record<string, unknown>) {
      void emitApmSpan({
        name,
        duration_ms: Date.now() - start,
        status,
        trace_id,
        attributes: { ...(attributes ?? {}), ...(extra ?? {}) },
      });
    },
  };
}

/** Emit a discrete metric point to the APM pipeline. */
export function writeMetric(
  name: string,
  tags: Record<string, unknown> = {},
  fields: Record<string, unknown> = {},
): void {
  void emitApmSpan({
    name: `metric.${name}`,
    duration_ms: 0,
    status: "ok",
    attributes: { ...tags, ...fields, metric: true },
  });
}

/** Wrap a cron job in metric + trace instrumentation. */
export async function withCronMetric<T>(
  jobName: string,
  fn: () => Promise<T>,
  successExtractor: (result: T) => number = () => 1,
): Promise<T> {
  const start = Date.now();
  try {
    const res = await fn();
    void emitApmSpan({
      name: `cron.${jobName}`,
      duration_ms: Date.now() - start,
      status: "ok",
      attributes: { success: successExtractor(res), cron: true },
    });
    return res;
  } catch (err: any) {
    void emitApmSpan({
      name: `cron.${jobName}`,
      duration_ms: Date.now() - start,
      status: "error",
      attributes: { cron: true },
      error: { type: err?.name, message: err?.message },
    });
    void emitSiemEvent({
      event_type: `cron.${jobName}.failed`,
      severity: "high",
      outcome: "failure",
      attributes: { error: err?.message },
    });
    throw err;
  }
}
