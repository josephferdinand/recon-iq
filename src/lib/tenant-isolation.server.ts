/**
 * Tenant Isolation Hardening — server-side guard.
 *
 * End-to-end tenant isolation is enforced at four layers:
 *  1. Database — RLS policies + `assert_tenant_access(uuid)` SECURITY DEFINER
 *     function (forensic logging on denial).
 *  2. Server functions — `requireTenantAccess()` wrapper called at the top of
 *     every tenant-scoped handler. Belt-and-braces over RLS so a buggy policy
 *     cannot silently leak.
 *  3. AI / Copilot context — `stampTenantContext()` injects the verified
 *     tenant_id into every tool call and refuses payloads with mismatched ids.
 *  4. Audit / Analytics — every denial fires a `tenant_isolation.assert_denied`
 *     security_event with severity=high.
 *
 * This module is SERVER-ONLY. Import only from `.functions.ts` handlers or
 * other `.server.ts` modules.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Sb = SupabaseClient<Database>;

export class TenantIsolationError extends Error {
  code = "TENANT_ISOLATION_DENIED" as const;
  constructor(
    public readonly tenantId: string | null,
    public readonly userId: string,
    reason: string,
  ) {
    super(`tenant_isolation: ${reason} (user=${userId}, tenant=${tenantId ?? "null"})`);
    this.name = "TenantIsolationError";
  }
}

/**
 * Assert that the calling user is permitted to act on `tenantId`.
 * Throws `TenantIsolationError` (mapped to a 403 at the route layer) if not.
 *
 * Server functions MUST call this before performing any tenant-scoped read or
 * write — even when RLS is expected to handle it. Defense in depth.
 */
export async function requireTenantAccess(
  supabase: Sb,
  tenantId: string | null | undefined,
  userId: string,
): Promise<string> {
  if (!tenantId) {
    throw new TenantIsolationError(null, userId, "missing tenant_id in request");
  }
  // Delegates the actual check to the SECURITY DEFINER SQL function so a
  // single source of truth governs platform_admin bypass + member lookup.
  const { error } = await supabase.rpc("assert_tenant_access", {
    _tenant_id: tenantId,
  });
  if (error) {
    throw new TenantIsolationError(tenantId, userId, error.message);
  }
  return tenantId;
}

/**
 * Stamps a verified tenant_id onto an arbitrary payload before it is handed
 * to the LLM, a tool call, or an analytics pipeline. If the payload already
 * carries a mismatched tenant_id this throws — preventing prompt-injection
 * driven cross-tenant pivots.
 */
export function stampTenantContext<T extends Record<string, unknown>>(
  payload: T,
  tenantId: string,
): T & { tenant_id: string } {
  const incoming = (payload as { tenant_id?: unknown }).tenant_id;
  if (incoming != null && incoming !== tenantId) {
    throw new TenantIsolationError(
      String(incoming),
      "system",
      `payload tenant_id (${String(incoming)}) does not match request tenant (${tenantId})`,
    );
  }
  return { ...payload, tenant_id: tenantId };
}

/**
 * Filters an array of rows to only those carrying the expected tenant_id.
 * Use as a last-line check before returning data to the client when the
 * underlying query joined across multiple sources.
 */
export function redactCrossTenantRows<T extends { tenant_id?: string | null }>(
  rows: T[],
  tenantId: string,
): T[] {
  return rows.filter((r) => r.tenant_id === tenantId);
}
