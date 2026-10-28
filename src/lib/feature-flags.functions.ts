import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

export const FEATURE_CATALOG: Array<{ key: string; label: string; description: string; default: boolean; category: string }> = [
  { key: "copilot",             label: "Copilot chat",          description: "Natural-language assistant inside the workspace.",  default: true,  category: "AI" },
  { key: "agent",               label: "Autonomous agent",      description: "Agentic AI loop for triage and root-cause.",        default: true,  category: "AI" },
  { key: "auto_match_ai",       label: "AI-assisted matching",  description: "ML-based suggestions for unmatched records.",       default: false, category: "AI" },
  { key: "auto_remediation",    label: "Auto-remediation",      description: "Agent may resolve low-severity breaks itself.",     default: false, category: "AI" },
  { key: "data_prep",           label: "Data Prep pipelines",   description: "Transform & validate data before reconciliation.",  default: true,  category: "Data" },
  { key: "data_watchers",       label: "Data watchers",         description: "Freshness, schema and DQ monitors with alerts.",    default: true,  category: "Data" },
  { key: "scheduled_connectors",label: "Scheduled connectors",  description: "SFTP/S3/API pull schedules.",                       default: true,  category: "Data" },
  { key: "webhooks",            label: "Outbound webhooks",     description: "HMAC-signed event delivery to your endpoints.",     default: true,  category: "Integrations" },
  { key: "sso_saml",            label: "SSO (SAML/OIDC)",       description: "Enterprise IdP login.",                             default: false, category: "Security" },
  { key: "ip_allowlist",        label: "IP allowlist",          description: "Restrict tenant access to CIDR ranges.",            default: false, category: "Security" },
  { key: "presence",            label: "Real-time presence",    description: "Show collaborators on breaks/rekons.",              default: true,  category: "Collab" },
  { key: "reports",             label: "Reports & analytics",   description: "Match rates, aging, MTTR, SLA dashboards.",         default: true,  category: "Insights" },
  { key: "break_manager",       label: "Break manager",         description: "Kanban triage with comments & attachments.",        default: true,  category: "Insights" },
  { key: "aidp",                label: "AIDP document processing", description: "Adaptive intelligent extraction from PDFs and scans.", default: false, category: "AI" },
  { key: "byo_llm",             label: "Bring-your-own LLM",    description: "Use your own Muse/Anthropic/Google keys.",        default: true,  category: "AI" },
  { key: "tenant_groups",       label: "Tenant groups & RBAC",  description: "Bundle users into groups and grant roles in bulk.", default: true,  category: "Security" },
  { key: "recon_rbac",          label: "Per-recon permissions", description: "Restrict access on individual reconciliations.",    default: true,  category: "Security" },
  { key: "cost_metering",       label: "AI cost metering",      description: "Track tokens and dollars per scope and model.",     default: true,  category: "AI" },
];

export const listFeatureFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: rows }, { data: ents }] = await Promise.all([
      context.supabase.from("tenant_feature_flags")
        .select("feature_key, enabled, config, updated_at")
        .eq("tenant_id", data.tenant_id),
      context.supabase.from("tenant_feature_entitlements")
        .select("feature_key, allowed, plan_required, locked_reason")
        .eq("tenant_id", data.tenant_id),
    ]);
    const byKey = new Map((rows ?? []).map((r: any) => [r.feature_key, r]));
    const entByKey = new Map((ents ?? []).map((e: any) => [e.feature_key, e]));
    return FEATURE_CATALOG.map((f) => {
      const ent = entByKey.get(f.key);
      const entitled = ent ? !!ent.allowed : true;
      return {
        ...f,
        enabled: entitled && (byKey.has(f.key) ? !!byKey.get(f.key)!.enabled : f.default),
        config: byKey.get(f.key)?.config ?? {},
        updated_at: byKey.get(f.key)?.updated_at ?? null,
        entitled,
        plan_required: ent?.plan_required ?? "starter",
        locked_reason: ent?.locked_reason ?? null,
      };
    });
  });

export const setFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      feature_key: z.string().min(1).max(64),
      enabled: z.boolean(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTenantAdmin(context, data.tenant_id, { fnName: "setFeatureFlag" });
    const { data: ent } = await context.supabase
      .from("tenant_feature_entitlements")
      .select("allowed, locked_reason")
      .eq("tenant_id", data.tenant_id).eq("feature_key", data.feature_key).maybeSingle();
    if (ent && ent.allowed === false) {
      throw new Error(ent.locked_reason || "Feature not included in your plan. Contact platform admin.");
    }
    const { error } = await context.supabase
      .from("tenant_feature_flags").upsert({
        tenant_id: data.tenant_id, feature_key: data.feature_key,
        enabled: data.enabled, updated_by: context.userId,
      } as any, { onConflict: "tenant_id,feature_key" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "tenant", action: "feature_flag.update",
      resource_type: "tenant_feature_flags", resource_id: null,
      context: { feature: data.feature_key, enabled: data.enabled },
    } as any);
    return { ok: true };
  });

export const getTenantRetention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("tenants").select("run_retention_days").eq("id", data.tenant_id).maybeSingle();
    return { run_retention_days: row?.run_retention_days ?? 90 };
  });

export const setTenantRetention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      run_retention_days: z.number().int().min(7).max(3650),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTenantAdmin(context, data.tenant_id, { fnName: "setTenantRetention" });
    const { error } = await context.supabase
      .from("tenants").update({ run_retention_days: data.run_retention_days })
      .eq("id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "tenant", action: "retention.update",
      resource_type: "tenants", resource_id: data.tenant_id,
      context: { run_retention_days: data.run_retention_days },
    } as any);
    return { ok: true };
  });
