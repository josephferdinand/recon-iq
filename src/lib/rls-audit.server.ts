// Server-side helper that captures Postgres / PostgREST permission-denied
// errors (RLS denials) and writes them to public.security_events as
// event_type='rls_denied'. The insert uses the service-role client so the
// log lands even when the caller's own grants would block it. The original
// error is always rethrown — this helper is purely observational.

type DenialMeta = {
  tenant_id?: string | null;
  user_id?: string | null;
  ip?: string | null;
  resource: string;          // logical operation, e.g. "agent_actions.update"
  context?: Record<string, any>;
};

const PG_INSUFFICIENT_PRIVILEGE = "42501";

/** Best-effort detection of an RLS / privilege denial coming back from
 *  PostgREST or pg. PostgREST surfaces RLS denials with `code: '42501'`
 *  or `status: 403` and a `permission denied` message. */
export function isRlsDenial(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as any;
  if (e.code === PG_INSUFFICIENT_PRIVILEGE) return true;
  if (typeof e.status === "number" && (e.status === 401 || e.status === 403)) {
    const msg = String(e.message ?? "").toLowerCase();
    if (msg.includes("permission denied") || msg.includes("row-level security") ||
        msg.includes("rls") || msg.includes("violates row-level")) return true;
  }
  const msg = String(e.message ?? "").toLowerCase();
  return msg.includes("permission denied for table") ||
         msg.includes("new row violates row-level security policy");
}

/** Insert one security_events row using the service-role client. Never throws. */
export async function logRlsDenial(err: unknown, meta: DenialMeta): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const e = err as any;
    await supabaseAdmin.from("security_events").insert({
      tenant_id: meta.tenant_id ?? null,
      user_id: meta.user_id ?? null,
      ip: meta.ip ?? null,
      event_type: "rls_denied",
      severity: "warning",
      context: {
        resource: meta.resource,
        pg_code: e?.code ?? null,
        message: typeof e?.message === "string" ? e.message.slice(0, 500) : null,
        ...(meta.context ?? {}),
      } as any,
    } as any);
  } catch {
    // Never let audit logging mask the original failure.
  }
}

/** Wraps an async operation. If it rejects with an RLS denial, records a
 *  security_events row, then rethrows the original error unchanged. */
export async function withRlsAudit<T>(
  fn: () => Promise<T>,
  meta: DenialMeta,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isRlsDenial(err)) await logRlsDenial(err, meta);
    throw err;
  }
}
