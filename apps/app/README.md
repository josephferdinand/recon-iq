# @reconiq/app

Authenticated ReconIQ application — deployed to `app.reconiq.example`, `staging-app.reconiq.example`, and `status.reconiq.example`.

## Scope

Routes (see the repo root `README.md`):

- `/auth`, `/reset-password`
- `/console` (platform-owner chooser), `/m/approvals`
- `/_authenticated/*` (61 routes: ai-governance, aidp, recon, tenant, workspace, monitoring, regulatory, security-audit, kb, hub, onboarding, tenant.admin, tenant.settings.*)
- `/mkt-admin/*` (28 routes — internal marketing CMS, role-gated; lives in app for auth + PII reasons)

Public API endpoints (app-only):

- `/api/public/ai/inference`, `/api/public/aidp/extract`
- `/api/public/chat-ops/*` (slack, email)
- `/api/public/cron/*` (15 crons: ai-cost-anomaly, audit-anchor-verify, backup-verify, email-digest, recon-orchestrator, retention, sla-engine, soc2-harvest, rate-limit-watch, secret-rotation, security-alert, run-schedules, regulatory-install, gap-capacity, gap-hallucination, gap-rca, webhook-dispatch, aidp-output-processor)
- `/api/public/oauth/token`, `/api/public/openapi.yaml`
- `/api/public/payments/webhook`, `/api/public/scim/v2/$.ts`
- `/api/public/security-event`, `/api/public/status.json`, `/api/public/metrics-summary`

## Cron triggers (15 total)

All app-only per §3.4. Marketing has zero cron triggers.

## Security posture

- CSP `script-src 'self' 'nonce-...' 'strict-dynamic'` enforced from day one
- Rate limit 100 req/min per IP anon, 600/min per JWT authed
- DB-layer `pg_advisory_lock` quotas
- SCIM `Origin` header must be in allowlist
- Schema-scoped Postgres role: `app_writer` only — read on `marketing.*` for lead attribution + tenant branding
- All 11 CORS-sensitive routes use shared `ALLOWED_ORIGINS` whitelist (per D-007)

## See Also

- Repo root `README.md` — project overview, deploy and env var setup
- `@reconiq/ui` — shared Radix primitives
- `@reconiq/supabase-client` — auth-gated Supabase clients