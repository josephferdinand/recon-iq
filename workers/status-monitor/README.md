# ReconIQ independent status service

Live page: https://status.reconiq.example

This standalone Cloudflare Worker is independent of the application process, user
sessions, Codex, the desktop and browser. It requires no npm dependencies or bundler.
The main PROD/DEV applications and the paused product backlog are unchanged.

## Two hosted jobs

- Health: `*/15 * * * *`, every15minutes in UTC. Checks both environments' web
  sign-in/SSR endpoint, PostgreSQL status catalogue read, Auth health, Storage
  health and published status API.
- Database heartbeat: `*/30 * * * *`, every30minutes in UTC. Independently performs
  a real read-only `status_components` query in each Supabase database and persists
  the outcome, time and latency. No business, identity or financial row is changed.

Both schedules have independent persistence keys, bounded requests and separate
last-run/trigger evidence. Cron delivery is provider-managed and not an exact-time
SLA; the public page changes to unverified when observations become stale.

## Credentials and isolation

`PROD_PUBLIC_KEY`, `DEV_PUBLIC_KEY` and `MONITOR_ADMIN_TOKEN` are Cloudflare secret
bindings. Supabase keys are existing anon/public keys, not service-role keys.
Only fixed verified ReconIQ project URLs are reachable through probe selection.
Public responses contain no operator credentials, database records or raw errors.
The operator token's private local copy is under the existing ReconIQ QA-private folder;
its exact path is recorded in the deployment receipt. Never copy it into source,
chat, URLs or public documentation.

Browser requests read only persisted monitoring results. They cannot initiate
network probes. Protected operator verification uses `/api/admin/check` with
`kind=health` or `kind=heartbeat`; unauthenticated calls are denied. Scheduled runs
record trigger=`scheduled`; operator checks do not count as automatic Cron proof.

## Evidence and incidents

The page includes PROD/DEV controls, service states,24-hour response charts,
90-day observed summaries, service detail dialogs and incident timelines. The
30-day service bars are explicitly measured samples; unobserved days are gray.
History begins at the first recorded check. No historical uptime is fabricated.
Two consecutive unavailable health samples create an automated incident; endpoint
recovery appends a resolved update. Public business-function coverage remains
unverified unless a current, deployed functional check is actually published.
Endpoint availability is not proof that a protected reconciliation workflow works.

Supabase's documented inactivity rule uses database activity. This service creates
real status queries at both intervals; it does not override a provider-imposed pause,
outage, invalid credentials or account restriction. No billing plan was changed.

## Tests, deployment and recovery

Focused tests: `node --test workers/status-monitor/status.test.mjs` (13cases at first
qualified release). They use dummy keys, mocked fetch and in-memory KV; no business
or provider mutation occurs in tests. The local architecture uses direct Worker
modules rather than a full application build because host RAM admission remains
above18GiB. No new agent, browser or background development helper was started.

Deployment/readback operator scripts are in `scripts/status-monitor-*`.
**Do not rerun a completed upload or bootstrap after a lost process handle.** First
inspect the saved receipts, Worker version/bindings, existing namespace, public API
and schedule state. A changed module requires a newly reviewed source hash and
affected checks; retain prior receipts before publishing a successor.

The friendly domain uses a status-hostname-only Worker route. Its old proxied CNAME
to the owned Pages application is preserved. Remove only the recorded Worker route
to restore previous origin routing; stop only the recorded Cron expressions if the
owner explicitly requests stopping this service. Keep its namespace/history and
all other project resources. No rollback or schedule disable runs automatically.

Release receipts: `docs/evidence/FVI_STATUS_MONITOR_RELEASE_2026-10-25/`.

Other product work, the13 audit candidates and all other backlog remain PAUSED.
