/**
 * Shared lifecycle helpers for integration tests that mint ephemeral tenants.
 *
 * The `guard_last_tenant_owner` trigger on `tenant_members` blocks plain
 * cascade deletes of a tenant whose only admin is about to be removed.
 * Earlier specs called `admin.from("tenants").delete()` directly; the
 * trigger raised, the JS client silently swallowed the error, and orphan
 * tenants accumulated in production (17 found on 2026-06-29).
 *
 * `purge_test_tenant(uuid, text)` is a service-role-only SECURITY DEFINER
 * function that disables the guard, deletes the tenant (cascading to all
 * child rows), and re-enables the guard. It refuses any tenant whose slug
 * does not match the test fixture pattern `-<13 digit unix-ms>`.
 *
 * Both create and purge calls are recorded in `test_tenant_lifecycle_audit`
 * along with the originating spec file, so a future orphan can be traced
 * back to the suite that leaked it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Best-effort spec-file detection for audit attribution.
 *  Vitest exposes the current test path via `expect.getState().testPath`.
 *  Falls back to the caller's stack trace. */
function detectSpecName(explicit?: string): string {
  if (explicit) return explicit;
  try {
    // Vitest globals: read lazily so this helper still works without vitest loaded.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const v = (globalThis as any).expect?.getState?.();
    if (v?.testPath) return String(v.testPath);
  } catch { /* noop */ }
  const stack = new Error().stack ?? "";
  const m = stack.split("\n").find((l) => /\.spec\.[cm]?tsx?/.test(l));
  return m?.trim() ?? "unknown";
}

/** Record a `create` audit row for an ephemeral tenant that a spec just minted.
 *  Best effort: never throws — audit failure must not mask a real test failure. */
export async function recordTestTenantCreated(
  admin: SupabaseClient,
  tenantId: string,
  tenantSlug: string,
  specName?: string,
): Promise<void> {
  try {
    await admin.from("test_tenant_lifecycle_audit").insert({
      tenant_id: tenantId,
      tenant_slug: tenantSlug,
      event: "create",
      spec_name: detectSpecName(specName),
      notes: {},
    } as any);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[tenant-teardown] failed to log create for ${tenantId}: ${String(err)}`);
  }
}

export async function purgeTestTenants(
  admin: SupabaseClient,
  tenantIds: Array<string | null | undefined>,
  specName?: string,
): Promise<void> {
  const spec = detectSpecName(specName);
  const ids = [...new Set(tenantIds.filter((id): id is string => Boolean(id)))];
  const failures: string[] = [];

  for (const id of ids) {
    const { error } = await admin.rpc("purge_test_tenant", {
      _tenant_id: id,
      _spec_name: spec,
    });
    if (error) {
      failures.push(`purge ${id}: ${error.message}`);
      continue;
    }

    const { data, error: readbackError } = await admin
      .from("tenants")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (readbackError) {
      failures.push(`readback ${id}: ${readbackError.message}`);
    } else if (data) {
      failures.push(`residue ${id}: tenant row still exists after purge`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Test tenant teardown failed (${spec}): ${failures.join("; ")}`);
  }
}
