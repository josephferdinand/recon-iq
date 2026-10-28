import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FEATURE_CATALOG } from "@/lib/feature-flags.functions";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";

async function assertPlatformAdmin(ctx: any) {
  await requirePlatformAdmin(ctx, { fnName: "platform-ai" });
}

/* ---------------- Platform AI settings ---------------- */
export const getPlatformAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data } = await context.supabase
      .from("platform_ai_settings").select("*").eq("id", true).maybeSingle();
    return data;
  });

const PlatSchema = z.object({
  allow_copilot_global: z.boolean(),
  allow_agent_global: z.boolean(),
  allow_auto_remediation_global: z.boolean(),
  allow_byo_llm_global: z.boolean(),
  force_pii_redaction: z.boolean(),
  force_log_prompts: z.boolean(),
  default_model: z.string().min(2).max(120),
  default_autonomy_ceiling: z.enum(["suggest", "assist", "auto"]),
  global_allowed_models: z.array(z.string()).max(100),
  global_max_tokens_per_day: z.number().int().min(1000),
  global_max_agent_runs_per_day: z.number().int().min(1),
  global_max_cost_usd_per_day: z.number().min(0),
});
export const updatePlatformAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PlatSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase.from("platform_ai_settings")
      .update({ ...data, updated_by: context.userId, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, scope: "platform",
      action: "platform_ai.update", resource_type: "platform_ai_settings",
      resource_id: null, context: { default_autonomy_ceiling: data.default_autonomy_ceiling },
    } as any);
    return { ok: true };
  });

/* ---------------- Pricing ---------------- */
export const listModelPricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("ai_model_pricing")
      .select("provider_code,model_key,input_usd_per_1m,output_usd_per_1m")
      .eq("active", true)
      .order("provider_code")
      .order("model_key");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      model: `${row.provider_code}/${row.model_key}`,
      input_per_1k_usd: Number(row.input_usd_per_1m) / 1000,
      output_per_1k_usd: Number(row.output_usd_per_1m) / 1000,
    }));
  });

const PriceSchema = z.object({
  model: z.string().min(2),
  input_per_1k_usd: z.number().min(0),
  output_per_1k_usd: z.number().min(0),
});
export const upsertModelPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PriceSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const [providerCode, ...modelParts] = data.model.includes("/")
      ? data.model.split("/")
      : ["custom", data.model];
    const modelKey = modelParts.join("/");
    const { error } = await context.supabase.from("ai_model_pricing")
      .upsert({
        provider_code: providerCode,
        model_key: modelKey,
        currency: "USD",
        input_usd_per_1m: data.input_per_1k_usd * 1000,
        output_usd_per_1m: data.output_per_1k_usd * 1000,
        active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "provider_code,model_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Entitlements ---------------- */
export const listEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("tenant_feature_entitlements")
      .select("*").eq("tenant_id", data.tenant_id);
    const byKey = new Map((rows ?? []).map((r: any) => [r.feature_key, r]));
    return FEATURE_CATALOG.map((f) => ({
      ...f,
      allowed: byKey.has(f.key) ? !!byKey.get(f.key)!.allowed : true,
      plan_required: byKey.get(f.key)?.plan_required ?? "starter",
      locked_reason: byKey.get(f.key)?.locked_reason ?? null,
    }));
  });

const EntSchema = z.object({
  tenant_id: z.string().uuid(),
  feature_key: z.string().min(1).max(64),
  allowed: z.boolean(),
  plan_required: z.enum(["starter", "professional", "enterprise"]).default("starter"),
  locked_reason: z.string().max(500).optional().nullable(),
});
export const setEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => EntSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase.from("tenant_feature_entitlements")
      .upsert({ ...data, granted_by: context.userId } as any,
        { onConflict: "tenant_id,feature_key" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, scope: "platform", tenant_id: data.tenant_id,
      action: "entitlement.update", resource_type: "tenant_feature_entitlements",
      resource_id: null, context: { feature: data.feature_key, allowed: data.allowed },
    } as any);
    return { ok: true };
  });

/* ---------------- Entitlements matrix (all tenants × all features) ---------------- */
export const listEntitlementsMatrix = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const [{ data: tenants, error: tErr }, { data: rows, error: rErr }] = await Promise.all([
      context.supabase
        .from("tenants")
        .select("id, name, slug, environment")
        .order("name", { ascending: true }),
      context.supabase
        .from("tenant_feature_entitlements")
        .select("tenant_id, feature_key, allowed, plan_required, locked_reason"),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (rErr) throw new Error(rErr.message);

    const byTenant = new Map<string, Map<string, any>>();
    for (const r of rows ?? []) {
      const t = byTenant.get((r as any).tenant_id) ?? new Map();
      t.set((r as any).feature_key, r);
      byTenant.set((r as any).tenant_id, t);
    }

    return {
      features: FEATURE_CATALOG.map((f) => ({
        key: f.key, label: f.label, category: f.category, default: f.default,
      })),
      tenants: (tenants ?? []).map((t: any) => {
        const t_ents = byTenant.get(t.id) ?? new Map();
        const ents: Record<string, { allowed: boolean; plan_required: string; locked_reason: string | null; overridden: boolean }> = {};
        for (const f of FEATURE_CATALOG) {
          const row = t_ents.get(f.key);
          ents[f.key] = {
            allowed: row ? !!row.allowed : true,
            plan_required: row?.plan_required ?? "starter",
            locked_reason: row?.locked_reason ?? null,
            overridden: !!row,
          };
        }
        return { id: t.id, name: t.name, slug: t.slug, environment: t.environment, entitlements: ents };
      }),
    };
  });
