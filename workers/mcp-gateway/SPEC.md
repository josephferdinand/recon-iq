# ReconIQ MCP Gateway v1

## Value proposition

Give authorized reconciliation operators and administrators a focused conversational interface for understanding current reconciliation operations and initiating governed actions without navigating multiple application screens.

Today an operator must move between reconciliation runs, workflow jobs, connector schedules, breaks and reports to assemble one operational picture. The MCP gateway reduces that navigation while preserving FVI as the sole authorization, tenant-isolation, approval, throttling, idempotency and audit authority.

### Core actions

1. Read reconciliation, break, workflow-job, connector and report status.
2. After explicit user confirmation, launch Data Prep, reconciliation and connector runs through existing governed APIs.
3. Investigate breaks and generate reports while preserving permissions, tenant isolation and four-eyes approval.

## Why an LLM

### Conversational advantage

An operator can ask, for example, “show failed cash reconciliations, explain their largest breaks and prepare the exception report” instead of manually joining several screens and filters. The assistant translates intent into a small sequence of bounded FVI tool calls and explains the returned operational facts.

### What the LLM contributes

- Interprets reconciliation terminology and user intent.
- Selects the smallest appropriate read tools and summarizes structured results.
- Prepares a proposed mutation with its target, effect and approval requirements.
- Helps investigate breaks by correlating authorized status, comments, audit and report data.

### What the LLM does not possess

The LLM has no direct database, filesystem, shell, provider-secret or arbitrary-network access. It cannot infer tenant membership, bypass an approval, change credentials or claim an action succeeded. All authoritative data and effects come from versioned FVI APIs.

## User experience

### First response

Return a compact text or card-like summary containing the requested status, environment, tenant, relevant identifiers, timestamps and clear links back to FVI where appropriate. Avoid reproducing a full application dashboard.

### Read interactions

The assistant selects one or more bounded read tools, receives stable minimal JSON and explains only records authorized by the validated tenant token. Pagination and filters are explicit and bounded.

### Write interactions

The assistant first presents a confirmation summary containing action, tenant, resource, expected effect and approval requirements. Only an explicit user confirmation permits the mutating tool call. Every mutation carries an idempotency key and returns either a durable workflow job or a stable synchronous action result.

### End state

The user receives a factual completion, queued-status or controlled-error summary with the job/action identifier, audit correlation and next useful step. Four-eyes work remains pending until a distinct authorized checker completes it in FVI.

## Product context

- Existing product: ReconIQ web application on Cloudflare with Supabase as the system of record.
- Gateway boundary: a separate private/stateless Worker; never embedded in the main application Worker.
- Backing interfaces: existing `/api/v1/{tenant}/...` workflow, connector, break and report APIs.
- Authentication: tenant-scoped FVI API bearer tokens with accountable creators and explicit scopes.
- Authorization: FVI revalidates token, tenant, scope, resource ownership and separation of duties on every request.
- Execution: expensive Data Prep, reconciliation and connector work uses the existing durable job queue and status endpoint.
- Rate limits: FVI's per-token/per-scope limits are authoritative; MCP propagates `429` and `Retry-After` without retry storms.
- Audit: correlate MCP request, token, actor, tenant, tool, resource, idempotency key and resulting job/action without recording plaintext tokens, secrets, prompts containing customer data or document contents.

## Tool groups

### Status and investigation

- Reconciliation status/list/detail.
- Break list/detail and authorized investigation context.
- Workflow-job status.
- Connector capability/schedule/job status.
- Report catalogue and generated-result metadata.

### Confirmed workflow launches

- Run Data Prep pipeline.
- Run reconciliation.
- Run connector schedule.

These tools are mutating, require explicit confirmation, accept an idempotency key and return the existing workflow job contract.

### Break and report actions

- Add an investigation comment or classification where the existing API permits it.
- Request/perform authorized break lifecycle actions.
- Generate JSON or CSV reports through the existing report API.

Write-off and other maker/checker actions cannot be self-approved. MCP exposes the existing pending state and never combines maker and checker identities.

## UX flows

### Status and investigation

1. Read reconciliation, break, workflow-job, connector or report status.
2. Return a bounded structured result and concise factual explanation.

### Confirmed workflow launch

1. Prepare a Data Prep, reconciliation or connector run target.
2. Present the action, tenant, resource and expected effect for explicit confirmation.
3. Submit the confirmed action with an idempotency key.
4. Return the durable workflow-job identifier and current state.

### Break and report action

1. Read the authorized break or report context.
2. For a mutation, present the exact action and approval implications for explicit confirmation.
3. Submit the bounded existing API action or report request.
4. Return the resulting break/report state and audit/job correlation. Maker/checker work remains pending for a distinct authorized checker.

Status/investigation includes a compact MCP dashboard view because the owner explicitly requires visual operational context in v1. It is not a full FVI port: it presents bounded authorized summaries and links/actions while the canonical application remains the detailed workspace.

## MCP API design

Dashboard view:

- `view_operations_dashboard`: one tenant-scoped view containing reconciliation health, active/recent workflow jobs, connector status, break aging/severity and report availability. It returns the full bounded summary in one call and manages display filters locally rather than issuing lazy tool calls.

Read tools:

- `list_reconciliations`
- `get_reconciliation`
- `list_breaks`
- `get_break`
- `get_workflow_job`
- `list_connector_schedules`
- `get_connector_capabilities`
- `list_reports`

Confirmed write tools:

- `run_data_prep`
- `run_reconciliation`
- `run_connector`
- `action_break`
- `generate_report`

Every tool requires `tenant_slug`. Read filters and page sizes are bounded. Workflow launch tools require `confirmed: true`, a UUID resource and a caller-supplied idempotency key. Break actions accept only the existing action enum and action-specific bounded fields; write-off approval/rejection remains a separate checker call. Report generation accepts only registered report IDs and `json` or `csv`.

All tools call the canonical FVI API origin selected from deployment configuration. The MCP gateway does not accept an upstream base URL from tool input and does not retry `429` responses automatically.

### Dashboard UI

- First view: tenant name/slug, freshness timestamp and five compact operational sections.
- Interactions: local section expansion, severity/status filters and selection of a returned resource. Refresh re-invokes `view_operations_dashboard`; it does not create duplicate read tools for the same payload.
- Write actions: the view may call the confirmed run/break/report tools only after showing action target/effect and receiving explicit confirmation.
- End state: current status or queued/action result with an FVI deep link and audit/job correlation.
- Accessibility: semantic headings/tables, keyboard operation, visible focus, reduced motion, high contrast and responsive light/dark rendering.

## Security invariants

- Tenant identity originates from the validated token and must equal every requested path/resource tenant.
- Read tools are the default; all writes carry an explicit side-effect annotation and confirmation requirement.
- No direct Supabase, SQL, arbitrary HTTP, shell, filesystem or secret-management tool.
- No token creation, retrieval, rotation, revocation, replacement, rescoping or permission change.
- No client-supplied provider credential, connection string or executable expression.
- Inputs are identifiers, bounded filters and existing enumerated action payloads only.
- The MCP gateway keeps no shadow job state and cannot weaken FVI's retry, throttling, idempotency, audit or four-eyes controls.
- Stable errors omit raw database/provider messages and sensitive payloads.
- Tool responses are minimal JSON and never expose other tenants' data.

## Deployment and verification

- Deploy as dedicated private `fvi-mcp-gateway-prod` and `fvi-mcp-gateway-dev` Workers after local validation.
- Prove tool schemas, read paths, confirmation enforcement, tenant mismatch, missing scope, replay, throttling, confused-deputy resistance, four-eyes denial and audit correlation.
- Validate PROD first with retained synthetic assurance data, then deploy the exact verified source to DEV.
- Keep hosted GitHub Actions consumption at zero for speculative runs; use local gates and `[skip ci]` delivery.

### Implementation checkpoint — 2026-09-06

- The Skybridge/Bun package now implements all fourteen approved v1 tools plus the responsive light/dark operations dashboard.
- The gateway has no Supabase client and accepts no URL, path, SQL, credential or connection-string input. It calls only fixed canonical FVI API routes.
- FVI now provides token introspection, bounded reconciliation list/detail and connector list/capability routes. API and MCP requests carry a UUID correlation hint into the authoritative FVI audit trail.
- Local evidence: MCP production build PASS, six MCP boundary/contract tests PASS, MCP eval typecheck PASS, application production build PASS, 152 files / 758 application tests PASS, application typecheck/lint/bundle-budget PASS.

### OAuth implementation checkpoint — 2026-09-09

- FVI is the authorization server for MCP v1. A separate authorization-code/PKCE consent flow uses the signed-in FVI user, requires an active tenant membership, limits scopes by tenant role, and creates short-lived opaque `api_tokens` accepted by the existing introspection endpoint.
- Public OAuth clients use validated HTTPS or loopback callbacks and dynamic registration. Authorization codes are single-use for five minutes; refresh tokens are hash-only, rotate on every use, and stop when tenant membership is inactive.
- The existing sandbox client-credentials issuer remains separate and unchanged. Migration `20260909070000` and the new endpoints must pass local replay and exact PROD browser/API proof before the gateway is deployed.
- Deployment remains gated until a real OAuth authorization server that issues FVI-introspectable tokens is configured. Placeholder OAuth metadata and implicit credential creation are prohibited.

## Explicit non-goals

- Full FVI application port or dashboard reproduction.
- Direct database or Supabase access.
- Generic fetch, SQL, code execution, filesystem browsing or secret retrieval.
- Credential lifecycle operations.
- Bypassing user confirmation, FVI authorization, tenant isolation, throttling, idempotency, audit or maker/checker controls.
