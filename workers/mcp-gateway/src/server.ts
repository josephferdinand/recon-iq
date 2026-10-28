import { Skybridge } from "skybridge/server";
import { z } from "zod";

import { callFviApi, introspectFviToken, readFviConfig, requireTenant, safeToolError, type FviClaims } from "./fvi-client.js";

const tenantSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/u);
const uuid = z.string().uuid();
const limit = z.number().int().min(1).max(200).default(50);
const idempotencyKey = z.string().min(1).max(128);
const confirmed = z.literal(true).describe("True only after the user explicitly confirms the action.");
const lifecycle = z.enum(["new", "assigned", "investigating", "pending_counterparty", "resolved", "written_off"]);
const breakAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), assignee: uuid.nullable() }),
  z.object({ action: z.literal("classify"), root_cause: z.string().min(1).max(500), priority: z.enum(["P1", "P2", "P3", "P4"]).optional(), tags: z.array(z.string().min(1).max(40)).max(20).optional() }),
  z.object({ action: z.literal("comment"), body: z.string().min(1).max(4000), internal: z.boolean().default(true) }),
  z.object({ action: z.literal("resolve"), resolution_note: z.string().min(1).max(4000), root_cause: z.string().min(1).max(500).optional() }),
  z.object({ action: z.literal("write_off"), reason: z.string().min(1).max(4000), amount: z.number().finite(), currency: z.string().regex(/^[A-Z]{3}$/u), gl_account: z.string().min(1).max(100) }),
  z.object({ action: z.literal("approve_write_off"), request_id: uuid, decision: z.enum(["approved", "rejected"]), decision_note: z.string().max(2000).optional() }),
  z.object({ action: z.literal("reopen"), reason: z.string().min(1).max(4000) }),
  z.object({ action: z.literal("reprocess") }),
]);

type ToolExtra = { http?: { authInfo?: { token: string; extra?: FviClaims } } };

function auth(extra: ToolExtra, requestedTenant: string) {
  const claims = extra.http?.authInfo?.extra;
  requireTenant(requestedTenant, claims);
  return { token: extra.http!.authInfo!.token };
}

function result(data: unknown, message: string) {
  return { structuredContent: { ok: true, data }, content: [{ type: "text" as const, text: message }], isError: false };
}

function failure(error: unknown) {
  const safe = safeToolError(error);
  return { structuredContent: { ok: false, error: safe }, content: [{ type: "text" as const, text: `FVI request failed: ${safe.code}.` }], isError: true };
}

export const app = new Skybridge({
  name: "reconiq-intelligence",
  title: "ReconIQ",
  version: "1.0.0",
  description: "Governed reconciliation operations, investigation and workflow control.",
  instructions: "Use read tools first. Never invoke a mutating tool until the user explicitly confirms the exact tenant, resource and effect.",
  setup: () => readFviConfig(),
  oauth: (config) => ({
    baseUrl: config.mcpOrigin,
    oauthMetadata: {
      issuer: config.oauthIssuer,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      registration_endpoint: config.registrationEndpoint,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    scopesSupported: ["recons.read", "recons.run", "data-prep.run", "connectors.read", "connectors.run", "breaks.write", "reports.read"],
    verifier: {
      async verifyAccessToken(token) {
        const claims = await introspectFviToken(config, token);
        return { token, clientId: claims.subject, scopes: claims.scopes, expiresAt: claims.expiresAt ? Math.floor(Date.parse(claims.expiresAt) / 1000) : undefined, extra: claims };
      },
    },
  }),
  handler: (server, config) => server
    .registerTool({
      name: "view_operations_dashboard",
      description: "Use this when an authorized user wants a compact operational view of reconciliations, connectors and reports for one tenant.",
      inputSchema: { tenant_slug: tenantSlug },
      auth: { scopes: ["recons.read", "connectors.read", "reports.read"] },
      annotations: { title: "View FVI operations", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { "muse/widgetAccessible": true, "muse/toolInvocation/invoking": "Loading authorized FVI operations…", "muse/toolInvocation/invoked": "FVI operations loaded." },
      view: { component: "operations-dashboard", description: "Tenant-scoped reconciliation operations", prefersBorder: true },
    }, async ({ tenant_slug }, extra) => {
      try {
        const { token } = auth(extra, tenant_slug);
        const [reconciliations, connectors, reports] = await Promise.all([
          callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/recons?limit=50` }),
          callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/connectors?limit=50` }),
          callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/reports` }),
        ]);
        return result({ tenant_slug, refreshed_at: new Date().toISOString(), reconciliations, connectors, reports }, "Authorized operational dashboard is ready.");
      } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "list_reconciliations", description: "Use this when an authorized user wants bounded reconciliation definitions and their latest run status.",
      inputSchema: { tenant_slug: tenantSlug, limit }, auth: { scopes: ["recons.read"] },
      annotations: { title: "List reconciliations", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug, limit: pageSize }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/recons?limit=${pageSize}` }), "Reconciliations returned."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "get_reconciliation", description: "Use this when an authorized user wants one reconciliation and its recent run history.",
      inputSchema: { tenant_slug: tenantSlug, reconciliation_id: uuid }, auth: { scopes: ["recons.read"] },
      annotations: { title: "Get reconciliation", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug, reconciliation_id }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/recons/${reconciliation_id}` }), "Reconciliation returned."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "list_breaks", description: "Use this when an authorized user wants a bounded list of breaks for one reconciliation.",
      inputSchema: { tenant_slug: tenantSlug, reconciliation_id: uuid, state: lifecycle.optional(), limit }, auth: { scopes: ["recons.read"] },
      annotations: { title: "List breaks", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug, reconciliation_id, state, limit: pageSize }, extra) => {
      try { const { token } = auth(extra, tenant_slug); const query = new URLSearchParams({ limit: String(pageSize), ...(state ? { state } : {}) }); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/recons/${reconciliation_id}/breaks?${query}` }), "Breaks returned."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "get_break", description: "Use this when an authorized user wants one break with comments, notes, write-off requests and audit evidence.",
      inputSchema: { tenant_slug: tenantSlug, reconciliation_id: uuid, break_id: uuid }, auth: { scopes: ["recons.read"] },
      annotations: { title: "Get break evidence", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug, reconciliation_id, break_id }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/recons/${reconciliation_id}/breaks/${break_id}` }), "Break evidence returned."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "get_workflow_job", description: "Use this when an authorized user wants the durable status of a previously queued FVI workflow job.",
      inputSchema: { tenant_slug: tenantSlug, job_id: uuid },
      annotations: { title: "Get workflow job", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug, job_id }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/workflow-jobs/${job_id}` }), "Workflow job returned."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "list_connector_schedules", description: "Use this when an authorized user wants bounded connector schedules and their last safe execution status.",
      inputSchema: { tenant_slug: tenantSlug, limit }, auth: { scopes: ["connectors.read"] },
      annotations: { title: "List connector schedules", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug, limit: pageSize }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/connectors?limit=${pageSize}` }), "Connector schedules returned."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "get_connector_capabilities", description: "Use this when an authorized user wants the supported connector catalogue and governed execution modes without credential details.",
      inputSchema: { tenant_slug: tenantSlug }, auth: { scopes: ["connectors.read"] },
      annotations: { title: "Get connector capabilities", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/connectors/capabilities` }), "Connector capabilities returned."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "list_reports", description: "Use this when an authorized user wants the available standard and saved FVI reports.",
      inputSchema: { tenant_slug: tenantSlug }, auth: { scopes: ["reports.read"] },
      annotations: { title: "List reports", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/reports` }), "Report catalogue returned."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "run_data_prep", description: "Use this only after explicit user confirmation to queue one existing Data Prep pipeline.",
      inputSchema: { tenant_slug: tenantSlug, pipeline_id: uuid, confirmed, idempotency_key: idempotencyKey }, auth: { scopes: ["data-prep.run"] },
      annotations: { title: "Run Data Prep", readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    }, async ({ tenant_slug, pipeline_id, idempotency_key }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/data-prep/pipelines/${pipeline_id}/runs`, method: "POST", idempotencyKey: idempotency_key }), "Data Prep run queued."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "run_reconciliation", description: "Use this only after explicit user confirmation to queue one existing reconciliation.",
      inputSchema: { tenant_slug: tenantSlug, reconciliation_id: uuid, confirmed, idempotency_key: idempotencyKey }, auth: { scopes: ["recons.run"] },
      annotations: { title: "Run reconciliation", readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    }, async ({ tenant_slug, reconciliation_id, idempotency_key }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/recons/${reconciliation_id}/runs`, method: "POST", idempotencyKey: idempotency_key }), "Reconciliation run queued."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "run_connector", description: "Use this only after explicit user confirmation to queue one existing connector schedule.",
      inputSchema: { tenant_slug: tenantSlug, schedule_id: uuid, confirmed, idempotency_key: idempotencyKey }, auth: { scopes: ["connectors.run"] },
      annotations: { title: "Run connector", readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    }, async ({ tenant_slug, schedule_id, idempotency_key }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/connectors/${schedule_id}/runs`, method: "POST", idempotencyKey: idempotency_key }), "Connector run queued."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "action_break", description: "Use this only after explicit user confirmation for one bounded break action; write-off approval remains a distinct checker action.",
      inputSchema: { tenant_slug: tenantSlug, reconciliation_id: uuid, break_id: uuid, confirmed, idempotency_key: idempotencyKey, payload: breakAction }, auth: { scopes: ["breaks.write"] },
      annotations: { title: "Act on break", readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    }, async ({ tenant_slug, reconciliation_id, break_id, idempotency_key, payload }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/recons/${reconciliation_id}/breaks/${break_id}/actions`, method: "POST", body: payload, idempotencyKey: idempotency_key }), "Break action submitted."); } catch (error) { return failure(error); }
    })
    .registerTool({
      name: "generate_report", description: "Use this only after explicit user confirmation to generate one registered FVI report in JSON or CSV format.",
      inputSchema: { tenant_slug: tenantSlug, report_id: z.enum(["standard-operations", "standard-break-risk", "standard-full"]), format: z.enum(["json", "csv"]), days: z.number().int().min(7).max(180).default(30), confirmed }, auth: { scopes: ["reports.read"] },
      annotations: { title: "Generate report", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ tenant_slug, report_id, format, days }, extra) => {
      try { const { token } = auth(extra, tenant_slug); return result(await callFviApi({ config, token, tenantSlug: tenant_slug, path: `/api/v1/${tenant_slug}/reports/${report_id}/run?format=${format}`, method: "POST", body: { days }, accept: format === "csv" ? "text/csv" : "application/json" }), "Report generated."); } catch (error) { return failure(error); }
    }),
});

export type AppType = typeof app;
