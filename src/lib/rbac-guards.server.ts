/**
 * Shared server-side RBAC guards for tenant-admin and platform-admin
 * `createServerFn` handlers. Defense-in-depth on top of RLS.
 *
 * Usage — first line of a handler that has run `requireSupabaseAuth`:
 *
 *   await requireTenantAdmin(context, data.tenant_id);
 *
 * On deny: throws `Response('Forbidden', { status: 403 })` AND best-effort
 * writes an `audit_log` row `rbac.denied`. On allow: returns the effective
 * role for downstream logging.
 *
 * The guard uses the caller's own RLS-bound supabase client (from
 * `requireSupabaseAuth` context). It never touches the service-role client.
 */

export type GuardContext = {
  supabase: any;
  userId: string;
  claims?: unknown;
};

export type GuardOptions = {
  /** Allow platform_admin to pass tenant-scoped checks. Default true. */
  allowPlatformAdmin?: boolean;
  /** Additional roles accepted (e.g. 'tenant_analyst' for read gates). */
  extraRoles?: Array<"tenant_admin" | "tenant_analyst" | "tenant_viewer">;
  /** Logical fn / resource name recorded on deny. */
  fnName?: string;
};

export type GuardResult = {
  role: "tenant_admin" | "tenant_analyst" | "tenant_viewer" | "platform_admin";
};

class ForbiddenError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function auditDeny(
  ctx: GuardContext,
  tenantId: string | null,
  fnName: string,
  reason: string,
): Promise<void> {
  try {
    await ctx.supabase.from("audit_log").insert({
      actor_user_id: ctx.userId,
      tenant_id: tenantId,
      scope: tenantId ? "tenant" : "platform",
      action: "rbac.denied",
      resource_type: "server_fn",
      resource_id: fnName,
      context: { fn: fnName, reason } as any,
    } as any);
  } catch {
    /* audit failure never blocks the deny */
  }
}

async function isPlatformAdmin(ctx: GuardContext): Promise<boolean> {
  if (!ctx?.supabase || !ctx.userId) return false;
  const { data, error } = await ctx.supabase.rpc("is_platform_admin", {
    _user_id: ctx.userId,
  });
  return !error && data === true;
}

async function hasTenantRole(
  ctx: GuardContext,
  tenantId: string,
  role: "tenant_admin" | "tenant_analyst" | "tenant_viewer",
): Promise<boolean> {
  const { data } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
    _role: role,
  });
  return !!data;
}

/**
 * Assert caller is a tenant_admin (or tenant_owner, or platform_admin when
 * allowed) of `tenantId`. Throws 403 with audit row otherwise.
 */
export async function requireTenantAdmin(
  ctx: GuardContext,
  tenantId: string,
  opts: GuardOptions = {},
): Promise<GuardResult> {
  const fnName = opts.fnName ?? "unknown";
  if (!tenantId || typeof tenantId !== "string") {
    await auditDeny(ctx, null, fnName, "missing_tenant_id");
    throw new ForbiddenError("Forbidden: tenant_id required");
  }
  if (opts.allowPlatformAdmin !== false && (await isPlatformAdmin(ctx))) {
    return { role: "platform_admin" };
  }
  if (await hasTenantRole(ctx, tenantId, "tenant_admin")) {
    return { role: "tenant_admin" };
  }
  for (const r of opts.extraRoles ?? []) {
    if (await hasTenantRole(ctx, tenantId, r)) return { role: r };
  }
  await auditDeny(ctx, tenantId, fnName, "not_tenant_admin");
  throw new ForbiddenError("Forbidden: tenant admin required");
}

/**
 * Assert caller is any member of `tenantId` (or platform_admin). Suitable
 * for read-only tenant-scoped fns.
 */
export async function requireTenantMember(
  ctx: GuardContext,
  tenantId: string,
  opts: GuardOptions = {},
): Promise<GuardResult> {
  const fnName = opts.fnName ?? "unknown";
  if (!tenantId || typeof tenantId !== "string") {
    await auditDeny(ctx, null, fnName, "missing_tenant_id");
    throw new ForbiddenError("Forbidden: tenant_id required");
  }
  if (opts.allowPlatformAdmin !== false && (await isPlatformAdmin(ctx))) {
    return { role: "platform_admin" };
  }
  const { data } = await ctx.supabase.rpc("is_tenant_member", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
  });
  if (data) {
    // Best-effort resolve role for return value.
    for (const r of ["tenant_admin", "tenant_analyst", "tenant_viewer"] as const) {
      if (await hasTenantRole(ctx, tenantId, r)) return { role: r };
    }
    return { role: "tenant_viewer" };
  }
  await auditDeny(ctx, tenantId, fnName, "not_tenant_member");
  throw new ForbiddenError("Forbidden: tenant member required");
}

/** Assert caller is a platform_admin. */
export async function requirePlatformAdmin(
  ctx: GuardContext,
  opts: { fnName?: string } = {},
): Promise<GuardResult> {
  if (await isPlatformAdmin(ctx)) return { role: "platform_admin" };
  await auditDeny(ctx, null, opts.fnName ?? "unknown", "not_platform_admin");
  throw new ForbiddenError("Forbidden: platform admin required");
}

export { ForbiddenError };
