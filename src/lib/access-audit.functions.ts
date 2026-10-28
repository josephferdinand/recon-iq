import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  tenant_id: z.string().uuid(),
  scope: z.enum(["workspace", "tenant", "platform"]),
  page_key: z.string().min(1).max(120),
  page_label: z.string().min(1).max(200),
  required_permission: z.string().min(1).max(120),
  decision: z.enum(["allow", "deny"]),
  effective_sample: z.array(z.string()).max(50).optional(),
  user_id: z.string().uuid().optional(),
});

/**
 * Record an access decision (allow/deny) for a page or action into audit_log.
 * Fire-and-forget from PageGate / PermissionGate / Access Explorer "Verify".
 * audit_log row_hash + actor_user_id are set by DB triggers.
 */
export const logAccessDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      tenant_id: data.tenant_id,
      actor_user_id: data.user_id ?? context.userId,
      action: data.decision === "deny" ? "access.denied" : "access.checked",
      scope: data.scope,
      resource_type: "page",
      resource_id: data.page_key,
      context: {
        page_label: data.page_label,
        required_permission: data.required_permission,
        effective_sample: data.effective_sample ?? null,
        decision: data.decision,
      },
    } as any;
    const { error } = await context.supabase.from("audit_log").insert(row);
    if (error) {
      // Never throw — UX must not depend on audit.
      console.warn("[access-audit] insert failed:", error.message);
      return { ok: false };
    }
    return { ok: true };
  });

/* ---------------- Surface-level access denials (platform-scope) ---------------- */

const SurfaceInput = z.object({
  surface: z.string().min(1).max(120),
  reason: z.string().min(1).max(200),
  required_role: z.string().max(120).optional(),
  path: z.string().max(400).optional(),
  referrer: z.string().max(400).optional(),
  context: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Record a blocked attempt to open a platform-scoped surface (e.g. the
 * "Marketing / Public Site Admin" card on /console or the /mkt-admin route).
 * Resolves the actor's platform + tenant scope server-side and writes a
 * single `access.denied` audit_log row. Never throws — UX must not depend
 * on audit.
 */
export const recordAccessDenied = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => SurfaceInput.parse(d))
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const email = (context.claims as any)?.email ?? null;

    try {
      const [{ data: platformRows }, { data: superFlag }, { data: adminFlag }, { data: tenantRows }] = await Promise.all([
        context.supabase.from("platform_roles").select("role").eq("user_id", uid),
        context.supabase.rpc("is_platform_super_admin", { _user_id: uid }),
        context.supabase.rpc("is_platform_admin", { _user_id: uid }),
        context.supabase
          .from("tenant_members")
          .select("tenant_id, role, tenants:tenant_id(slug, name)")
          .eq("user_id", uid)
          .limit(50),
      ]);

      const platform_roles = (platformRows ?? []).map((r: any) => r.role);
      const tenant_memberships = (tenantRows ?? []).map((r: any) => ({
        tenant_id: r.tenant_id,
        tenant_slug: r.tenants?.slug ?? null,
        tenant_name: r.tenants?.name ?? null,
        role: r.role,
      }));

      const actor_scope = {
        is_platform_super_admin: Boolean(superFlag),
        is_platform_admin: Boolean(adminFlag),
        platform_roles,
        tenant_memberships,
      };

      const { error } = await context.supabase.from("audit_log").insert({
        actor_user_id: uid,
        actor_email: email,
        scope: "platform",
        action: "access.denied",
        resource_type: "surface",
        resource_id: data.surface,
        context: {
          surface: data.surface,
          reason: data.reason,
          required_role: data.required_role ?? null,
          path: data.path ?? null,
          referrer: data.referrer ?? null,
          actor_scope,
          ...data.context,
        } as any,
      } as any);
      if (error) {
        console.warn("[access-audit] surface insert failed:", error.message);
        return { ok: false };
      }
      return { ok: true, actor_scope };
    } catch (e: any) {
      console.warn("[access-audit] surface denied handler failed:", e?.message ?? e);
      return { ok: false };
    }
  });
