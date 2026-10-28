/**
 * ERP Connector stubs — SAP, Oracle, Tally, Finacle, Flexcube.
 *
 * Each connector supports OAuth2, API key, basic auth, service account, or SSH-key
 * credential handling. Secrets are stored in the app vault (referenced by
 * `credential_vault_secret_id`); this module never accepts raw secrets over the wire.
 *
 * `testConnection` runs a stub health probe (or a live probe when explicit URL is set)
 * and records the result under `last_test_result`.
 *
 * Every connector emits a canonical reconciliation output schema — see
 * `docs/76_erp_connector_output_schemas.md`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

export const ERP_CONNECTOR_KINDS = ["sap", "oracle", "tally", "finacle", "flexcube"] as const;
export type ErpConnectorKind = typeof ERP_CONNECTOR_KINDS[number];

/** Canonical reconciliation output schema — same shape across every ERP source. */
export const RECON_ROW_SCHEMA = {
  version: "1.0",
  common: [
    { name: "external_id", type: "string", required: true, description: "Native record id in the source system." },
    { name: "posted_date", type: "date", required: true },
    { name: "value_date", type: "date", required: false },
    { name: "account_code", type: "string", required: true },
    { name: "account_name", type: "string", required: false },
    { name: "counterparty_code", type: "string", required: false },
    { name: "reference", type: "string", required: false },
    { name: "narrative", type: "string", required: false },
    { name: "currency", type: "string", required: true, description: "ISO 4217" },
    { name: "amount", type: "decimal(20,4)", required: true, description: "Signed amount in currency" },
    { name: "amount_base", type: "decimal(20,4)", required: false, description: "In reporting currency" },
    { name: "debit_credit", type: "enum(D,C)", required: true },
    { name: "batch_id", type: "string", required: false },
    { name: "source_hash", type: "string", required: true, description: "SHA-256 over normalized payload for idempotency" },
    { name: "raw_payload", type: "jsonb", required: true },
  ],
  connector_specific: {
    sap: ["gl_account", "cost_center", "profit_center", "document_type", "company_code"],
    oracle: ["ledger_id", "je_source", "je_category", "org_id"],
    tally: ["voucher_type", "voucher_number", "ledger_group"],
    finacle: ["sol_id", "part_tran_type", "gl_sub_head_code", "cust_id"],
    flexcube: ["branch_code", "product_code", "module_code", "account_class"],
  },
} as const;

const CONNECTOR_DEFAULTS: Record<ErpConnectorKind, {
  display_name: string;
  auth_method: "oauth2" | "api_key" | "basic" | "service_account" | "ssh_key";
  base_url_placeholder: string;
  scopes: string[];
  extra_config: Record<string, unknown>;
}> = {
  sap: {
    display_name: "SAP S/4HANA (OData)",
    auth_method: "oauth2",
    base_url_placeholder: "https://<host>/sap/opu/odata/sap/",
    scopes: ["GL_ACCOUNT_READ", "FI_DOCUMENT_READ"],
    extra_config: { client: "100", company_codes: [] },
  },
  oracle: {
    display_name: "Oracle Fusion / EBS",
    auth_method: "oauth2",
    base_url_placeholder: "https://<host>/fscmRestApi/resources/11.13.18.05/",
    scopes: ["urn:opc:resource:consumer::all"],
    extra_config: { ledger_ids: [] },
  },
  tally: {
    display_name: "Tally Prime (ODBC/XML)",
    auth_method: "basic",
    base_url_placeholder: "http://<host>:9000",
    scopes: [],
    extra_config: { company_name: "" },
  },
  finacle: {
    display_name: "Infosys Finacle (Connect24)",
    auth_method: "service_account",
    base_url_placeholder: "https://<host>/finacle-connect/",
    scopes: ["ACCOUNT_INQ", "TRANSACTION_INQ"],
    extra_config: { sol_ids: [], bank_id: "" },
  },
  flexcube: {
    display_name: "Oracle FLEXCUBE Universal Banking",
    auth_method: "service_account",
    base_url_placeholder: "https://<host>/FCUBSService/",
    scopes: ["GLINQ", "TXNINQ"],
    extra_config: { branch_codes: [], msg_source: "ReconIQ" },
  },
};

export const getErpConnectorMetadata = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async (): Promise<{
    defaults: Record<string, { display_name: string; auth_method: string; base_url_placeholder: string; scopes: string[]; extra_config: Record<string, string | number | boolean | string[] | null> }>;
    schema: { version: string; common: Array<{ name: string; type: string; required: boolean; description?: string }>; connector_specific: Record<string, string[]> };
  }> => {
    return JSON.parse(JSON.stringify({ defaults: CONNECTOR_DEFAULTS, schema: RECON_ROW_SCHEMA }));
  });

async function assertTenantAdmin(supabase: any, userId: string, tenantId: string) {
  await requireTenantAdmin({ supabase, userId } as any, tenantId, { fnName: "erp-connectors" });
}

export const listErpConnectors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("erp_connector_configs")
      .select("id, tenant_id, connector_kind, display_name, auth_method, base_url, environment, credential_vault_secret_id, scopes, extra_config, output_schema, status, last_test_at, last_test_result, created_at, updated_at")
      .eq("tenant_id", data.tenant_id)
      .order("connector_kind");
    if (error) throw new Error(error.message);
    return { connectors: rows ?? [] };
  });

export const upsertErpConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: z.string().uuid(),
      connector_kind: z.enum(ERP_CONNECTOR_KINDS),
      display_name: z.string().min(1).max(120),
      auth_method: z.enum(["oauth2", "api_key", "basic", "service_account", "ssh_key"]),
      base_url: z.string().url().nullable().optional(),
      environment: z.enum(["sandbox", "uat", "production"]).default("sandbox"),
      credential_vault_secret_id: z.string().uuid().nullable().optional(),
      scopes: z.array(z.string()).default([]),
      extra_config: z.record(z.unknown()).default({}),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context.supabase, context.userId, data.tenant_id);

    const kindDefaults = CONNECTOR_DEFAULTS[data.connector_kind];
    const outputSchema = {
      version: RECON_ROW_SCHEMA.version,
      common_columns: RECON_ROW_SCHEMA.common,
      extra_columns: RECON_ROW_SCHEMA.connector_specific[data.connector_kind] ?? [],
    };

    const payload: Record<string, unknown> = {
      tenant_id: data.tenant_id,
      connector_kind: data.connector_kind,
      display_name: data.display_name || kindDefaults.display_name,
      auth_method: data.auth_method,
      base_url: data.base_url ?? null,
      environment: data.environment,
      credential_vault_secret_id: data.credential_vault_secret_id ?? null,
      scopes: data.scopes.length ? data.scopes : kindDefaults.scopes,
      extra_config: { ...kindDefaults.extra_config, ...data.extra_config },
      output_schema: outputSchema,
      created_by: context.userId,
    };

    const q = data.id
      ? context.supabase.from("erp_connector_configs").update(payload as never).eq("id", data.id).select().single()
      : context.supabase.from("erp_connector_configs").insert(payload as never).select().single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: data.id ? "erp_connector.updated" : "erp_connector.created",
      resource_type: "erp_connector_config",
      resource_id: (row as any).id,
      context: { connector_kind: data.connector_kind, environment: data.environment, auth_method: data.auth_method },
    } as any);

    return { connector: row };
  });

function classifyError(msg: string, httpStatus?: number): string {
  if (httpStatus && httpStatus >= 500) return "upstream_5xx";
  if (httpStatus === 401 || httpStatus === 403) return "auth";
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 429) return "rate_limited";
  if (/abort|timeout/i.test(msg)) return "timeout";
  if (/dns|enotfound|getaddrinfo/i.test(msg)) return "dns";
  if (/certificate|ssl|tls/i.test(msg)) return "tls";
  if (/network|fetch failed|econn/i.test(msg)) return "network";
  return "unknown";
}

async function runTest(
  supabase: any,
  userId: string,
  connectorId: string,
  triggerSource: "manual" | "retry" | "scheduled",
) {
  const { data: cfg, error } = await supabase
    .from("erp_connector_configs")
    .select("id, tenant_id, connector_kind, base_url, environment, auth_method, credential_vault_secret_id")
    .eq("id", connectorId)
    .single();
  if (error || !cfg) throw new Error("Connector not found.");
  await assertTenantAdmin(supabase, userId, (cfg as any).tenant_id);

  // Snapshot credential version + fingerprint at test time.
  let credVersion: number | null = null;
  let credFingerprint: string | null = null;
  if ((cfg as any).credential_vault_secret_id) {
    const { data: sec } = await supabase
      .from("app_vault_secrets")
      .select("version, fingerprint_sha256")
      .eq("id", (cfg as any).credential_vault_secret_id)
      .maybeSingle();
    credVersion = (sec as any)?.version ?? null;
    credFingerprint = (sec as any)?.fingerprint_sha256 ?? null;
  }

  const start = Date.now();
  const probeKind = "HEAD";
  let result: { ok: boolean; message: string; latency_ms: number; http_status?: number; error_kind?: string };
  try {
    if ((cfg as any).base_url) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch((cfg as any).base_url, { method: probeKind, signal: ctl.signal }).catch((e) => {
        throw new Error(`Network: ${e.message}`);
      });
      clearTimeout(t);
      const ok = res.status < 500;
      result = {
        ok,
        message: `Reachable (HTTP ${res.status})`,
        http_status: res.status,
        latency_ms: Date.now() - start,
        error_kind: ok ? undefined : classifyError("", res.status),
      };
    } else {
      result = { ok: true, message: `Stub OK — configure base_url for a live probe.`, latency_ms: Date.now() - start };
    }
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    result = { ok: false, message: msg, latency_ms: Date.now() - start, error_kind: classifyError(msg) };
  }

  await supabase.from("erp_connector_configs").update({
    status: result.ok ? "active" : "error",
    last_test_at: new Date().toISOString(),
    last_test_result: result,
  }).eq("id", connectorId);

  await supabase.from("erp_connector_runs").insert({
    tenant_id: (cfg as any).tenant_id,
    connector_id: connectorId,
    connector_kind: (cfg as any).connector_kind,
    triggered_by: userId,
    trigger_kind: "test",
    completed_at: new Date().toISOString(),
    duration_ms: result.latency_ms ?? null,
    status: result.ok ? "ok" : "error",
    request_summary: { probe: probeKind, base_url: (cfg as any).base_url, trigger_source: triggerSource },
    error: result.ok ? null : result.message,
  } as any);

  await supabase.from("erp_connector_test_history").insert({
    tenant_id: (cfg as any).tenant_id,
    connector_id: connectorId,
    credential_secret_id: (cfg as any).credential_vault_secret_id ?? null,
    credential_version: credVersion,
    credential_fingerprint: credFingerprint,
    ok: result.ok,
    http_status: result.http_status ?? null,
    latency_ms: result.latency_ms ?? null,
    probe_kind: probeKind,
    base_url: (cfg as any).base_url ?? null,
    error_kind: result.ok ? null : (result.error_kind ?? "unknown"),
    error_message: result.ok ? null : result.message,
    error_detail: result.ok ? {} : { message: result.message, http_status: result.http_status ?? null },
    triggered_by: userId,
    trigger_source: triggerSource,
  } as any);

  await supabase.from("audit_log").insert({
    actor_user_id: userId,
    tenant_id: (cfg as any).tenant_id,
    scope: "tenant",
    action: "erp_connector.tested",
    resource_type: "erp_connector_config",
    resource_id: connectorId,
    context: { ...result, trigger_source: triggerSource, credential_version: credVersion },
  } as any);

  return result;
}

export const testErpConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    connector_id: z.string().uuid(),
    trigger_source: z.enum(["manual", "retry", "scheduled"]).default("manual"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    return runTest(context.supabase, context.userId, data.connector_id, data.trigger_source);
  });

export const listErpConnectorTestHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    connector_id: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(50),
    credential_version: z.number().int().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("erp_connector_test_history")
      .select("id, connector_id, credential_secret_id, credential_version, credential_fingerprint, ok, http_status, latency_ms, probe_kind, base_url, error_kind, error_message, error_detail, triggered_by, trigger_source, created_at")
      .eq("connector_id", data.connector_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.credential_version != null) q = q.eq("credential_version", data.credential_version);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { history: rows ?? [] };
  });

export const retryLastErpConnectorTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ connector_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Verify there is a prior test to retry.
    const { data: last } = await context.supabase
      .from("erp_connector_test_history")
      .select("id, credential_version")
      .eq("connector_id", data.connector_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last) throw new Error("No previous test to retry. Run a test first.");
    return runTest(context.supabase, context.userId, data.connector_id, "retry");
  });

export const deleteErpConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ connector_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cfg } = await context.supabase
      .from("erp_connector_configs")
      .select("tenant_id, connector_kind")
      .eq("id", data.connector_id)
      .single();
    if (!cfg) throw new Error("Connector not found.");
    await assertTenantAdmin(context.supabase, context.userId, (cfg as any).tenant_id);

    const { error } = await context.supabase.from("erp_connector_configs").delete().eq("id", data.connector_id);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: (cfg as any).tenant_id,
      scope: "tenant",
      action: "erp_connector.deleted",
      resource_type: "erp_connector_config",
      resource_id: data.connector_id,
      context: { connector_kind: (cfg as any).connector_kind },
    } as any);

    return { ok: true };
  });
