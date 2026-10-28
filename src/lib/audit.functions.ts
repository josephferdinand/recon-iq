import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AuditInput = z.object({
  scope: z.enum(["platform", "tenant", "workspace"]),
  action: z.string().min(1).max(120),
  tenant_id: z.string().uuid().optional().nullable(),
  tenant_slug: z.string().optional().nullable(),
  resource_type: z.string().optional().nullable(),
  resource_id: z.string().optional().nullable(),
  context: z.record(z.string(), z.unknown()).default({}),
});

export const recordAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((data: unknown) => AuditInput.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      actor_email: (context.claims as any)?.email ?? null,
      scope: data.scope,
      action: data.action,
      tenant_id: data.tenant_id ?? null,
      tenant_slug: data.tenant_slug ?? null,
      resource_type: data.resource_type ?? null,
      resource_id: data.resource_id ?? null,
      context: data.context as any,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Server-side helper: write a tenant-scoped audit row whenever a platform
 * admin (or any actor) performs an action inside a tenant. Visible in the
 * tenant audit trail (RLS: tenant members) AND in platform audit (RLS:
 * platform admins). Hash-chained by DB trigger.
 */
export async function writeTenantAudit(
  supabase: any,
  args: {
    actor_user_id: string;
    actor_email?: string | null;
    tenant_id: string;
    tenant_slug?: string | null;
    action: string;
    resource_type?: string | null;
    resource_id?: string | null;
    context?: Record<string, unknown>;
    via_platform?: boolean;
  },
) {
  const ctx = { ...(args.context ?? {}) } as Record<string, unknown>;
  if (args.via_platform) ctx.via_platform_admin = true;
  const { error } = await supabase.from("audit_log").insert({
    actor_user_id: args.actor_user_id,
    actor_email: args.actor_email ?? null,
    scope: "tenant",
    action: args.action,
    tenant_id: args.tenant_id,
    tenant_slug: args.tenant_slug ?? null,
    resource_type: args.resource_type ?? null,
    resource_id: args.resource_id ?? null,
    context: ctx as any,
  } as any);
  if (error) throw new Error(error.message);
}

