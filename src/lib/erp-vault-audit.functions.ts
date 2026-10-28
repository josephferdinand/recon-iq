// ─────────────────────────────────────────────────────────────────────────────
// ERP credential vault audit log — read-only view over public.audit_log,
// filtered to vault + ERP connector actions. RBAC: platform_admin (all tenants)
// or tenant_admin / tenant_analyst (own tenant only). RLS on audit_log also
// enforces this server-side — the filter here is for UX, not authorization.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Every action written by vault + ERP connector code paths.
export const ERP_VAULT_AUDIT_ACTIONS = [
  // App vault (platform + tenant secrets, KMS bindings, rotation, rollback)
  "vault.secret.create",
  "vault.secret.created",
  "vault.secret.rotate",
  "vault.secret.rotated",
  "vault.secret.delete",
  "vault.secret.deleted",
  "vault.secret.rollback",
  "vault.secret.tested",
  "vault.secret.rotate.verified",
  "vault.secret.rotate.reverted",
  "vault.kms.create",
  "vault.kms.update",
  "vault.kms.delete",
  "vault.kms.test",
  // ERP connectors (attach = upsert with credential_vault_secret_id)
  "erp_connector.created",
  "erp_connector.updated",
  "erp_connector.deleted",
  "erp_connector.tested",
] as const;

export const listErpVaultAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().optional(),
      include_platform: z.boolean().default(false),
      actions: z.array(z.string()).optional(),
      actor_user_id: z.string().uuid().optional(),
      resource_id: z.string().optional(),
      search: z.string().max(200).optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(500).default(200),
      before_id: z.string().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // RBAC check — RLS will also gate the read, but we surface a clean error.
    const { data: platAdmin } = await context.supabase
      .rpc("is_platform_admin", { _user_id: context.userId });
    let isTenantMember = false;
    if (data.tenant_id) {
      const { data: mem } = await context.supabase
        .rpc("is_tenant_member", { _user_id: context.userId, _tenant_id: data.tenant_id });
      isTenantMember = !!mem;
    }
    if (!platAdmin && !isTenantMember) throw new Error("Forbidden");

    const actions = (data.actions && data.actions.length
      ? data.actions
      : ERP_VAULT_AUDIT_ACTIONS as unknown as string[]);

    let q = context.supabase.from("audit_log")
      .select("id, occurred_at, actor_user_id, actor_email, tenant_id, tenant_slug, scope, action, resource_type, resource_id, context, client_ip, user_agent")
      .in("action", actions)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);

    if (data.tenant_id && !data.include_platform) {
      q = q.eq("tenant_id", data.tenant_id);
    } else if (data.tenant_id && data.include_platform) {
      q = q.or(`tenant_id.eq.${data.tenant_id},tenant_id.is.null`);
    } else if (platAdmin && !data.tenant_id) {
      // no tenant filter — platform admin can see everything.
    } else {
      q = q.eq("tenant_id", data.tenant_id!);
    }
    if (data.actor_user_id) q = q.eq("actor_user_id", data.actor_user_id);
    if (data.resource_id) q = q.eq("resource_id", data.resource_id);
    if (data.since) q = q.gte("occurred_at", data.since);
    if (data.until) q = q.lte("occurred_at", data.until);
    if (data.before_id) q = q.lt("id", Number(data.before_id));
    if (data.search) {
      // Search across action + resource_id + actor_email.
      q = q.or(`action.ilike.%${data.search}%,resource_id.ilike.%${data.search}%,actor_email.ilike.%${data.search}%`);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Derive correlation IDs from context jsonb — connectors write connector_id,
    // vault writes secret_id/version/fingerprint. We surface both.
    const enriched = (rows ?? []).map((r: any) => {
      const ctx = (r.context ?? {}) as Record<string, any>;
      return {
        ...r,
        correlation: {
          connector_id: ctx.connector_id ?? ctx.erp_connector_id ?? null,
          secret_id: ctx.secret_id ?? (r.resource_type === "app_vault_secret" ? r.resource_id : null),
          kms_binding_id: r.resource_type === "app_vault_kms_binding" ? r.resource_id : null,
          version: ctx.version ?? ctx.to_version ?? null,
          from_version: ctx.from_version ?? null,
          to_version: ctx.to_version ?? null,
          fingerprint: ctx.fingerprint_sha256 ?? ctx.to_fingerprint ?? null,
          run_id: ctx.run_id ?? ctx.test_run_id ?? null,
          request_id: ctx.request_id ?? ctx.correlation_id ?? null,
        },
      };
    });

    return {
      rows: enriched,
      is_platform_admin: !!platAdmin,
      next_before_id: rows && rows.length === data.limit ? String(rows[rows.length - 1].id) : null,
    };
  });
