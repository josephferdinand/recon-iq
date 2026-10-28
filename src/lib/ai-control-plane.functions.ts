import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- types ----------
export type ProviderRegistry = {
  id: string;
  code: string;
  display_name: string;
  kind: "managed" | "byo" | "self_hosted";
  auth_methods: string[];
  default_endpoint_template: string | null;
  required_headers: Record<string, string>;
  capabilities: Record<string, boolean>;
  docs_url: string | null;
  enabled: boolean;
  sort_order: number;
};

export type ProviderInstance = {
  id: string;
  provider_code: string;
  tenant_id: string | null;
  display_name: string;
  endpoint: string | null;
  region: string | null;
  auth_method: string;
  vault_secret_id: string | null;
  custom_headers: Record<string, string>;
  api_version: string | null;
  status: "draft" | "active" | "disabled" | "retired";
  health_status: "unknown" | "healthy" | "degraded" | "down";
  last_healthcheck_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ModelCatalogEntry = {
  id: string;
  provider_instance_id: string;
  model_key: string;
  display_name: string;
  version: string | null;
  context_window: number | null;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  capabilities: Record<string, boolean>;
  approval_status: "proposed" | "approved" | "retired";
  availability_status: "available" | "limited" | "deprecated" | "unavailable";
  notes: string | null;
  updated_at: string;
};

export type GovernanceToggle = {
  id: string;
  scope: "platform" | "tenant";
  tenant_id: string | null;
  key: string;
  value: any;
  inherited_from: string | null;
  updated_at: string;
};

export type AgentGovernance = {
  id: string;
  scope: "platform" | "tenant";
  tenant_id: string | null;
  autonomy_ceiling: "suggestion_only" | "assisted" | "semi_autonomous" | "fully_autonomous";
  max_runtime_seconds: number;
  max_actions_per_run: number;
  max_concurrent_agents: number;
  approval_threshold_usd: number;
  high_risk_actions: string[];
};

export type RoutingPolicy = {
  id: string;
  name: string;
  scope: "platform" | "tenant";
  tenant_id: string | null;
  strategy: string;
  chain: Array<{ model_catalog_id: string; weight?: number; condition?: string }> | any;
  conditions: Record<string, any>;
  enabled: boolean;
  priority: number;
  updated_at: string;
};

export type AiQuota = {
  id: string;
  tenant_id: string;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  input_token_limit: number | null;
  output_token_limit: number | null;
  cached_token_limit: number | null;
  agent_execution_limit: number | null;
  api_request_limit: number | null;
  budget_limit_usd: number | null;
  override_active: boolean;
  override_reason: string | null;
  override_expires_at: string | null;
};

export type AiAdminAuditRow = {
  id: string;
  actor_id: string | null;
  tenant_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  context: any;
  occurred_at: string;
};

// ---------- helpers ----------
async function writeAudit(
  supabase: any,
  actorId: string,
  args: { action: string; entity_type: string; entity_id?: string | null; tenant_id?: string | null; before?: unknown; after?: unknown; context?: Record<string, unknown> },
) {
  await supabase.from("ai_admin_audit").insert({
    actor_id: actorId,
    tenant_id: args.tenant_id ?? null,
    action: args.action,
    entity_type: args.entity_type,
    entity_id: args.entity_id ?? null,
    before: args.before ?? null,
    after: args.after ?? null,
    context: args.context ?? {},
  });
}

// ---------- reads ----------
export const listProviderRegistry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_provider_registry")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ProviderRegistry[];
  });

export const listProviderInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { tenant_id?: string | null })
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("ai_provider_instances").select("*").order("updated_at", { ascending: false });
    if (data.tenant_id === null) q = q.is("tenant_id", null);
    else if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as ProviderInstance[];
  });

export const listModelCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_model_catalog")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ModelCatalogEntry[];
  });

export const listGovernanceToggles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { tenant_id?: string | null })
  .handler(async ({ data, context }) => {
    const scope = data.tenant_id ? "tenant" : "platform";
    let q = context.supabase.from("ai_governance_toggles").select("*").eq("scope", scope);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q.order("key");
    if (error) throw new Error(error.message);
    return (rows ?? []) as GovernanceToggle[];
  });

export const getAgentGovernance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { tenant_id?: string | null })
  .handler(async ({ data, context }) => {
    const scope = data.tenant_id ? "tenant" : "platform";
    let q = context.supabase.from("ai_agent_governance").select("*").eq("scope", scope);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    else q = q.is("tenant_id", null);
    const { data: row, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as AgentGovernance | null;
  });

export const listRoutingPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { tenant_id?: string | null })
  .handler(async ({ data, context }) => {
    const scope = data.tenant_id ? "tenant" : "platform";
    let q = context.supabase.from("ai_routing_policies").select("*").eq("scope", scope).order("priority");
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as RoutingPolicy[];
  });

export const listAiQuotas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("ai_quotas").select("*").order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as AiQuota[];
  });

export const listAdminAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { limit?: number; tenant_id?: string | null })
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("ai_admin_audit")
      .select("id, actor_id, tenant_id, action, entity_type, entity_id, context, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(Math.min(data.limit ?? 100, 500));
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as AiAdminAuditRow[];
  });

// ---------- executive dashboard aggregate ----------
export const getExecutiveDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

    const [providers, models, usageDay, usageMonth, hitl, driftAlerts, kills] = await Promise.all([
      context.supabase.from("ai_provider_instances").select("id,status,health_status", { count: "exact" }),
      context.supabase.from("ai_model_catalog").select("id,approval_status,availability_status", { count: "exact" }),
      context.supabase.from("ai_usage_events").select("tokens_in,tokens_out,cost_usd").gte("created_at", dayAgo),
      context.supabase.from("ai_usage_events").select("tokens_in,tokens_out,cost_usd,model,tenant_id").gte("created_at", monthAgo).limit(5000),
      context.supabase.from("ai_governance_hitl_queue").select("id", { count: "exact", head: true }),
      context.supabase.from("ai_governance_drift_alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
      context.supabase.from("ai_governance_kill_switches").select("id", { count: "exact", head: true }).eq("engaged", true),
    ]);

    const sumTokens = (rows: any[] | null) => (rows ?? []).reduce((a, r) => a + (r.tokens_in ?? 0) + (r.tokens_out ?? 0), 0);
    const sumCost = (rows: any[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);

    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byTenant: Record<string, number> = {};
    (usageMonth.data ?? []).forEach((r: any) => {
      const c = Number(r.cost_usd ?? 0);
      const providerKey = (r.model ?? "unknown").split(/[/:]/)[0] || "unknown";
      byProvider[providerKey] = (byProvider[providerKey] ?? 0) + c;
      byModel[r.model ?? "unknown"] = (byModel[r.model ?? "unknown"] ?? 0) + c;
      if (r.tenant_id) byTenant[r.tenant_id] = (byTenant[r.tenant_id] ?? 0) + c;
    });

    return {
      providers: {
        total: providers.count ?? 0,
        active: (providers.data ?? []).filter((p: any) => p.status === "active").length,
        healthy: (providers.data ?? []).filter((p: any) => p.health_status === "healthy").length,
      },
      models: {
        total: models.count ?? 0,
        approved: (models.data ?? []).filter((m: any) => m.approval_status === "approved").length,
      },
      usage: {
        tokens_day: sumTokens(usageDay.data),
        tokens_month: sumTokens(usageMonth.data),
        cost_day_usd: sumCost(usageDay.data),
        cost_month_usd: sumCost(usageMonth.data),
      },
      cost_breakdown: {
        by_provider: Object.entries(byProvider).map(([k, v]) => ({ label: k, value: Number(v.toFixed(2)) })).sort((a, b) => b.value - a.value).slice(0, 8),
        by_model: Object.entries(byModel).map(([k, v]) => ({ label: k, value: Number(v.toFixed(2)) })).sort((a, b) => b.value - a.value).slice(0, 8),
        by_tenant: Object.entries(byTenant).map(([k, v]) => ({ label: k, value: Number(v.toFixed(2)) })).sort((a, b) => b.value - a.value).slice(0, 8),
      },
      risk: {
        hitl_pending: hitl.count ?? 0,
        drift_alerts_open: driftAlerts.count ?? 0,
        kill_switches_engaged: kills.count ?? 0,
      },
    };
  });

// ---------- mutations ----------
export const upsertProviderInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => d as Partial<ProviderInstance> & { provider_code: string; display_name: string })
  .handler(async ({ data, context }) => {
    const payload = { ...data, created_by: data.id ? undefined : context.userId };
    const { data: row, error } = await context.supabase
      .from("ai_provider_instances")
      .upsert(payload as any, { onConflict: "id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(context.supabase, context.userId, {
      action: data.id ? "provider.updated" : "provider.created",
      entity_type: "ai_provider_instance",
      entity_id: row.id,
      tenant_id: row.tenant_id,
      after: { display_name: row.display_name, provider_code: row.provider_code, status: row.status },
    });
    return row as ProviderInstance;
  });

export const setProviderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => d as { id: string; status: ProviderInstance["status"] })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ai_provider_instances").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(context.supabase, context.userId, {
      action: `provider.${data.status}`,
      entity_type: "ai_provider_instance",
      entity_id: data.id,
      after: { status: data.status },
    });
    return { ok: true };
  });

export const upsertModelCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => d as Partial<ModelCatalogEntry> & { provider_instance_id: string; model_key: string; display_name: string })
  .handler(async ({ data, context }) => {
    const payload = { ...data, created_by: data.id ? undefined : context.userId };
    const { data: row, error } = await context.supabase
      .from("ai_model_catalog")
      .upsert(payload as any, { onConflict: "id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(context.supabase, context.userId, {
      action: data.id ? "model.updated" : "model.created",
      entity_type: "ai_model_catalog",
      entity_id: row.id,
      after: { model_key: row.model_key, approval_status: row.approval_status },
    });
    return row as ModelCatalogEntry;
  });

export const setModelStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => d as { id: string; approval_status?: ModelCatalogEntry["approval_status"]; availability_status?: ModelCatalogEntry["availability_status"] })
  .handler(async ({ data, context }) => {
    const patch: any = {};
    if (data.approval_status) patch.approval_status = data.approval_status;
    if (data.availability_status) patch.availability_status = data.availability_status;
    const { error } = await context.supabase.from("ai_model_catalog").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(context.supabase, context.userId, { action: "model.status_changed", entity_type: "ai_model_catalog", entity_id: data.id, after: patch });
    return { ok: true };
  });

export const setGovernanceToggle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => d as { scope: "platform" | "tenant"; tenant_id?: string | null; key: string; value: unknown })
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("ai_governance_toggles")
      .select("value")
      .eq("scope", data.scope)
      .eq("key", data.key)
      .maybeSingle();
    const { data: row, error } = await context.supabase
      .from("ai_governance_toggles")
      .upsert({ scope: data.scope, tenant_id: data.tenant_id ?? null, key: data.key, value: data.value as any, updated_by: context.userId }, { onConflict: "scope,tenant_id,key" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(context.supabase, context.userId, {
      action: "governance.toggled",
      entity_type: "ai_governance_toggle",
      entity_id: row.id,
      tenant_id: data.tenant_id ?? null,
      before: { key: data.key, value: existing?.value },
      after: { key: data.key, value: data.value },
    });
    return row as GovernanceToggle;
  });

export const setAgentGovernance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => d as Partial<AgentGovernance> & { scope: "platform" | "tenant" })
  .handler(async ({ data, context }) => {
    const payload = { ...data, updated_by: context.userId };
    const { data: row, error } = await context.supabase
      .from("ai_agent_governance")
      .upsert(payload as any, { onConflict: "scope,tenant_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(context.supabase, context.userId, {
      action: "agent_governance.updated",
      entity_type: "ai_agent_governance",
      entity_id: row.id,
      tenant_id: data.tenant_id ?? null,
      after: payload,
    });
    return row as AgentGovernance;
  });

export const upsertRoutingPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => d as Partial<RoutingPolicy> & { name: string; scope: "platform" | "tenant"; strategy: string; chain: unknown[] })
  .handler(async ({ data, context }) => {
    const payload = { ...data, created_by: data.id ? undefined : context.userId };
    const { data: row, error } = await context.supabase
      .from("ai_routing_policies")
      .upsert(payload as any, { onConflict: "id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(context.supabase, context.userId, {
      action: data.id ? "routing.updated" : "routing.created",
      entity_type: "ai_routing_policy",
      entity_id: row.id,
      tenant_id: row.tenant_id,
      after: { name: row.name, strategy: row.strategy, chain_length: (row.chain as any[])?.length ?? 0 },
    });
    return row as RoutingPolicy;
  });

export const upsertAiQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => d as Partial<AiQuota> & { tenant_id: string })
  .handler(async ({ data, context }) => {
    const payload = { ...data, updated_by: context.userId };
    const { data: row, error } = await context.supabase
      .from("ai_quotas")
      .upsert(payload as any, { onConflict: "tenant_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(context.supabase, context.userId, {
      action: "quota.updated",
      entity_type: "ai_quotas",
      entity_id: row.id,
      tenant_id: row.tenant_id,
      after: { budget_usd: row.budget_limit_usd, monthly_tokens: row.monthly_token_limit, override: row.override_active },
    });
    return row as AiQuota;
  });

// ---------- vault (masked writes only; raw never returned) ----------
// Vault writes go through the existing SecretsTab / VaultTab surfaces which own
// the full envelope-encryption pipeline (DEK/KEK, wrapped_dek, iv, auth_tag).
// Here we only expose masked reads so the AI Control Plane can bind a provider
// instance to an already-stored secret without ever touching cleartext.
export const listVaultSecrets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { tenant_id?: string | null })
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("app_vault_secrets")
      .select("id, name, scope, tenant_id, secret_class, kek_provider, masked_preview, mask_style, last4, created_at, updated_at, rotated_at, version")
      .order("updated_at", { ascending: false });
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    else if (data.tenant_id === null) q = q.is("tenant_id", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

