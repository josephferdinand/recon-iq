/**
 * Server functions for the Platform Admin Gap-Closure surfaces (G-1..G-41).
 *
 * All handlers gate on `is_platform_admin(auth.uid())` via a shared helper.
 * Table access is done via the authenticated supabase client from
 * `requireSupabaseAuth` context, so RLS is respected.
 *
 * Tables are referenced with `.from("<name>" as never)` because they were
 * created in the same batch as this file and are not yet in the generated
 * `Database` type; the Supabase Data API still enforces RLS at runtime.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function assertPlatformAdmin(context: any) {
  await requirePlatformAdmin(context, { fnName: "platform-gap" });
}

const sb = (ctx: any) => ctx.supabase;
const T = (name: string) => name as never;

/* ============================================================ *
 *  G-1/G-8/G-9  Revenue + tenant health
 * ============================================================ */

export const listRevenueSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_revenue_snapshots"))
      .select("*")
      .order("snapshot_date", { ascending: false })
      .limit(365);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertRevenueSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        snapshot_date: z.string(),
        mrr_cents: z.number().int().nonnegative(),
        arr_cents: z.number().int().nonnegative(),
        new_mrr_cents: z.number().int().nonnegative().default(0),
        expansion_mrr_cents: z.number().int().nonnegative().default(0),
        churned_mrr_cents: z.number().int().nonnegative().default(0),
        logo_churn_pct: z.number().default(0),
        revenue_churn_pct: z.number().default(0),
        active_tenants: z.number().int().default(0),
        paying_tenants: z.number().int().default(0),
        monthly_active_users: z.number().int().default(0),
        storage_bytes: z.number().int().default(0),
        api_calls_30d: z.number().int().default(0),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_revenue_snapshots"))
      .upsert(data, { onConflict: "snapshot_date" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTenantHealthScores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_tenant_health_scores"))
      .select("*")
      .order("score", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ============================================================ *
 *  G-2  Invoices + billing alerts
 * ============================================================ */

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_invoices"))
      .select("*")
      .order("issued_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listBillingAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_billing_alerts"))
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const acknowledgeBillingAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_billing_alerts"))
      .update({
        status: "acknowledged",
        acknowledged_by: context.userId,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-3  Tax + dunning
 * ============================================================ */

export const listTaxConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_tax_configs"))
      .select("*")
      .order("country_code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertTaxConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        country_code: z.string().length(2),
        region_code: z.string().optional().nullable(),
        provider: z.string().default("stripe_tax"),
        provider_account_id: z.string().optional().nullable(),
        registration_number: z.string().optional().nullable(),
        active: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_tax_configs"))
      .upsert(data, { onConflict: "country_code,region_code,provider" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDunningEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_dunning_events"))
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ============================================================ *
 *  G-4  Forecasts + chargeback
 * ============================================================ */

export const listRevenueForecasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_revenue_forecasts"))
      .select("*")
      .order("forecast_month");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertRevenueForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        forecast_month: z.string(),
        scenario: z.enum(["base", "optimistic", "conservative"]),
        predicted_mrr_cents: z.number().int(),
        predicted_arr_cents: z.number().int(),
        confidence_pct: z.number(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_revenue_forecasts"))
      .upsert(data, { onConflict: "forecast_month,scenario" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listChargebacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_department_chargebacks"))
      .select("*")
      .order("period_month", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ============================================================ *
 *  G-5  Contract vault
 * ============================================================ */

export const listContracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_contracts"))
      .select("*")
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        tenant_id: z.string().uuid().nullable().optional(),
        contract_type: z.enum([
          "MSA",
          "DPA",
          "BAA",
          "SOW",
          "NDA",
          "SLA",
          "OrderForm",
          "Amendment",
          "Other",
        ]),
        title: z.string().min(1),
        counterparty: z.string().min(1),
        effective_date: z.string().nullable().optional(),
        expiry_date: z.string().nullable().optional(),
        auto_renew: z.boolean().default(false),
        renewal_notice_days: z.number().int().nullable().optional(),
        value_cents: z.number().int().nullable().optional(),
        currency: z.string().default("USD"),
        status: z
          .enum([
            "draft",
            "under_review",
            "active",
            "expired",
            "terminated",
            "superseded",
          ])
          .default("active"),
        storage_path: z.string().nullable().optional(),
        data_classification: z
          .enum(["public", "internal", "confidential", "restricted"])
          .default("confidential"),
        tags: z.array(z.string()).default([]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const payload: any = { ...data, owner_user_id: context.userId };
    let error;
    if (data.id) {
      ({ error } = await sb(context)
        .from(T("platform_contracts"))
        .update(payload)
        .eq("id", data.id));
    } else {
      ({ error } = await sb(context).from(T("platform_contracts")).insert(payload));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-13/G-14  Password + session policy
 * ============================================================ */

export const getGlobalPasswordPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data } = await sb(context)
      .from(T("platform_password_policies"))
      .select("*")
      .eq("scope", "global")
      .is("tenant_id", null)
      .maybeSingle();
    return data;
  });

export const savePasswordPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        min_length: z.number().int().min(6).max(128),
        require_upper: z.boolean(),
        require_lower: z.boolean(),
        require_number: z.boolean(),
        require_symbol: z.boolean(),
        disallow_reuse_last: z.number().int().min(0).max(50),
        max_age_days: z.number().int().min(0).max(3650),
        warn_before_days: z.number().int().min(0).max(365),
        hibp_check: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    // Look for existing global row.
    const { data: existing } = await sb(context)
      .from(T("platform_password_policies"))
      .select("id")
      .eq("scope", "global")
      .is("tenant_id", null)
      .maybeSingle();
    const payload: any = {
      scope: "global",
      tenant_id: null,
      updated_by: context.userId,
      ...data,
    };
    let error;
    if (existing?.id) {
      ({ error } = await sb(context)
        .from(T("platform_password_policies"))
        .update(payload)
        .eq("id", existing.id));
    } else {
      ({ error } = await sb(context)
        .from(T("platform_password_policies"))
        .insert(payload));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getGlobalSessionPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data } = await sb(context)
      .from(T("platform_session_policies"))
      .select("*")
      .eq("scope", "global")
      .is("tenant_id", null)
      .maybeSingle();
    return data;
  });

export const saveSessionPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        single_session_mode: z.boolean(),
        idle_timeout_minutes: z.number().int().min(1).max(1440),
        absolute_timeout_hours: z.number().int().min(1).max(720),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { data: existing } = await sb(context)
      .from(T("platform_session_policies"))
      .select("id")
      .eq("scope", "global")
      .is("tenant_id", null)
      .maybeSingle();
    const payload: any = {
      scope: "global",
      tenant_id: null,
      updated_by: context.userId,
      ...data,
    };
    let error;
    if (existing?.id) {
      ({ error } = await sb(context)
        .from(T("platform_session_policies"))
        .update(payload)
        .eq("id", existing.id));
    } else {
      ({ error } = await sb(context)
        .from(T("platform_session_policies"))
        .insert(payload));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-16  Data classification
 * ============================================================ */

export const listDataClassifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_data_classifications"))
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setDataClassification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        resource_kind: z.string().min(1),
        resource_id: z.string().min(1),
        classification: z.enum([
          "public",
          "internal",
          "confidential",
          "restricted",
        ]),
        reason: z.string().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_data_classifications"))
      .upsert(
        { ...data, set_by: context.userId },
        { onConflict: "resource_kind,resource_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-17/G-18  Policy versions + simulations
 * ============================================================ */

export const listPolicySimulations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_policy_simulations"))
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const runPolicySimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        policy_kind: z.string(),
        policy_id: z.string(),
        proposed_snapshot: z.record(z.string(), z.any()),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    // Best-effort blast radius: tenant + user counts.
    const [{ count: tenantCount }, { count: userCount }] = await Promise.all([
      sb(context)
        .from(T("tenants"))
        .select("id", { count: "exact", head: true }),
      sb(context)
        .from(T("tenant_members"))
        .select("id", { count: "exact", head: true }),
    ]);
    const affected_tenants = tenantCount ?? 0;
    const affected_users = userCount ?? 0;
    const risk_band =
      affected_users > 1000
        ? "critical"
        : affected_users > 250
          ? "high"
          : affected_users > 25
            ? "medium"
            : "low";
    const { data: inserted, error } = await sb(context)
      .from(T("platform_policy_simulations"))
      .insert({
        policy_kind: data.policy_kind,
        policy_id: data.policy_id,
        proposed_snapshot: data.proposed_snapshot,
        blast_radius: {
          tenants: affected_tenants,
          users: affected_users,
          computed_at: new Date().toISOString(),
        },
        affected_tenants,
        affected_users,
        risk_band,
        ran_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const listPolicyVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({ policy_kind: z.string(), policy_id: z.string() })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { data: rows, error } = await sb(context)
      .from(T("platform_policy_versions"))
      .select("*")
      .eq("policy_kind", data.policy_kind)
      .eq("policy_id", data.policy_id)
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* ============================================================ *
 *  G-19  Geo restrictions
 * ============================================================ */

export const listGeoRestrictions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_geo_restrictions"))
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertGeoRestriction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        scope: z.enum(["global", "tenant"]),
        tenant_id: z.string().uuid().nullable().optional(),
        mode: z.enum(["allow", "block"]),
        country_codes: z.array(z.string().length(2)),
        reason: z.string().optional().nullable(),
        active: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const payload: any = { ...data, created_by: context.userId };
    let error;
    if (data.id) {
      ({ error } = await sb(context)
        .from(T("platform_geo_restrictions"))
        .update(payload)
        .eq("id", data.id));
    } else {
      ({ error } = await sb(context)
        .from(T("platform_geo_restrictions"))
        .insert(payload));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-20  Model risk rating (extend ai_governance_models)
 * ============================================================ */

export const listAiModelsWithRisk = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("ai_governance_models"))
      .select("*")
      .order("model_name", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setModelRiskRating = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        risk_rating: z.enum(["low", "medium", "high", "critical"]),
        risk_notes: z.string().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("ai_governance_models"))
      .update({
        risk_rating: data.risk_rating,
        risk_notes: data.risk_notes ?? null,
        risk_reviewed_at: new Date().toISOString(),
        risk_reviewer: context.userId,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-21..G-24  Tenant lifecycle
 * ============================================================ */

export const listLifecycleOps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_tenant_lifecycle_ops"))
      .select("*")
      .order("requested_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const requestLifecycleOp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        op_kind: z.enum(["clone", "merge", "transfer", "archive", "restore"]),
        source_tenant_id: z.string().uuid().nullable().optional(),
        target_tenant_id: z.string().uuid().nullable().optional(),
        params: z.record(z.string(), z.any()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_tenant_lifecycle_ops"))
      .insert({ ...data, requested_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-28..G-30  Environments + deployments + rollback
 * ============================================================ */

export const listEnvironments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_environments"))
      .select("*")
      .order("tier");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listDeployments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_deployments"))
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const requestDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        environment_id: z.string().uuid(),
        release_tag: z.string().min(1),
        commit_sha: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_deployments"))
      .insert({ ...data, requested_by: context.userId, status: "pending_approval" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_deployments"))
      .update({ status: "approved", approved_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rollbackDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({ id: z.string().uuid(), rollback_reason: z.string().min(1) })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_deployments"))
      .update({
        status: "rolled_back",
        rolled_back_at: new Date().toISOString(),
        rollback_reason: data.rollback_reason,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-31/G-32  RCA hints + capacity
 * ============================================================ */

export const listRcaHints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_incident_rca_hints"))
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listCapacityForecasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_capacity_forecasts"))
      .select("*")
      .order("computed_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ============================================================ *
 *  G-33..G-36  Compliance bundles, PHI, risk, exceptions
 * ============================================================ */

export const listComplianceBundles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_compliance_bundles"))
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertComplianceBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        framework: z.enum([
          "SOC2",
          "ISO27001",
          "HIPAA",
          "GDPR",
          "PCI-DSS",
          "DORA",
          "FedRAMP",
        ]),
        bundle_name: z.string().min(1),
        period_start: z.string().nullable().optional(),
        period_end: z.string().nullable().optional(),
        status: z
          .enum(["draft", "in_review", "approved", "signed", "archived"])
          .default("draft"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const payload: any = { ...data, created_by: context.userId };
    let error;
    if (data.id) {
      ({ error } = await sb(context)
        .from(T("platform_compliance_bundles"))
        .update(payload)
        .eq("id", data.id));
    } else {
      ({ error } = await sb(context)
        .from(T("platform_compliance_bundles"))
        .insert(payload));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPhiMarkers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_phi_markers"))
      .select("*");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listRiskRegister = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_risk_register"))
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        risk_ref: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional().nullable(),
        category: z.string().default("operational"),
        inherent_likelihood: z.enum(["low", "medium", "high", "critical"]),
        inherent_impact: z.enum(["low", "medium", "high", "critical"]),
        residual_likelihood: z.enum(["low", "medium", "high", "critical"]),
        residual_impact: z.enum(["low", "medium", "high", "critical"]),
        status: z
          .enum(["open", "mitigated", "accepted", "transferred", "closed"])
          .default("open"),
        next_review_date: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const payload: any = { ...data, owner_user_id: context.userId };
    let error;
    if (data.id) {
      ({ error } = await sb(context)
        .from(T("platform_risk_register"))
        .update(payload)
        .eq("id", data.id));
    } else {
      ({ error } = await sb(context)
        .from(T("platform_risk_register"))
        .insert(payload));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listExceptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_compliance_exceptions"))
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        exception_ref: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional().nullable(),
        control_ref: z.string().optional().nullable(),
        business_justification: z.string().optional().nullable(),
        compensating_controls: z.string().optional().nullable(),
        status: z
          .enum([
            "requested",
            "under_review",
            "approved",
            "rejected",
            "expired",
            "revoked",
          ])
          .default("requested"),
        effective_from: z.string().nullable().optional(),
        expires_at: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const payload: any = { ...data, requested_by: context.userId };
    let error;
    if (data.id) {
      ({ error } = await sb(context)
        .from(T("platform_compliance_exceptions"))
        .update(payload)
        .eq("id", data.id));
    } else {
      ({ error } = await sb(context)
        .from(T("platform_compliance_exceptions"))
        .insert(payload));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_compliance_exceptions"))
      .update({
        status: data.decision,
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-37/G-38/G-39  Theme palettes + command registry + saved commands
 * ============================================================ */

export const listThemePalettes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await sb(context)
      .from(T("platform_theme_palettes"))
      .select("*")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listCommandRegistry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await sb(context)
      .from(T("platform_command_registry"))
      .select("*")
      .eq("active", true)
      .order("category");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listSavedCommands = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await sb(context)
      .from(T("platform_saved_commands"))
      .select("*")
      .eq("user_id", context.userId)
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        label: z.string().min(1),
        command_key: z.string().min(1),
        params: z.record(z.string(), z.any()).default({}),
        hotkey: z.string().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await sb(context)
      .from(T("platform_saved_commands"))
      .upsert(
        { ...data, user_id: context.userId },
        { onConflict: "user_id,label" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSavedCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await sb(context)
      .from(T("platform_saved_commands"))
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  G-40  Hallucination metrics
 * ============================================================ */

export const listHallucinationMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_hallucination_metrics"))
      .select("*")
      .order("window_end", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ============================================================ *
 *  G-41  Load test results
 * ============================================================ */

export const listLoadTestResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_load_test_results"))
      .select("*")
      .order("ran_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const recordLoadTestResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        test_name: z.string(),
        target_users: z.number().int(),
        achieved_users: z.number().int(),
        duration_seconds: z.number().int(),
        p50_ms: z.number().int(),
        p95_ms: z.number().int(),
        p99_ms: z.number().int(),
        error_rate_pct: z.number(),
        throughput_rps: z.number().int(),
        report_url: z.string().url().nullable().optional(),
        passed: z.boolean(),
        notes: z.string().optional().nullable(),
        scenario: z.record(z.string(), z.any()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context)
      .from(T("platform_load_test_results"))
      .insert({ ...data, ran_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================ *
 *  Approvals: escalations, delegations, diffs
 * ============================================================ */

export const listEscalations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_approval_escalations"))
      .select("*")
      .order("breached_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listDelegations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await sb(context)
      .from(T("platform_approver_delegations"))
      .select("*")
      .order("starts_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertDelegation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        approver_user_id: z.string().uuid(),
        delegate_user_id: z.string().uuid(),
        scope: z.string().default("all"),
        starts_at: z.string().default(() => new Date().toISOString()),
        ends_at: z.string().nullable().optional(),
        reason: z.string().optional().nullable(),
        active: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    let error;
    if (data.id) {
      ({ error } = await sb(context)
        .from(T("platform_approver_delegations"))
        .update(data)
        .eq("id", data.id));
    } else {
      ({ error } = await sb(context)
        .from(T("platform_approver_delegations"))
        .insert(data));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });
