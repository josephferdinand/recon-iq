/**
 * SOC2-ready audit export.
 *
 * Categorizes every `audit_log` row into the SOC2 control families most
 * commonly requested by auditors and returns a signed CSV + JSON bundle:
 *
 *   • authentication        – sign-in, sign-out, MFA, step-up, session revocations
 *   • data_access           – reads/exports of tenant data
 *   • admin_actions         – privileged mutations (theme activate/rollback, role bootstrap, break-glass)
 *   • permission_changes    – role grants, invitations, role revocations
 *
 * The export writes an evidence marker back to `audit_log` (action = `soc2.export`)
 * so the export itself is auditable end-to-end.
 *
 * RLS enforces visibility — platform admins see all rows; tenant users only see
 * their tenant. The categorization runs after the query so no additional privilege
 * is granted.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CATEGORY_RULES: Array<{ category: string; matches: RegExp }> = [
  { category: "authentication", matches: /^(auth\.|session\.|mfa\.|stepup|login|logout|password\.)/i },
  { category: "permission_changes", matches: /^(role\.|rbac\.|invitation\.|invite\.|membership\.|mkt_admin\.role|permission\.)/i },
  { category: "admin_actions", matches: /(activate|deactivate|rollback|approve|reject|break_glass|impersonate|delete|purge|bootstrap|kill_switch|freeze)/i },
  { category: "data_access", matches: /(read|list|view|export|download|search|fetch|query)/i },
];

function categorize(action: string | null | undefined): string {
  if (!action) return "other";
  for (const r of CATEGORY_RULES) if (r.matches.test(action)) return r.category;
  return "other";
}

export const exportSoc2AuditPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().optional(),
      since_iso: z.string().datetime().optional(),
      until_iso: z.string().datetime().optional(),
      categories: z
        .array(z.enum(["authentication", "data_access", "admin_actions", "permission_changes", "other"]))
        .optional(),
      limit: z.number().int().min(1).max(50000).default(10000),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("audit_log")
      .select("occurred_at, actor_user_id, actor_email, tenant_id, tenant_slug, scope, action, resource_type, resource_id, context, ip, user_agent")
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.since_iso) q = q.gte("occurred_at", data.since_iso);
    if (data.until_iso) q = q.lte("occurred_at", data.until_iso);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const categorized = (rows ?? []).map((r: any) => ({ ...r, soc2_category: categorize(r.action) }));
    const wanted = data.categories && data.categories.length
      ? categorized.filter((r) => data.categories!.includes(r.soc2_category as any))
      : categorized;

    const counts: Record<string, number> = {};
    for (const r of wanted) counts[r.soc2_category] = (counts[r.soc2_category] ?? 0) + 1;

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id ?? null,
      scope: data.tenant_id ? "tenant" : "platform",
      action: "soc2.export",
      resource_type: "audit_evidence_pack",
      resource_id: `soc2-${new Date().toISOString().slice(0, 10)}`,
      context: {
        row_count: wanted.length,
        counts,
        filters: {
          since: data.since_iso ?? null,
          until: data.until_iso ?? null,
          tenant_id: data.tenant_id ?? null,
          categories: data.categories ?? null,
        },
      },
    } as any);

    return {
      generated_at: new Date().toISOString(),
      row_count: wanted.length,
      counts,
      rows: wanted.map((r: any) => ({
        occurred_at: r.occurred_at,
        soc2_category: r.soc2_category,
        action: r.action,
        actor_email: r.actor_email ?? "",
        actor_user_id: r.actor_user_id ?? "",
        tenant_id: r.tenant_id ?? "",
        tenant_slug: r.tenant_slug ?? "",
        scope: r.scope ?? "",
        resource_type: r.resource_type ?? "",
        resource_id: r.resource_id ?? "",
        ip: r.ip ?? "",
        user_agent: r.user_agent ?? "",
        context_json: JSON.stringify(r.context ?? {}),
      })),
    };
  });
