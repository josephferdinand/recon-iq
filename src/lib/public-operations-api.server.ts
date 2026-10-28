import { z } from "zod";

import {
  CONNECTOR_EXECUTION_MODES,
  CONNECTOR_TYPES,
  connectorExecutionMode,
} from "@/lib/connectors.functions";
import {
  authorizeTenantApiRequest,
  workflowApiCors,
  workflowApiJson,
} from "@/lib/public-workflow-api.server";
import { publicApiRequestContext, writePublicApiAudit } from "@/lib/public-resource-api.server";

const uuid = z.string().uuid();

function boundedLimit(request: Request, fallback = 50) {
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? fallback);
  return Math.min(200, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : fallback));
}

export async function listPublicReconciliations(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "recons.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  const limit = boundedLimit(request);
  const { data: definitions, error } = await auth.admin
    .from("recon_definitions")
    .select("id,name,description,recon_type,status,visibility,created_at,updated_at")
    .eq("tenant_id", auth.principal.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return workflowApiJson(503, { error: "reconciliation_lookup_unavailable" }, auth.cors);
  const ids = (definitions ?? []).map((row) => row.id);
  const runsResult = ids.length
    ? await auth.admin
      .from("recon_runs")
      .select("id,run_uid,definition_id,status,matched_count,exception_count,total_rows,started_at,completed_at")
      .eq("tenant_id", auth.principal.tenantId)
      .in("definition_id", ids)
      .order("started_at", { ascending: false })
      .limit(Math.min(2000, Math.max(20, limit * 10)))
    : { data: [], error: null };
  if (runsResult.error) {
    return workflowApiJson(503, { error: "reconciliation_lookup_unavailable" }, auth.cors);
  }
  const latestByDefinition = new Map<string, NonNullable<typeof runsResult.data>[number]>();
  for (const run of runsResult.data ?? []) {
    if (!latestByDefinition.has(run.definition_id)) latestByDefinition.set(run.definition_id, run);
  }
  const rows = (definitions ?? []).map((definition) => ({
    ...definition,
    latest_run: latestByDefinition.get(definition.id) ?? null,
  }));
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug, action: "api.reconciliation.list", resourceType: "recon_definition", resourceId: null, context: publicApiRequestContext(request) });
  } catch { return workflowApiJson(503, { error: "audit_unavailable" }, auth.cors); }
  return workflowApiJson(200, { data: rows, count: rows.length }, auth.cors);
}

export async function getPublicReconciliation(
  request: Request,
  tenantSlug: string,
  reconId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "recons.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(reconId).success) {
    return workflowApiJson(400, { error: "invalid_recon_id" }, auth.cors);
  }
  const [{ data: definition, error }, { data: runs, error: runsError }] = await Promise.all([
    auth.admin
      .from("recon_definitions")
      .select("id,name,description,recon_type,status,visibility,created_at,updated_at")
      .eq("tenant_id", auth.principal.tenantId)
      .eq("id", reconId)
      .maybeSingle(),
    auth.admin
      .from("recon_runs")
      .select("id,run_uid,status,matched_count,exception_count,total_rows,started_at,completed_at")
      .eq("tenant_id", auth.principal.tenantId)
      .eq("definition_id", reconId)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);
  if (error || runsError) {
    return workflowApiJson(503, { error: "reconciliation_lookup_unavailable" }, auth.cors);
  }
  if (!definition) return workflowApiJson(404, { error: "reconciliation_not_found" }, auth.cors);
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug, action: "api.reconciliation.read", resourceType: "recon_definition", resourceId: reconId, context: publicApiRequestContext(request) });
  } catch { return workflowApiJson(503, { error: "audit_unavailable" }, auth.cors); }
  return workflowApiJson(200, { data: definition, recent_runs: runs ?? [] }, auth.cors);
}

export async function listPublicConnectorSchedules(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "connectors.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  const limit = boundedLimit(request);
  const { data, error } = await auth.admin
    .from("data_source_schedules")
    .select(
      "id,name,connector_type,mode,enabled,cron_expression,poll_interval_seconds,last_run_at,last_status,last_rows_ingested,created_at,updated_at,data_source:workspace_data_sources(id,name,status)",
    )
    .eq("tenant_id", auth.principal.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return workflowApiJson(503, { error: "connector_lookup_unavailable" }, auth.cors);
  const rows = (data ?? []).map((row) => ({
    ...row,
    execution_mode: connectorExecutionMode(row.connector_type),
  }));
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug, action: "api.connector.list", resourceType: "data_source_schedule", resourceId: null, context: publicApiRequestContext(request) });
  } catch { return workflowApiJson(503, { error: "audit_unavailable" }, auth.cors); }
  return workflowApiJson(200, { data: rows, count: rows.length }, auth.cors);
}

export async function getPublicConnectorCapabilities(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "connectors.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug, action: "api.connector.capabilities", resourceType: "connector_catalogue", resourceId: null, context: publicApiRequestContext(request) });
  } catch { return workflowApiJson(503, { error: "audit_unavailable" }, auth.cors); }
  return workflowApiJson(
    200,
    {
      data: CONNECTOR_TYPES.map((type) => ({
        type,
        execution_mode: CONNECTOR_EXECUTION_MODES[type],
      })),
    },
    auth.cors,
  );
}

export function publicOperationsCors(request: Request, methods: string) {
  return workflowApiCors(request, methods);
}
