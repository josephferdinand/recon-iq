/**
 * Phase C — fine-grained RBAC helpers for the Scale Console panels.
 *
 * Personas allowed per capability:
 *   - twin_view / loans_view: tenant_admin, tenant_analyst, platform_admin
 *   - twin_admin (upsert/mutations): tenant_admin, platform_admin
 *   - schema_view / schema_request: tenant_admin, platform_admin
 *   - attest_view / attest_export: tenant_admin, platform_admin
 *
 * `assertPhaseCPerm` is used server-side by the panel-fed functions as a
 * defense-in-depth layer on top of RLS. `getPhaseCPermissions` powers the
 * UI so unauthorised personas never see the tab or the fetch fires.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PhaseCPermission =
  | "twin_view"
  | "twin_admin"
  | "loans_view"
  | "schema_view"
  | "schema_request"
  | "attest_view"
  | "attest_export";

const PERMISSION_ROLES: Record<PhaseCPermission, Array<"tenant_admin" | "tenant_analyst">> = {
  twin_view: ["tenant_admin", "tenant_analyst"],
  twin_admin: ["tenant_admin"],
  loans_view: ["tenant_admin", "tenant_analyst"],
  schema_view: ["tenant_admin"],
  schema_request: ["tenant_admin"],
  attest_view: ["tenant_admin"],
  attest_export: ["tenant_admin"],
};

async function userHasPhaseCPerm(
  ctx: any,
  tenantId: string,
  perm: PhaseCPermission,
): Promise<boolean> {
  const { data: platform } = await ctx.supabase.rpc("is_platform_admin", {
    _user_id: ctx.userId,
  });
  if (platform) return true;
  for (const role of PERMISSION_ROLES[perm]) {
    const { data: ok } = await ctx.supabase.rpc("has_tenant_role", {
      _user_id: ctx.userId,
      _tenant_id: tenantId,
      _role: role,
    });
    if (ok) return true;
  }
  return false;
}

/**
 * Server-side gate. Call from a `createServerFn` handler to enforce Phase C
 * RBAC before touching data. Emits an audit_log entry on denial.
 */
export async function assertPhaseCPerm(
  ctx: any,
  tenantId: string,
  perm: PhaseCPermission,
): Promise<void> {
  const ok = await userHasPhaseCPerm(ctx, tenantId, perm);
  if (ok) return;
  try {
    await ctx.supabase.from("audit_log").insert({
      tenant_id: tenantId,
      actor_user_id: ctx.userId,
      action: "phase_c.rbac.denied",
      scope: "tenant",
      resource_type: "phase_c_panel",
      resource_id: perm,
      context: { permission: perm, allowed_roles: PERMISSION_ROLES[perm] } as any,
    } as any);
  } catch {
    /* ignore audit failure */
  }
  throw new Error(
    `Forbidden: ${perm} requires one of ${PERMISSION_ROLES[perm].join(", ")} or platform_admin`,
  );
}

export type PhaseCPermissionSet = Record<PhaseCPermission, boolean>;

export const getPhaseCPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<PhaseCPermissionSet> => {
    const perms = Object.keys(PERMISSION_ROLES) as PhaseCPermission[];
    const entries = await Promise.all(
      perms.map(async (p) => [p, await userHasPhaseCPerm(context, data.tenant_id, p)] as const),
    );
    return Object.fromEntries(entries) as PhaseCPermissionSet;
  });
