# ReconIQ MCP Gateway

Private, tenant-scoped MCP/ChatGPT app for governed reconciliation operations. It is a thin adapter over FVI's versioned APIs: it has no Supabase access, connector credentials, filesystem tools, arbitrary HTTP tools, SQL tools, or credential-lifecycle tools.

## Runtime contract

- `view_operations_dashboard` renders the bounded operational dashboard.
- Read tools cover reconciliation definitions/runs, breaks/evidence, workflow jobs, connector schedules/capabilities and report catalogues.
- Write tools queue Data Prep, reconciliation and connector runs, submit bounded break actions and generate registered reports.
- Every write requires `confirmed: true`; queued and break mutations also require an idempotency key.
- The bearer token is introspected by FVI and then forwarded to the canonical FVI API, which independently revalidates tenant, scope, resource, throttling, idempotency and approval policy.

## Configuration

Configure values through the deployment platform. Never commit them.

```text
FVI_API_ORIGIN=https://<canonical-fvi-origin>
MCP_PUBLIC_ORIGIN=https://<dedicated-mcp-origin>
MCP_OAUTH_ISSUER=https://<authorization-server>
MCP_OAUTH_AUTHORIZATION_ENDPOINT=https://<authorization-server>/authorize
MCP_OAUTH_TOKEN_ENDPOINT=https://<authorization-server>/token
MCP_OAUTH_REGISTRATION_ENDPOINT=https://<authorization-server>/register
```

FVI now owns a separate authorization-code/PKCE flow at `/oauth/authorize`, `/api/public/oauth/mcp-token`, and `/api/public/oauth/register`. It issues short-lived tenant-bound tokens accepted by `/api/public/tokens/introspect`, rotates refresh tokens, and leaves the pre-existing sandbox client-credentials issuer unchanged. Deployment remains gated until migration `20260909070000` is applied and the complete flow is live-tested.

## Local gates

```bash
bun install --frozen-lockfile
bun run build
bun run evals
bun run evals:types
```

The development server is `bun run dev`. It serves the MCP endpoint at `/mcp` and the Skybridge development UI at the printed local address.

## Deployment boundary

Deploy separately from the FVI application Worker as `fvi-mcp-gateway-prod`. PROD proof precedes any DEV deployment. No deployment or connector publication is a PASS until bearer validation, tenant mismatch, missing-scope, explicit confirmation, idempotent replay, throttling, four-eyes denial, audit correlation and dashboard accessibility are evidenced against the exact deployed source.
