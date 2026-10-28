import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TenantInput = z.object({ tenantId: z.string().uuid() });

// ---------- Legacy tenant_ai_settings (kept for AiGovernanceTab) ----------
export const getAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tenant_ai_settings")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (row) return row;
    const { data: created, error: insErr } = await context.supabase
      .from("tenant_ai_settings")
      .insert({ tenant_id: data.tenant_id })
      .select("*")
      .single();
    if (insErr) throw new Error(insErr.message);
    return created;
  });

export const upsertAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      allow_copilot: z.boolean().optional(),
      allow_agent: z.boolean().optional(),
      allow_auto_remediation: z.boolean().optional(),
      allow_byo_llm: z.boolean().optional(),
      default_model: z.string().optional(),
      default_autonomy: z.enum(["read_only", "supervised", "autonomous"]).optional(),
      redact_pii_default: z.boolean().optional(),
      log_prompts: z.boolean().optional(),
      max_tokens_per_day: z.number().int().min(0).optional(),
      max_agent_runs_per_day: z.number().int().min(0).optional(),
      allowed_models: z.array(z.string()).optional(),
    }).passthrough().parse(d)
  )
  .handler(async ({ data, context }) => {
    const { tenant_id, ...rest } = data;
    // Verify tenant_admin (or platform admin) may write governance flags.
    const { data: canWrite } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: tenant_id, _role: "tenant_admin",
    });
    const { data: isPlat } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!canWrite && !isPlat) throw new Error("Forbidden: tenant_admin required");
    const { data: before } = await context.supabase
      .from("tenant_ai_settings").select("*").eq("tenant_id", tenant_id).maybeSingle();
    const { error } = await context.supabase
      .from("tenant_ai_settings")
      .upsert({ tenant_id, ...rest, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id, scope: "tenant",
      action: "ai_settings.updated", resource_type: "tenant_ai_settings", resource_id: tenant_id,
      context: { before: before ?? null, after: rest },
    } as any);
    return { ok: true };
  });

export const listAiGovernanceOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => TenantInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [models, thresholds, hitl, alerts, kill, logCount] = await Promise.all([
      supabase.from("ai_governance_models").select("*").eq("tenant_id", data.tenantId).order("updated_at", { ascending: false }),
      supabase.from("ai_governance_confidence_thresholds").select("*").eq("tenant_id", data.tenantId).order("scope"),
      supabase.from("ai_governance_hitl_queue").select("*").eq("tenant_id", data.tenantId).order("created_at", { ascending: false }).limit(100),
      supabase.from("ai_governance_drift_alerts").select("*").eq("tenant_id", data.tenantId).order("created_at", { ascending: false }).limit(50),
      supabase.from("ai_governance_kill_switches").select("*").eq("tenant_id", data.tenantId).order("scope"),
      supabase.from("ai_governance_prompt_log").select("id", { count: "exact", head: true }).eq("tenant_id", data.tenantId),
    ]);
    return {
      models: models.data ?? [],
      thresholds: thresholds.data ?? [],
      hitl: hitl.data ?? [],
      alerts: alerts.data ?? [],
      killSwitches: kill.data ?? [],
      promptLogCount: logCount.count ?? 0,
    };
  });

export const upsertConfidenceThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenantId: z.string().uuid(),
      scope: z.string().min(1).max(64),
      minConfidence: z.number().min(0).max(1),
      hitlBelow: z.number().min(0).max(1),
      blockBelow: z.number().min(0).max(1),
      enabled: z.boolean(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ai_governance_confidence_thresholds").upsert(
      {
        tenant_id: data.tenantId,
        scope: data.scope,
        min_confidence: data.minConfidence,
        hitl_below: data.hitlBelow,
        block_below: data.blockBelow,
        enabled: data.enabled,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,scope" }
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const decideHitlItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      rationale: z.string().min(1).max(2000),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    // Verify item belongs to a tenant the caller is a member of.
    const { data: item } = await context.supabase
      .from("ai_governance_hitl_queue").select("id, tenant_id").eq("id", data.id).maybeSingle();
    if (!item) throw new Error("HITL item not found");
    const { data: canWrite } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: (item as any).tenant_id, _role: "tenant_admin",
    });
    const { data: isPlat } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!canWrite && !isPlat) throw new Error("Forbidden: tenant_admin required");
    const { error } = await context.supabase
      .from("ai_governance_hitl_queue")
      .update({
        status: data.decision,
        reviewer_id: context.userId,
        decision_rationale: data.rationale,
        decided_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("tenant_id", (item as any).tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: (item as any).tenant_id, scope: "tenant",
      action: "ai_governance.hitl.decided", resource_type: "ai_governance_hitl_queue", resource_id: data.id,
      context: { decision: data.decision },
    } as any);
    return { ok: true };
  });

export const engageKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenantId: z.string().uuid(),
      scope: z.string().min(1).max(64).default("global"),
      reason: z.string().min(3).max(500),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("engage_ai_kill_switch", {
      p_tenant: data.tenantId,
      p_scope: data.scope,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const releaseKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenantId: z.string().uuid(), scope: z.string().min(1).max(64) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("release_ai_kill_switch", {
      p_tenant: data.tenantId,
      p_scope: data.scope,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const evaluateModelDrift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ modelId: z.string().uuid(), windowHours: z.number().int().min(1).max(720).default(24) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("evaluate_ai_drift", {
      p_model_id: data.modelId,
      p_window_hours: data.windowHours,
    });
    if (error) throw new Error(error.message);
    return row;
  });

export const acknowledgeDriftAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), notes: z.string().max(1000).optional() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_governance_drift_alerts")
      .update({
        status: "acknowledged",
        acknowledged_by: context.userId,
        acknowledged_at: new Date().toISOString(),
        notes: data.notes ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const registerGovernedModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenantId: z.string().uuid(),
      name: z.string().min(1).max(120),
      provider: z.string().min(1).max(60),
      modelId: z.string().min(1).max(120),
      promptTemplate: z.string().optional(),
      riskTier: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const promptHash = data.promptTemplate
      ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.promptTemplate)).then((b) =>
          Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("")
        )
      : null;
    const { error } = await context.supabase.from("ai_governance_models").insert({
      tenant_id: data.tenantId,
      name: data.name,
      provider: data.provider,
      model_id: data.modelId,
      prompt_template: data.promptTemplate,
      prompt_hash: promptHash,
      risk_tier: data.riskTier,
      owner_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveGovernedModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_governance_models")
      .update({
        status: "approved",
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
