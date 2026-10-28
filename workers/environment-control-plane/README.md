# Environment control plane Worker

This private Worker transports a source-approved environment package to the matching target project. The caller's bearer token identifies the **source checker** and is used only with the source project's export and transport-record RPCs. The target receiver uses the target service role plus `TARGET_INTAKE_ACTOR_ID`, which identifies the **target intake maker** in the target audit trail. A separate target checker must approve the imported request before execution.

## Target configuration

Each deployment (PROD, DEV, and a future UAT) needs its own target project reference, Supabase URL, service role binding, and `TARGET_INTAKE_ACTOR_ID`. The intake actor is an existing, governed target-project `auth.users.id` UUID with an email and platform administrator or target-tenant administrator permission. Provision and approve that identity through the normal target administration process. It must not be the source checker or the human target checker. A source user UUID or a fabricated UUID cannot stand in for it. The database checks its existence and target role; the Worker checks only UUID syntax and whether configuration is present.

`TARGET_INTAKE_ACTOR_ID` is deliberately absent from `wrangler.jsonc` because no target identity has been provisioned in this repository. Configure it separately for each Worker environment alongside `TARGET_SUPABASE_SERVICE_ROLE_KEY`, and keep values out of source and logs. `.dev.vars.example` shows local variable names. Imports are paused unless `ENVIRONMENT_CHANGE_IMPORTS_PAUSED` is explicitly set to the string `false`; missing, blank, or any other value keeps the gate closed. `/health` exposes only the boolean `environment_change_imports_paused`, and authenticated `/v1/environment-changes/receive` returns 503 before any source RPC while paused. Until target bindings are configured, `/health` reports `target_configured: false` and receive returns 503. `ok: true` means the Worker is reachable; `target_configured` plus `environment_change_imports_paused: false` are the intake readiness signals. Source publishable key/URL bindings must also exist for each enabled source environment.

Set or change the gate through Wrangler's interactive secret prompt; do not pass the value on the command line or print it. The production-target Worker is the default environment, and `--env dev` selects the DEV-target Worker:

```powershell
wrangler secret put ENVIRONMENT_CHANGE_IMPORTS_PAUSED --config workers/environment-control-plane/wrangler.jsonc
wrangler secret put ENVIRONMENT_CHANGE_IMPORTS_PAUSED --config workers/environment-control-plane/wrangler.jsonc --env dev
```

Enter `true` to pause or the exact string `false` to open. `wrangler secret list` confirms only whether the binding name exists. The app's service-bound `/health` readback returns booleans only; source-stage approval checks it before writing approval. A missing/unreachable health binding or incomplete target configuration blocks approval. The Worker checks the pause again on every receive request, so a pause racing with approval still prevents target intake; in that race the source approval remains explicitly approved with failed transport status for governed follow-up.

The target receiver contract is `receive_environment_change_for_api(jsonb,text,uuid)` from migration `20260923133000_bind_target_environment_importer.sql`. The two-argument receiver is revoked in that migration. Deploy the matching Worker and migration in a coordinated release window; either partial order stops imports. Reimport legacy unbound target requests through the governed path, keeping the source and audit history. Do not grant access to the old receiver to work around a missing intake actor.

Verify with `bunx vitest run tests/environment-control-plane-worker.spec.ts` and `bunx tsgo --noEmit --project workers/environment-control-plane/tsconfig.json`. The tests use synthetic identities and stubbed RPCs; they do not prove a live target actor is provisioned or that PROD/DEV intake has succeeded.
