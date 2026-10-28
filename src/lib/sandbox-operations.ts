// Static list of API operations surfaced in the sandbox picker.
// Mirrors docs/openapi/fvi-openapi.yaml; when the spec changes, run
// `npm run sdk:generate` and update this list to match.

export type SandboxParam = {
  name: string;
  in: "path" | "query";
  required?: boolean;
  description?: string;
  example?: string;
  enum?: string[];
};

export type SandboxOperation = {
  id: string;                       // stable slug for the picker
  tag: string;                      // OpenAPI tag
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;                     // path template with {param}
  summary: string;
  params: SandboxParam[];
  requestExample?: string;          // JSON example for body
  requiresWriteScope?: boolean;     // client-credentials must present scope=write
  adminOnly?: boolean;              // hides from client-credentials mode
};

export const SANDBOX_OPERATIONS: SandboxOperation[] = [
  { id: "getSession", tag: "Auth", method: "GET", path: "/api/session", summary: "Current session", params: [] },

  { id: "listTenants", tag: "Tenants", method: "GET", path: "/api/tenants", summary: "List tenants visible to caller", params: [] },
  {
    id: "createTenant", tag: "Tenants", method: "POST", path: "/api/tenants",
    summary: "Create tenant (platform_admin only)",
    params: [], requiresWriteScope: true, adminOnly: true,
    requestExample: JSON.stringify({ slug: "acme-uat", name: "Acme UAT", environment: "uat" }, null, 2),
  },

  {
    id: "listReconRuns", tag: "Reconciliation", method: "GET", path: "/api/recon/runs",
    summary: "List recon runs for a tenant",
    params: [{ name: "tenant_id", in: "query", required: true, description: "Tenant UUID", example: "00000000-0000-0000-0000-000000000000" }],
  },
  {
    id: "reconRunMatches", tag: "Reconciliation", method: "GET", path: "/api/recon/runs/{id}/matches",
    summary: "Matches for a run",
    params: [{ name: "id", in: "path", required: true, description: "Run UUID" }],
  },
  {
    id: "reconRunBreaks", tag: "Exceptions", method: "GET", path: "/api/recon/runs/{id}/breaks",
    summary: "Open breaks for a run",
    params: [{ name: "id", in: "path", required: true, description: "Run UUID" }],
  },

  {
    id: "exportAudit", tag: "Exports", method: "GET", path: "/api/exports/audit",
    summary: "Export audit log",
    params: [
      { name: "format", in: "query", required: true, enum: ["csv", "xlsx", "pdf"], example: "csv" },
      { name: "from", in: "query", description: "ISO datetime" },
      { name: "to", in: "query", description: "ISO datetime" },
    ],
  },
  {
    id: "soc2Bundle", tag: "Exports", method: "POST", path: "/api/exports/soc2-bundle",
    summary: "Generate SOC 2 evidence bundle (signed URL)", params: [], requiresWriteScope: true,
  },

  {
    id: "webhookTest", tag: "Webhooks", method: "POST", path: "/api/webhooks/outbound/test",
    summary: "Send a test webhook", params: [], requiresWriteScope: true,
  },

  {
    id: "adminAudit", tag: "Admin", method: "GET", path: "/api/admin/audit",
    summary: "Immutable audit log (paginated)",
    params: [
      { name: "cursor", in: "query" },
      { name: "limit", in: "query", example: "50" },
    ],
    adminOnly: true,
  },

  {
    id: "connectorSync", tag: "Connectors", method: "POST", path: "/api/connectors/{name}/sync",
    summary: "Trigger a manual connector sync",
    params: [{ name: "name", in: "path", required: true, enum: ["sap", "oracle", "finacle", "flexcube", "tally"], example: "sap" }],
    requiresWriteScope: true,
  },
  {
    id: "connectorHealth", tag: "Connectors", method: "GET", path: "/api/connectors/{name}/health",
    summary: "Connector health",
    params: [{ name: "name", in: "path", required: true, example: "sap" }],
  },

  {
    id: "copilotChat", tag: "Copilot", method: "POST", path: "/api/copilot/chat",
    summary: "Copilot chat completion",
    params: [], requiresWriteScope: true,
    requestExample: JSON.stringify({ message: "Summarise open breaks for tenant fvihq-prod", tenant_id: "00000000-0000-0000-0000-000000000000" }, null, 2),
  },

  { id: "health", tag: "Observability", method: "GET", path: "/api/observability/health", summary: "Health + SLO status", params: [] },
];

export function operationsByTag() {
  const map = new Map<string, SandboxOperation[]>();
  for (const op of SANDBOX_OPERATIONS) {
    if (!map.has(op.tag)) map.set(op.tag, []);
    map.get(op.tag)!.push(op);
  }
  return map;
}
