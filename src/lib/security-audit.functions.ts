import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Security-relevant audit events:
 *   - auth.* (sign-in, sign-out, MFA, step-up, SSO)
 *   - rls.* / policy.* (denied writes, policy mutations)
 *   - secdef.*  (sensitive SECURITY DEFINER invocations)
 *   - break_glass.*  (emergency access)
 *   - rbac.* / role.*  (role grants, group changes)
 */
const SECURITY_ACTION_PREFIXES = [
  "auth.",
  "mfa.",
  "sso.",
  "step_up.",
  "rls.",
  "policy.",
  "secdef.",
  "break_glass.",
  "rbac.",
  "role.",
  "ip_allowlist.",
] as const;

export const listTenantSecurityEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        limit: z.number().int().min(1).max(500).default(100),
        since_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
        action_prefix: z.string().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    // Authz: caller must be tenant member OR platform admin.
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (!isAdmin) {
      const { data: member } = await context.supabase
        .from("tenant_members")
        .select("role")
        .eq("tenant_id", data.tenant_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!member) throw new Error("Forbidden");
    }

    const since = new Date(Date.now() - data.since_hours * 3600_000).toISOString();
    const prefixes = data.action_prefix ? [data.action_prefix] : [...SECURITY_ACTION_PREFIXES];
    const orFilter = prefixes.map((p) => `action.ilike.${p}%`).join(",");

    const { data: rows, error } = await context.supabase
      .from("audit_log")
      .select(
        "id, occurred_at, actor_email, action, scope, resource_type, resource_id, client_ip, user_agent, context",
      )
      .eq("tenant_id", data.tenant_id)
      .gte("occurred_at", since)
      .or(orFilter)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);

    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      ...r,
      client_ip: r.client_ip == null ? null : String(r.client_ip),
    }));
  });
