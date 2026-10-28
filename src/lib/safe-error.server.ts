/**
 * S-1 — Error message redaction for public endpoints.
 *
 * Public-facing Supabase calls under src/routes/api/public/* must never
 * leak raw Postgres error messages (which can disclose table names,
 * constraints, RLS policy hints, or PII embedded in violating rows).
 *
 * This helper:
 *   1. Maps known Postgres error codes to safe, stable response shapes.
 *   2. Logs the full raw error (message + code + details) to
 *      security_events with severity='warning' for operator triage.
 *   3. Returns ONLY { status, body: { error, code? } } — no raw .message.
 */

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

type LogContext = {
  tenantId?: string | null;
  userId?: string | null;
  path: string;
};

type SafeErrorResult = {
  status: number;
  body: { error: string; code?: string };
};

const CODE_MAP: Record<string, { status: number; error: string }> = {
  "42501": { status: 403, error: "rls_denied" },
  "23505": { status: 409, error: "conflict" },
  "23503": { status: 400, error: "fk_violation" },
  P0001: { status: 400, error: "app_error" },
};

export function safeSupabaseError(
  err: SupabaseLikeError,
  context: LogContext,
): SafeErrorResult {
  const code = (err?.code ?? "").toString();
  const mapped = CODE_MAP[code];
  const result: SafeErrorResult = mapped
    ? { status: mapped.status, body: { error: mapped.error, code } }
    : { status: 500, body: { error: "internal_error" } };

  // Fire-and-forget audit log — never block the response on logging.
  void logRawError(err, context).catch(() => {
    /* swallow — alerting layer surfaces missing security_events */
  });

  return result;
}

async function logRawError(err: SupabaseLikeError, context: LogContext): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("security_events").insert({
      tenant_id: context.tenantId ?? null,
      user_id: context.userId ?? null,
      event_type: "public_api.supabase_error",
      severity: "warning",
      context: {
        path: context.path,
        error_message: err?.message ?? null,
        code: err?.code ?? null,
        details: err?.details ?? null,
        hint: err?.hint ?? null,
      } as Record<string, unknown>,
    } as never);
  } catch {
    /* swallow */
  }
}

/** Convenience: turn a safe-error result into a Response. */
export function safeErrorResponse(result: SafeErrorResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
}
