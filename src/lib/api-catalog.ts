/**
 * ReconIQ Public API catalog — single source of truth for the Tenant → API Reference tab.
 *
 * Mirrors Duco AIDP's Swagger surface (groups → endpoints → params/responses/schemas)
 * but maps to ReconIQ's own domain: Reconciliations, Data Sources, Matches, Breaks,
 * Reports, AIDP, Webhooks, SCIM, Audit, Events, OAuth2.
 *
 * Endpoint paths are templated against the caller's tenant slug — the UI replaces
 * `{tenantSlug}` at render-time so customers see their own working URLs.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiParam = {
  name: string;
  in: "path" | "query" | "header" | "body";
  type: string;
  required?: boolean;
  description: string;
  example?: string | number | boolean;
  enum?: string[];
};

export type ApiResponse = {
  status: number;
  description: string;
  body?: string; // JSON example as string
};

export type ApiEndpoint = {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  params: ApiParam[];
  requestBody?: { contentType: string; example: string; schemaRef?: string };
  responses: ApiResponse[];
  scopes?: string[];
  rateLimit?: string;
};

export type ApiGroup = {
  key: string;
  name: string;
  blurb: string;
  endpoints: ApiEndpoint[];
};

export type ApiSchema = {
  name: string;
  description: string;
  fields: { name: string; type: string; required?: boolean; description: string }[];
};

export const API_VERSION = "v1";
export const API_BASE_PATH = `/api/${API_VERSION}/{tenantSlug}`;

/* ----------------------------- GROUPS ----------------------------- */

export const API_GROUPS: ApiGroup[] = [
  {
    key: "auth",
    name: "Authentication",
    blurb:
      "OAuth 2.0 client-credentials and refresh flows. Short-lived bearer access tokens scope every request to your tenant.",
    endpoints: [
      {
        id: "auth-token",
        method: "POST",
        path: "/oauth2/token",
        summary: "Issue an access token",
        description:
          "Exchanges a client_id / client_secret pair for a tenant-scoped bearer token. Returned tokens are valid for 60 minutes and must be sent as `Authorization: Bearer <token>` on every API call.",
        params: [
          { name: "Content-Type", in: "header", type: "string", required: true, description: "Must be application/json.", example: "application/json" },
        ],
        requestBody: {
          contentType: "application/json",
          schemaRef: "AccessTokenRequest",
          example: JSON.stringify(
            { grant_type: "client_credentials", client_id: "fvi_pat_live_xxx", client_secret: "•••", scope: "recons.read recons.write" },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Token issued.",
            body: JSON.stringify(
              { access_token: "eyJhbGciOi...", token_type: "Bearer", expires_in: 3600, scope: "recons.read recons.write" },
              null,
              2,
            ),
          },
          { status: 401, description: "Invalid credentials." },
        ],
      },
      {
        id: "auth-refresh",
        method: "POST",
        path: "/oauth2/refresh",
        summary: "Refresh an access token",
        description: "Exchanges a refresh token for a new access token without re-authenticating the client.",
        params: [],
        requestBody: {
          contentType: "application/json",
          schemaRef: "RefreshTokenRequest",
          example: JSON.stringify({ grant_type: "refresh_token", refresh_token: "rt_live_..." }, null, 2),
        },
        responses: [
          { status: 200, description: "New token issued." },
          { status: 401, description: "Refresh token expired or revoked." },
        ],
      },
      {
        id: "auth-introspect",
        method: "GET",
        path: "/oauth2/introspect",
        summary: "Inspect the current token",
        description: "Returns the scopes, tenant, business unit, and TTL of the bearer token in the Authorization header.",
        params: [],
        responses: [{ status: 200, description: "Token metadata." }],
      },
    ],
  },
  {
    key: "data-prep",
    name: "Data Prep",
    blurb: "Run approved transformation and data-quality pipelines through the durable workflow queue.",
    endpoints: [
      {
        id: "data-prep-run",
        method: "POST",
        path: "/data-prep/pipelines/{id}/runs",
        summary: "Queue a Data Prep run",
        description: "Queues an enabled tenant pipeline and returns a durable workflow job. Reusing the same idempotency key returns the original job.",
        params: [
          { name: "id", in: "path", type: "uuid", required: true, description: "Pipeline ID." },
          { name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key, maximum 128 characters." },
        ],
        responses: [
          { status: 202, description: "Job queued." },
          { status: 429, description: "Token rate limit exceeded; Retry-After is returned." },
        ],
        scopes: ["data-prep.run"],
        rateLimit: "60 requests/minute/API token",
      },
      {
        id: "data-prep-job-get",
        method: "GET",
        path: "/workflow-jobs/{jobId}",
        summary: "Get Data Prep job status",
        description: "Returns queued, running, succeeded, failed, or dead status and the completed pipeline result.",
        params: [{ name: "jobId", in: "path", type: "uuid", required: true, description: "Workflow job ID." }],
        responses: [{ status: 200, description: "Workflow job status." }],
        scopes: ["data-prep.run"],
      },
    ],
  },
  {
    key: "connectors",
    name: "Scheduled Connectors",
    blurb: "Run direct, private-gateway and approved outbound-agent connector schedules through the durable workflow queue.",
    endpoints: [
      {
        id: "connector-run",
        method: "POST",
        path: "/connectors/{scheduleId}/runs",
        summary: "Queue a connector run",
        description: "Queues a tenant-owned direct, remote-gateway or approved on-premises-agent schedule. Manual upload-only schedules are rejected.",
        params: [
          { name: "scheduleId", in: "path", type: "uuid", required: true, description: "Scheduled connector ID." },
          { name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key, maximum 128 characters." },
        ],
        responses: [
          { status: 202, description: "Connector job queued." },
          { status: 404, description: "Executable connector schedule not found." },
          { status: 429, description: "Token rate limit exceeded; Retry-After is returned." },
        ],
        scopes: ["connectors.run"],
        rateLimit: "60 requests/minute/API token",
      },
      {
        id: "connector-agent-lease",
        method: "POST",
        path: "/connector-agent/lease",
        summary: "Lease an on-premises connector job",
        description: "Leases one tenant- and agent-bound SFTP, FTPS, local-folder or network-drive job. Returns only allow-listed configuration references; no credential value is returned.",
        params: [],
        requestBody: { contentType: "application/json", example: JSON.stringify({ agent_id: "site-a-agent-01", lease_seconds: 120 }, null, 2) },
        responses: [{ status: 200, description: "Job leased." }, { status: 204, description: "No eligible job." }, { status: 429, description: "Agent poll rate exceeded." }],
        scopes: ["connectors.agent"],
        rateLimit: "60 lease requests/minute/API token",
      },
      {
        id: "connector-agent-complete",
        method: "POST",
        path: "/connector-agent/jobs/{jobId}/complete",
        summary: "Complete an on-premises connector job",
        description: "Publishes at most 50,000 normalized rows for the token- and agent-bound active lease. ReconIQ recomputes content size and SHA-256 before atomic persistence.",
        params: [{ name: "jobId", in: "path", type: "uuid", required: true, description: "Leased workflow job ID." }],
        responses: [{ status: 200, description: "Upload, run, schedule, workflow job and audit completed atomically." }, { status: 409, description: "Lease is invalid or expired." }],
        scopes: ["connectors.agent"],
        rateLimit: "30 completions/minute/API token",
      },
      {
        id: "connector-agent-fail",
        method: "POST",
        path: "/connector-agent/jobs/{jobId}/fail",
        summary: "Fail an on-premises connector job safely",
        description: "Records a bounded machine error code and schedules exponential retry or dead-letter state without returning local paths or credential details.",
        params: [{ name: "jobId", in: "path", type: "uuid", required: true, description: "Leased workflow job ID." }],
        responses: [{ status: 200, description: "Failure and retry/dead-letter state recorded." }, { status: 409, description: "Lease is invalid." }],
        scopes: ["connectors.agent"],
        rateLimit: "30 failures/minute/API token",
      },
      {
        id: "connector-job-get",
        method: "GET",
        path: "/workflow-jobs/{jobId}",
        summary: "Get connector job status",
        description: "Returns queued, running, succeeded, failed, or dead status and the completed ingestion row count.",
        params: [{ name: "jobId", in: "path", type: "uuid", required: true, description: "Workflow job ID." }],
        responses: [{ status: 200, description: "Workflow job status." }],
        scopes: ["connectors.run"],
      },
    ],
  },
  {
    key: "tenants",
    name: "Tenant & Business Units",
    blurb: "Tenant identity, business-unit hierarchy and feature flags exposed to integrators.",
    endpoints: [
      {
        id: "tenant-me",
        method: "GET",
        path: "/me",
        summary: "Tenant profile",
        description: "Returns the tenant name, slug, region, residency lock, and AI-enabled flag.",
        params: [],
        responses: [{ status: 200, description: "Tenant profile." }],
      },
      {
        id: "bu-list",
        method: "GET",
        path: "/business-units",
        summary: "List business units",
        description: "Returns the BU tree (ltree-ordered). Caller sees only BUs reachable from their assignment.",
        params: [
          { name: "depth", in: "query", type: "integer", description: "Maximum tree depth to return.", example: 3 },
        ],
        responses: [{ status: 200, description: "Array of BU nodes." }],
      },
    ],
  },
  {
    key: "data-sources",
    name: "Data Sources & Ingestion",
    blurb:
      "Register a data source, push records via JSON, file upload or pull via SFTP/S3/Snowflake/BigQuery/API connectors.",
    endpoints: [
      {
        id: "ds-list",
        method: "GET",
        path: "/data-sources",
        summary: "List data sources",
        description: "Returns every registered data source in the tenant, filtered by BU scope.",
        params: [
          { name: "bu_id", in: "query", type: "uuid", description: "Filter by business unit." },
          { name: "limit", in: "query", type: "integer", description: "Page size (1–200).", example: 50 },
          { name: "cursor", in: "query", type: "string", description: "Pagination cursor from the previous response." },
        ],
        responses: [
          {
            status: 200,
            description: "Paginated list.",
            body: JSON.stringify(
              { data: [{ id: "ds_01H...", name: "Bank A Nostro", kind: "sftp", schema_locked: true }], next_cursor: null },
              null,
              2,
            ),
          },
        ],
      },
      {
        id: "ds-create",
        method: "POST",
        path: "/data-sources",
        summary: "Register a data source",
        description: "Creates a new data source. Supply credentials inline for SFTP/S3 or a managed connection ID.",
        params: [],
        requestBody: {
          contentType: "application/json",
          schemaRef: "CreateDataSourceRequest",
          example: JSON.stringify(
            {
              name: "Bank A Nostro",
              kind: "sftp",
              bu_id: "01HV...",
              connection: { host: "sftp.bank-a.com", port: 22, username: "fvi", auth: "key" },
              schedule: { cron: "0 */15 * * * *", glob: "/in/*.csv" },
            },
            null,
            2,
          ),
        },
        responses: [
          { status: 201, description: "Created. Returns the data source object." },
          { status: 422, description: "Validation error." },
        ],
      },
      {
        id: "ds-push",
        method: "POST",
        path: "/data-sources/{id}/records",
        summary: "Stream records",
        description:
          "NDJSON streaming endpoint for high-volume ingestion. Each line is a record. Returns the accepted/rejected counts.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Data source ID." },
          { name: "Content-Type", in: "header", type: "string", required: true, description: "Must be application/x-ndjson.", example: "application/x-ndjson" },
        ],
        rateLimit: "10,000 records/sec/tenant",
        responses: [
          { status: 202, description: "Accepted for processing.", body: JSON.stringify({ accepted: 9981, rejected: 19, batch_id: "bx_..." }, null, 2) },
        ],
      },
      {
        id: "ds-upload",
        method: "POST",
        path: "/data-sources/{id}/files",
        summary: "Upload a file",
        description: "Multipart upload of CSV / XLSX / PDF. PDF triggers AIDP extraction automatically.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Data source ID." },
        ],
        requestBody: { contentType: "multipart/form-data", example: "file=@statements_2026-06-27.csv" },
        responses: [{ status: 201, description: "File queued. Poll /uploads/{id} for status." }],
      },
    ],
  },
  {
    key: "recons",
    name: "Reconciliations (ReconIQ Studio)",
    blurb:
      "Define, run and version reconciliations. Supports one-sided, two-sided and tri-party flows with deterministic and probabilistic matching rules.",
    endpoints: [
      {
        id: "recon-list",
        method: "GET",
        path: "/recons",
        summary: "List reconciliations",
        description: "Filter by BU, lifecycle state, or recent activity.",
        params: [
          { name: "state", in: "query", type: "string", enum: ["draft", "active", "paused", "archived"], description: "Lifecycle filter." },
          { name: "bu_id", in: "query", type: "uuid", description: "BU scope." },
        ],
        responses: [{ status: 200, description: "Paginated list." }],
      },
      {
        id: "recon-create",
        method: "POST",
        path: "/recons",
        summary: "Create a reconciliation",
        description: "Creates a recon definition with sides, key mappings and matching rules.",
        params: [],
        requestBody: {
          contentType: "application/json",
          schemaRef: "CreateReconRequest",
          example: JSON.stringify(
            {
              name: "Nostro vs GL",
              sides: ["nostro", "gl"],
              key: ["trade_date", "amount", "ccy"],
              rules: [
                { type: "exact_one_to_one", on: ["trade_date", "amount", "ccy"] },
                { type: "tolerance", field: "amount", abs: 0.01 },
                { type: "fuzzy_many_to_many", on: ["narrative"], threshold: 0.82 },
              ],
            },
            null,
            2,
          ),
        },
        responses: [{ status: 201, description: "Created." }],
      },
      {
        id: "recon-run",
        method: "POST",
        path: "/recons/{id}/runs",
        summary: "Trigger a run",
        description: "Queues an ad-hoc reconciliation run and returns a durable workflow job immediately.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Recon ID." },
          { name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key, maximum 128 characters." },
        ],
        responses: [
          { status: 202, description: "Run queued.", body: JSON.stringify({ job_id: "job_01H...", status: "queued" }, null, 2) },
        ],
        scopes: ["recons.run"],
        rateLimit: "60 requests/minute/API token",
      },
      {
        id: "recon-run-get",
        method: "GET",
        path: "/workflow-jobs/{runId}",
        summary: "Get run status",
        description: "Returns queue lifecycle and completed reconciliation metrics for a workflow job.",
        params: [
          { name: "runId", in: "path", type: "uuid", required: true, description: "Workflow job ID." },
        ],
        responses: [
          {
            status: 200,
            description: "Run object.",
            body: JSON.stringify(
              { job_id: "job_...", status: "succeeded", result: { run_id: "run_...", matched_count: 18821, exception_count: 142 } },
              null,
              2,
            ),
          },
        ],
        scopes: ["recons.run"],
      },
    ],
  },
  {
    key: "matches",
    name: "Matches",
    blurb: "Read confirmed matches, evidence, and apply 4-eyes overrides.",
    endpoints: [
      {
        id: "matches-list",
        method: "GET",
        path: "/recons/{id}/matches",
        summary: "List matches",
        description: "Returns matched record pairs/groups with confidence scores and contributing rule IDs.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Recon ID." },
          { name: "min_confidence", in: "query", type: "number", description: "Filter by ML confidence (0–1).", example: 0.85 },
        ],
        responses: [{ status: 200, description: "Paginated matches." }],
      },
      {
        id: "matches-manual",
        method: "POST",
        path: "/recons/{id}/matches",
        summary: "Propose a manual match (4-eyes)",
        description: "Creates a manual match proposal that requires approval by a second user before posting.",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "Recon ID." }],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ left_ids: ["rec_a1"], right_ids: ["rec_b1", "rec_b2"], reason: "Bulk settle" }, null, 2),
        },
        responses: [{ status: 202, description: "Proposal created, awaiting approver." }],
      },
    ],
  },
  {
    key: "breaks",
    name: "Breaks (Exceptions)",
    blurb: "List, triage, assign, age and resolve breaks. SLA-aware lifecycle with MTTR tracking.",
    endpoints: [
      {
        id: "breaks-list",
        method: "GET",
        path: "/recons/{id}/breaks",
        summary: "List breaks",
        description: "Returns breaks with lifecycle state, age, assignee, root-cause classification, and SLA status.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Recon ID." },
          { name: "state", in: "query", type: "string", enum: ["new", "assigned", "investigating", "pending_counterparty", "resolved", "written_off"], description: "Lifecycle filter." },
          { name: "assignee", in: "query", type: "uuid", description: "Filter by assignee user ID." },
          { name: "sla", in: "query", type: "string", enum: ["on_track", "at_risk", "breached"], description: "SLA filter." },
        ],
        responses: [{ status: 200, description: "Paginated breaks." }],
        scopes: ["recons.read"],
        rateLimit: "120 requests/minute/API token",
      },
      {
        id: "break-get",
        method: "GET",
        path: "/recons/{id}/breaks/{breakId}",
        summary: "Get a break",
        description: "Returns full break payload including evidence, comments, agent triage output and audit trail.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Recon ID." },
          { name: "breakId", in: "path", type: "string", required: true, description: "Break ID." },
        ],
        responses: [{ status: 200, description: "Break object." }],
        scopes: ["recons.read"],
        rateLimit: "120 requests/minute/API token",
      },
      {
        id: "break-action",
        method: "POST",
        path: "/recons/{id}/breaks/{breakId}/actions",
        summary: "Action a break",
        description:
          "Durably action a break using assign, classify, comment, attach-metadata, resolve, request-write-off, independently approve/reject-write-off, reopen, or reprocess. Every call requires an Idempotency-Key; reprocess additionally requires recons.run.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Recon ID." },
          { name: "breakId", in: "path", type: "string", required: true, description: "Break ID." },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ action: "resolve", resolution_code: "matched_offline", note: "Confirmed with counterparty" }, null, 2),
        },
        responses: [{ status: 200, description: "Updated break." }, { status: 201, description: "Comment or attachment metadata created." }, { status: 202, description: "Reprocessing queued." }, { status: 409, description: "Idempotency conflict or request in progress." }],
        scopes: ["breaks.write"],
        rateLimit: "60 requests/minute/API token",
      },
    ],
  },
  {
    key: "aidp",
    name: "Adaptive IDP",
    blurb: "Upload structured / unstructured documents (PDF, email, image) and extract entities for downstream recon.",
    endpoints: [
      {
        id: "aidp-types",
        method: "GET",
        path: "/aidp/document-types",
        summary: "List document types",
        description: "Returns active document type templates (Confirms, Statements, NAV reports, etc.).",
        params: [],
        responses: [{ status: 200, description: "Array of document types." }],
      },
      {
        id: "aidp-upload",
        method: "POST",
        path: "/api/public/aidp/extract",
        summary: "Queue document extraction",
        description: "Authenticates a tenant token, applies the tenant quota, validates and stores an allow-listed HTTPS PDF/PNG/JPEG, and queues provider extraction. Expensive AI work never runs in the incoming request.",
        params: [
          { name: "x-aidp-token", in: "header", type: "string", required: true, description: "Tenant API token with aidp:extract scope." },
          { name: "Idempotency-Key", in: "header", type: "string", required: false, description: "Stable retry key, maximum 200 characters." },
        ],
        rateLimit: "Per-tenant daily quota plus one-at-a-time worker claims and bounded retries",
        requestBody: { contentType: "application/json", example: JSON.stringify({ document_type_code: "bank_statement", file_url: "https://storage.example/statement.png" }, null, 2) },
        responses: [{ status: 202, description: "Stored and queued. Follow the Location job URL." }, { status: 429, description: "Tenant quota exceeded; Retry-After returned." }],
      },
      {
        id: "aidp-upload-status",
        method: "GET",
        path: "/api/public/aidp/jobs/{jobId}",
        summary: "Get extraction job status",
        description: "Returns queued/running/retry/dead state and, when successful, prediction identifiers, confidence scores, and structured fields. Tenant token scope is revalidated on every poll.",
        params: [
          { name: "jobId", in: "path", type: "string", required: true, description: "Queued AIDP job ID." },
          { name: "x-aidp-token", in: "header", type: "string", required: true, description: "Tenant API token with aidp:extract scope." },
        ],
        responses: [{ status: 200, description: "Job state or completed extraction." }, { status: 404, description: "Job is not visible to this tenant token." }],
      },
    ],
  },
  {
    key: "reports",
    name: "Reports & Analytics",
    blurb: "Run pre-built reports, schedule deliveries, and export to PDF / XLSX / Parquet.",
    endpoints: [
      {
        id: "report-list",
        method: "GET",
        path: "/reports",
        summary: "List reports",
        description: "Returns the catalog of saved and standard reports available to the caller.",
        params: [],
        responses: [{ status: 200, description: "Array of report definitions." }],
        scopes: ["reports.read"],
        rateLimit: "120 requests/minute/API token",
      },
      {
        id: "report-run",
        method: "POST",
        path: "/reports/{id}/run",
        summary: "Execute a report",
        description: "Runs a report synchronously (<10s) or returns a job ID for async download.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Report ID." },
          { name: "format", in: "query", type: "string", enum: ["json", "csv"], description: "Governed runtime output format.", example: "csv" },
        ],
        responses: [{ status: 200, description: "Report payload or job descriptor." }],
        scopes: ["reports.read"],
        rateLimit: "60 requests/minute/API token",
      },
    ],
  },
  {
    key: "reference-data",
    name: "Reference Data",
    blurb: "Stage immutable lookup snapshots, apply four-eyes publication, inspect effective versions and export reproducible evidence.",
    endpoints: [
      {
        id: "reference-data-list",
        method: "GET",
        path: "/reference-data",
        summary: "List reference tables",
        description: "Lists tenant-owned reference tables and their currently published projection version.",
        params: [{ name: "limit", in: "query", type: "integer", description: "Page size from 1 to 200." }],
        responses: [{ status: 200, description: "Reference table catalogue." }],
        scopes: ["reference-data.read"],
        rateLimit: "120 requests/minute/API token",
      },
      {
        id: "reference-data-versions",
        method: "GET",
        path: "/reference-data/{tableId}/versions",
        summary: "List immutable versions",
        description: "Returns bounded version metadata, effective dates, lifecycle status and content hashes.",
        params: [{ name: "tableId", in: "path", type: "uuid", required: true, description: "Reference table ID." }],
        responses: [{ status: 200, description: "Version history." }],
        scopes: ["reference-data.read"],
      },
      {
        id: "reference-data-stage",
        method: "POST",
        path: "/reference-data/{tableId}/versions",
        summary: "Stage a reference version",
        description: "Creates an immutable draft with deterministic composite-key and content hashes. Published data does not change.",
        params: [
          { name: "tableId", in: "path", type: "uuid", required: true, description: "Reference table ID." },
          { name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key, maximum 128 characters." },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ rows: [{ alias: "US DOLLAR", canonical: "USD" }], effective_from: "2026-09-08", effective_to: null, change_note: "Add approved currency alias" }, null, 2),
        },
        responses: [{ status: 201, description: "Immutable draft staged." }, { status: 409, description: "Idempotency conflict." }],
        scopes: ["reference-data.write"],
        rateLimit: "60 requests/minute/API token",
      },
      {
        id: "reference-data-submit",
        method: "POST",
        path: "/reference-data/{tableId}/versions/{versionId}/submit",
        summary: "Submit a version",
        description: "The version maker submits a verified draft for independent approval.",
        params: [
          { name: "tableId", in: "path", type: "uuid", required: true, description: "Reference table ID." },
          { name: "versionId", in: "path", type: "uuid", required: true, description: "Reference version ID." },
          { name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key, maximum 128 characters." },
        ],
        responses: [{ status: 200, description: "Version pending approval." }],
        scopes: ["reference-data.write"],
        rateLimit: "60 requests/minute/API token",
      },
      {
        id: "reference-data-decision",
        method: "POST",
        path: "/reference-data/{tableId}/versions/{versionId}/decision",
        summary: "Approve or reject a version",
        description: "Requires a different active tenant administrator. Approval atomically updates the effective published projection when applicable.",
        params: [
          { name: "tableId", in: "path", type: "uuid", required: true, description: "Reference table ID." },
          { name: "versionId", in: "path", type: "uuid", required: true, description: "Reference version ID." },
          { name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key, maximum 128 characters." },
        ],
        requestBody: { contentType: "application/json", example: JSON.stringify({ approve: true, reason: "Validated against treasury master data" }, null, 2) },
        responses: [{ status: 200, description: "Decision retained and publication completed when approved." }, { status: 403, description: "Maker/checker or role violation." }],
        scopes: ["reference-data.approve"],
        rateLimit: "60 requests/minute/API token",
      },
      {
        id: "reference-data-rollback",
        method: "POST",
        path: "/reference-data/{tableId}/versions/{versionId}/rollback",
        summary: "Create a rollback draft",
        description: "Clones a prior published snapshot into a new draft; rollback never mutates history or bypasses approval.",
        params: [
          { name: "tableId", in: "path", type: "uuid", required: true, description: "Reference table ID." },
          { name: "versionId", in: "path", type: "uuid", required: true, description: "Published source version ID." },
          { name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key, maximum 128 characters." },
        ],
        requestBody: { contentType: "application/json", example: JSON.stringify({ effective_from: "2026-10-01", reason: "Restore approved prior mapping" }, null, 2) },
        responses: [{ status: 201, description: "Rollback draft created for review." }],
        scopes: ["reference-data.write"],
        rateLimit: "60 requests/minute/API token",
      },
      {
        id: "reference-data-export",
        method: "GET",
        path: "/reference-data/{tableId}/versions/{versionId}/export",
        summary: "Export a version",
        description: "Downloads tenant-bound JSON or formula-safe CSV with version and SHA-256 evidence metadata.",
        params: [
          { name: "tableId", in: "path", type: "uuid", required: true, description: "Reference table ID." },
          { name: "versionId", in: "path", type: "uuid", required: true, description: "Reference version ID." },
          { name: "format", in: "query", type: "string", description: "json or csv.", enum: ["json", "csv"] },
        ],
        responses: [{ status: 200, description: "Versioned export." }],
        scopes: ["reference-data.read"],
        rateLimit: "120 requests/minute/API token",
      },
    ],
  },
  {
    key: "environment-changes",
    name: "Environment & Delivery",
    blurb: "Create, review and independently approve hash-stable DEV and PROD change requests with immutable audit evidence.",
    endpoints: [
      {
        id: "environment-change-list",
        method: "GET",
        path: "/environment-changes",
        summary: "List environment change requests",
        description: "Lists bounded change-request status and integrity metadata for the token tenant.",
        params: [],
        responses: [{ status: 200, description: "Environment change request summary list." }],
        scopes: ["environment-changes.read"],
        rateLimit: "120 requests/minute/API token",
      },
      {
        id: "environment-change-read",
        method: "GET",
        path: "/environment-changes/{requestId}",
        summary: "Read a change request and audit history",
        description: "Returns the secret-free manifest, hashes, preflight, component results, final readback and ordered hash-linked events.",
        params: [{ name: "requestId", in: "path", type: "uuid", required: true, description: "Environment change request ID." }],
        responses: [{ status: 200, description: "Change request and immutable event history." }],
        scopes: ["environment-changes.read"],
        rateLimit: "120 requests/minute/API token",
      },
      {
        id: "environment-change-create",
        method: "POST",
        path: "/environment-changes",
        summary: "Create a formal environment change request",
        description: "Creates a tenant-bound DEV→PROD or PROD→DEV request. The service recomputes package, configuration, settings and aggregate hashes and rejects credential-shaped material.",
        params: [{ name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key from 8 to 128 characters." }],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ direction: "prod_to_dev", source_tenant_id: "00000000-0000-4000-8000-000000000001", target_tenant_id: "00000000-0000-4000-8000-000000000002", title: "Seed DEV from approved PROD baseline", reason: "Create the governed DEV assurance environment", manifest: { package: {}, configuration: {}, settings: {} } }, null, 2),
        },
        responses: [{ status: 201, description: "Pending change request with computed hashes." }, { status: 422, description: "Invalid or credential-bearing manifest." }],
        scopes: ["environment-changes.write"],
        rateLimit: "60 requests/minute/API token",
      },
      {
        id: "environment-change-decision",
        method: "POST",
        path: "/environment-changes/{requestId}/decision",
        summary: "Independently approve or reject a request",
        description: "Requires passed preflight evidence and a checker different from the requester. Execution remains service-only.",
        params: [
          { name: "requestId", in: "path", type: "uuid", required: true, description: "Environment change request ID." },
          { name: "Idempotency-Key", in: "header", type: "string", required: true, description: "Stable key from 8 to 128 characters." },
        ],
        requestBody: { contentType: "application/json", example: JSON.stringify({ approve: true, comment: "Preflight and manifest hashes independently verified" }, null, 2) },
        responses: [{ status: 200, description: "Decision retained." }, { status: 403, description: "Four-eyes or role violation." }, { status: 409, description: "Preflight or lifecycle conflict." }],
        scopes: ["environment-changes.approve"],
        rateLimit: "60 requests/minute/API token",
      },
    ],
  },
  {
    key: "webhooks",
    name: "Webhooks",
    blurb: "Subscribe to events: recon.run.completed, break.opened, break.resolved, sla.breached, upload.processed.",
    endpoints: [
      {
        id: "wh-list",
        method: "GET",
        path: "/webhooks",
        summary: "List webhooks",
        description: "Returns active webhook subscriptions with last-delivery status.",
        params: [],
        responses: [{ status: 200, description: "Array of subscriptions." }],
      },
      {
        id: "wh-create",
        method: "POST",
        path: "/webhooks",
        summary: "Create a webhook",
        description: "Registers an HTTPS endpoint. ReconIQ signs every delivery with HMAC-SHA256 using the returned secret.",
        params: [],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ url: "https://example.com/hooks/fvi", events: ["break.opened", "sla.breached"], active: true }, null, 2),
        },
        responses: [{ status: 201, description: "Created. Body includes the signing secret (shown once)." }],
      },
      {
        id: "wh-test",
        method: "POST",
        path: "/webhooks/{id}/test",
        summary: "Send a test event",
        description: "Posts a synthetic event so you can verify your endpoint's signature handling.",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "Webhook ID." }],
        responses: [{ status: 204, description: "Test dispatched." }],
      },
    ],
  },
  {
    key: "scim",
    name: "SCIM 2.0",
    blurb: "Standard SCIM v2 endpoints for user/group provisioning from Okta, Azure AD, OneLogin, Workspace.",
    endpoints: [
      { id: "scim-users", method: "GET", path: "/scim/v2/Users", summary: "List users", description: "RFC 7644 compliant.", params: [], responses: [{ status: 200, description: "ListResponse." }] },
      { id: "scim-user-create", method: "POST", path: "/scim/v2/Users", summary: "Create user", description: "Provisions a user.", params: [], responses: [{ status: 201, description: "User resource." }] },
      { id: "scim-groups", method: "GET", path: "/scim/v2/Groups", summary: "List groups", description: "Returns SCIM groups (ReconIQ Tenant Groups).", params: [], responses: [{ status: 200, description: "ListResponse." }] },
    ],
  },
  {
    key: "audit",
    name: "Audit",
    blurb: "Hash-chained, append-only audit log of every action in this tenant — including any platform admin activity.",
    endpoints: [
      {
        id: "audit-list",
        method: "GET",
        path: "/audit/events",
        summary: "List audit events",
        description: "Returns audit entries with actor, action, resource, prev_hash, and hash. Use the daily anchor to verify integrity.",
        params: [
          { name: "since", in: "query", type: "string", description: "ISO-8601 lower bound.", example: "2026-06-01T00:00:00Z" },
          { name: "action", in: "query", type: "string", description: "Filter by action verb." },
        ],
        responses: [{ status: 200, description: "Paginated audit events." }],
      },
      {
        id: "audit-anchor",
        method: "GET",
        path: "/audit/anchors/{date}",
        summary: "Get daily anchor",
        description: "Returns the SHA-256 anchor that seals all audit events for the given UTC date.",
        params: [{ name: "date", in: "path", type: "string", required: true, description: "YYYY-MM-DD.", example: "2026-06-26" }],
        responses: [{ status: 200, description: "Anchor record." }],
      },
    ],
  },
  {
    key: "events",
    name: "Event Stream",
    blurb: "Server-Sent Events stream of all tenant activity for real-time dashboards.",
    endpoints: [
      {
        id: "events-stream",
        method: "GET",
        path: "/events/stream",
        summary: "Subscribe to events",
        description: "Returns an SSE (text/event-stream) connection. Each event has `id`, `event`, and JSON `data`. Reconnect with the `Last-Event-Id` header.",
        params: [{ name: "topics", in: "query", type: "string", description: "Comma-separated event topics filter.", example: "break,run,upload" }],
        responses: [{ status: 200, description: "Streaming SSE." }],
      },
    ],
  },
];

/* ----------------------------- SCHEMAS ----------------------------- */

export const API_SCHEMAS: ApiSchema[] = [
  {
    name: "AccessTokenRequest",
    description: "Payload for POST /oauth2/token.",
    fields: [
      { name: "grant_type", type: "string", required: true, description: "client_credentials | refresh_token" },
      { name: "client_id", type: "string", required: true, description: "Personal access token or client ID." },
      { name: "client_secret", type: "string", required: true, description: "Secret (never log or store client-side)." },
      { name: "scope", type: "string", description: "Space-separated scopes (e.g. recons.read breaks.write)." },
    ],
  },
  {
    name: "DataSource",
    description: "A registered ingestion endpoint.",
    fields: [
      { name: "id", type: "string", required: true, description: "ULID identifier." },
      { name: "name", type: "string", required: true, description: "Display name." },
      { name: "kind", type: "enum", required: true, description: "file | sftp | s3 | azure_blob | snowflake | bigquery | api | stream" },
      { name: "bu_id", type: "uuid", description: "Business unit owning this source." },
      { name: "schema_locked", type: "boolean", description: "Whether AI auto-mapping is frozen." },
    ],
  },
  {
    name: "Recon",
    description: "Reconciliation definition.",
    fields: [
      { name: "id", type: "string", required: true, description: "Recon ID." },
      { name: "sides", type: "string[]", required: true, description: "1, 2, or 3 logical sides." },
      { name: "key", type: "string[]", required: true, description: "Composite matching key fields." },
      { name: "rules", type: "ReconRule[]", required: true, description: "Ordered matching rules." },
      { name: "state", type: "enum", description: "draft | active | paused | archived" },
    ],
  },
  {
    name: "Break",
    description: "A reconciliation exception.",
    fields: [
      { name: "id", type: "string", required: true, description: "Break ID." },
      { name: "recon_id", type: "string", required: true, description: "Parent recon." },
      { name: "state", type: "enum", required: true, description: "open | investigating | blocked | resolved | written_off" },
      { name: "amount_diff", type: "number", description: "Signed difference in base currency." },
      { name: "sla", type: "enum", description: "on_track | at_risk | breached" },
      { name: "assignee_id", type: "uuid", description: "Current owner." },
      { name: "evidence", type: "object[]", description: "Linked records and AI-triage citations." },
    ],
  },
  {
    name: "WebhookEvent",
    description: "Webhook delivery envelope (HMAC-SHA256 signed in X-FVI-Signature).",
    fields: [
      { name: "id", type: "string", required: true, description: "Unique delivery ID." },
      { name: "event", type: "string", required: true, description: "e.g. break.opened" },
      { name: "occurred_at", type: "string", required: true, description: "ISO-8601 timestamp." },
      { name: "data", type: "object", required: true, description: "Event payload." },
    ],
  },
  {
    name: "ErrorResponse",
    description: "Uniform error envelope returned for 4xx and 5xx.",
    fields: [
      { name: "error", type: "string", required: true, description: "Stable error code (e.g. validation_error)." },
      { name: "message", type: "string", required: true, description: "Human-readable summary." },
      { name: "request_id", type: "string", required: true, description: "Echo this in support tickets." },
      { name: "details", type: "object", description: "Field-level errors when applicable." },
    ],
  },
];

/* ----------------------------- META ----------------------------- */

export const API_ERROR_CODES = [
  { code: 400, name: "bad_request", desc: "Malformed JSON or invalid query." },
  { code: 401, name: "unauthorized", desc: "Missing or expired bearer token." },
  { code: 403, name: "forbidden", desc: "Token lacks the required scope or BU access." },
  { code: 404, name: "not_found", desc: "Resource does not exist in this tenant." },
  { code: 409, name: "conflict", desc: "Idempotency or version conflict — retry with a fresh ETag." },
  { code: 412, name: "step_up_required", desc: "Destructive action — re-authenticate with WebAuthn / TOTP." },
  { code: 422, name: "validation_error", desc: "Request body failed schema validation." },
  { code: 429, name: "rate_limited", desc: "Slow down — see Retry-After header." },
  { code: 500, name: "internal_error", desc: "ReconIQ side. Include request_id when contacting support." },
  { code: 503, name: "service_unavailable", desc: "Maintenance or capacity event — check status page." },
];

export const API_SCOPES = [
  { name: "recons.read", desc: "Read recon definitions, runs, matches, and breaks." },
  { name: "recons.write", desc: "Create/update recons and trigger runs." },
  { name: "breaks.write", desc: "Action breaks (assign, resolve, write-off)." },
  { name: "ingestion.write", desc: "Push records and upload files." },
  { name: "aidp.write", desc: "Submit documents for AI extraction." },
  { name: "reports.read", desc: "Run and download reports." },
  { name: "reference-data.read", desc: "Read and export tenant Reference Data versions." },
  { name: "reference-data.write", desc: "Stage, submit and request rollback of Reference Data versions." },
  { name: "reference-data.approve", desc: "Approve or reject Reference Data versions as an independent tenant administrator." },
  { name: "environment-changes.read", desc: "Read tenant-bound DEV and PROD change requests and immutable audit history." },
  { name: "environment-changes.write", desc: "Create secret-free DEV and PROD change requests." },
  { name: "environment-changes.approve", desc: "Independently approve or reject preflighted environment changes." },
  { name: "connectors.agent", desc: "Lease and complete jobs for one approved tenant-bound on-premises connector agent." },
  { name: "webhooks.manage", desc: "Manage webhook subscriptions." },
  { name: "scim.manage", desc: "SCIM 2.0 user/group provisioning." },
  { name: "audit.read", desc: "Read the tenant audit trail." },
];

/* ----------------------- OPENAPI EXPORTER ----------------------- */

export function buildOpenApi(tenantSlug: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const g of API_GROUPS) {
    for (const e of g.endpoints) {
      const p = e.path.replace("{tenantSlug}", tenantSlug);
      paths[p] = paths[p] ?? {};
      paths[p][e.method.toLowerCase()] = {
        tags: [g.name],
        summary: e.summary,
        description: e.description,
        parameters: e.params.map((pp) => ({
          name: pp.name,
          in: pp.in === "body" ? "header" : pp.in,
          required: !!pp.required,
          description: pp.description,
          schema: { type: pp.type, enum: pp.enum },
        })),
        requestBody: e.requestBody
          ? { required: true, content: { [e.requestBody.contentType]: { example: tryParse(e.requestBody.example) } } }
          : undefined,
        responses: Object.fromEntries(
          e.responses.map((r) => [
            String(r.status),
            { description: r.description, content: r.body ? { "application/json": { example: tryParse(r.body) } } : undefined },
          ]),
        ),
        security: [{ bearerAuth: e.scopes ?? [] }],
      };
    }
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "ReconIQ API",
      version: API_VERSION,
      description: "Tenant-scoped REST API for reconciliation, ingestion, AIDP, breaks, reports, and audit.",
    },
    servers: [{ url: `https://api.fvi.app${API_BASE_PATH.replace("{tenantSlug}", tenantSlug)}` }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: Object.fromEntries(
        API_SCHEMAS.map((s) => [
          s.name,
          {
            type: "object",
            description: s.description,
            required: s.fields.filter((f) => f.required).map((f) => f.name),
            properties: Object.fromEntries(
              s.fields.map((f) => [f.name, { type: f.type, description: f.description }]),
            ),
          },
        ]),
      ),
    },
    paths,
  };
}

function tryParse(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}
