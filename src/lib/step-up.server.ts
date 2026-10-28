// Step-up authentication + break-glass enforcement for privileged actions.
//
// Privileged admin fns (auth provider toggles, tenant SCIM settings, IdP
// changes, key rotation, etc.) call requirePrivilegedAction() inside the
// handler AFTER requireSupabaseAuth. The helper accepts EITHER:
//   • a fresh 5-min step-up grant (password re-verified via grantStepUp), OR
//   • an ACTIVE break-glass grant covering the action's scope.
// Both paths write a tamper-evident row into public.audit_log so SOC 2 / DORA
// / ISO 27001 reviewers can see every privileged action, who approved it,
// which mechanism was used, and the source IP / justification.

import { STEP_UP_ACTIONS, type StepUpAction } from "@/lib/step-up.functions";
export { STEP_UP_ACTIONS, type StepUpAction };

/** Break-glass scopes that satisfy each privileged action. `null` = no
 * break-glass path (must use step-up). */
const BREAK_GLASS_SCOPE_FOR: Record<StepUpAction, string | null> = {
  "byok.rotate": "secrets_read",
  "byok.delete": "secrets_read",
  "ip_allowlist.write": "tenant_data_write",
  "billing.change": "billing_admin",
  "sso.write": "tenant_data_write",
  "member.role_elevate": "tenant_admin_impersonate",
  "platform.impersonate": "tenant_admin_impersonate",
  "api_token.create": "secrets_read",
  "tenant.delete": "full_platform",
  "auth_provider.toggle": "full_platform",
  "scim.toggle": "tenant_data_write",
  "scim.settings.write": "tenant_data_write",
  "tenant.settings.write": "tenant_data_write",
  "break_glass.policy.write": "full_platform",
  "audit.export": "audit_export",
};

type ActiveGrant = { id: string; scope: string; expires_at: string | null };

async function findActiveBreakGlass(
  ctx: { supabase: any; userId: string },
  actionKey: StepUpAction,
  tenantId?: string | null,
): Promise<ActiveGrant | null> {
  const scope = BREAK_GLASS_SCOPE_FOR[actionKey];
  if (!scope) return null;
  const nowIso = new Date().toISOString();
  const scopes = scope === "full_platform" ? [scope] : [scope, "full_platform"];
  let q = ctx.supabase
    .from("break_glass_grants")
    .select("id, scope, expires_at, tenant_id")
    .eq("requested_by", ctx.userId)
    .eq("status", "active")
    .in("scope", scopes)
    .gt("expires_at", nowIso)
    .order("expires_at", { ascending: false })
    .limit(1);
  const { data, error } = await q;
  if (error || !data || data.length === 0) return null;
  const row = data[0] as any;
  // If the caller supplied a tenant scope, the grant must either be
  // platform-wide (tenant_id null) or match the tenant.
  if (tenantId && row.tenant_id && row.tenant_id !== tenantId) return null;
  return { id: row.id, scope: row.scope, expires_at: row.expires_at };
}

async function auditPrivileged(
  ctx: { supabase: any; userId: string },
  actionKey: StepUpAction,
  via: "step_up" | "break_glass",
  extra: {
    tenantId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    payload?: Record<string, unknown>;
    grantId?: string | null;
  },
) {
  await ctx.supabase.from("audit_log").insert({
    actor_user_id: ctx.userId,
    tenant_id: extra.tenantId ?? null,
    scope: "privileged_action",
    action: actionKey,
    resource_type: extra.resourceType ?? null,
    resource_id: extra.resourceId ?? null,
    context: {
      via,
      grant_id: extra.grantId ?? null,
      ...(extra.payload ?? {}),
    },
  } as never);
}

export async function requireStepUp(
  context: { supabase: any; userId: string },
  actionKey: StepUpAction,
): Promise<void> {
  // Atomic consume: a single UPDATE ... RETURNING guarded by
  // `consumed_at IS NULL AND expires_at > now()` closes the TOCTOU window
  // where two concurrent requests could both pass a prior SELECT check.
  const nowIso = new Date().toISOString();
  const { data: consumed, error } = await context.supabase
    .from("step_up_grants")
    .update({ consumed_at: nowIso })
    .eq("user_id", context.userId)
    .eq("action_key", actionKey)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("id")
    .limit(1);
  const grantId = Array.isArray(consumed) && consumed.length > 0 ? (consumed[0] as any).id : null;
  if (error || !grantId) {
    throw new Response("Step-up authentication required", { status: 401 });
  }
  await context.supabase
    .from("step_up_grant_lifecycle")
    .insert({
      grant_id: grantId,
      action: "consumed",
      actor_user_id: context.userId,
    } as never);
}

/**
 * Enforce step-up MFA OR an active break-glass grant for a privileged action,
 * then write an audit row. Returns which mechanism satisfied the check.
 */
export async function requirePrivilegedAction(
  context: { supabase: any; userId: string },
  actionKey: StepUpAction,
  meta: {
    tenantId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    payload?: Record<string, unknown>;
  } = {},
): Promise<{ via: "step_up" | "break_glass"; grantId: string | null }> {
  // 1) Break-glass first — an active grant means an incident is already
  //    approved and logged; do not force the operator to re-enter a password.
  const bg = await findActiveBreakGlass(context, actionKey, meta.tenantId);
  if (bg) {
    await auditPrivileged(context, actionKey, "break_glass", { ...meta, grantId: bg.id });
    // Record activity against the break-glass grant so the incident report
    // shows every privileged action that was performed under it.
    await context.supabase.from("break_glass_activities").insert({
      grant_id: bg.id,
      actor_user_id: context.userId,
      action: actionKey,
      resource_type: meta.resourceType ?? null,
      resource_id: meta.resourceId ?? null,
      payload: meta.payload ?? {},
    } as never);
    return { via: "break_glass", grantId: bg.id };
  }
  // 2) Otherwise require a fresh step-up grant.
  await requireStepUp(context, actionKey);
  await auditPrivileged(context, actionKey, "step_up", meta);
  return { via: "step_up", grantId: null };
}
// grantStepUp moved to step-up.functions.ts so the client dialog can import it
// without triggering *.server.ts import-protection.

