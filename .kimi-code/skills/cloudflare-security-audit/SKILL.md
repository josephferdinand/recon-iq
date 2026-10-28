---
name: cloudflare-security-audit
description: Security audit for Cloudflare Pages/Workers deployments — secrets, headers, WAF, memory and data-leak prevention
type: prompt
whenToUse: When deploying, configuring, or reviewing anything on Cloudflare (Pages, Workers, wrangler config, bindings, secrets, WAF, caching, logs), before any public deployment or public repository release, and whenever a change touches env vars, headers, CORS, uploads, auth, or logging
---

# Cloudflare Security Audit

Audit before every public deploy and every public push. A deployment with an open Critical or High finding is **not done** — fix it or get the owner's explicit written acceptance of that specific risk. "We'll fix it after launch" is not acceptance.

## Secrets — zero tolerance

- Secrets exist only in: local `.env.local` / `.dev.vars` (gitignored), Cloudflare encrypted secrets (`wrangler secret put` / Pages project secrets), and the target platform's secret store. Never in `wrangler.jsonc` `vars`, never in git, chat, tickets, PR text, screenshots, or logs.
- Nothing secret is ever `VITE_`-prefixed or otherwise build-time-inlined. Build with placeholder-shaped public values if a bundler demands presence; inject real secrets at runtime.
- Verify before push/deploy: `git check-ignore .env.local .dev.vars`; grep the staged tree and the built `dist/` for key patterns (`service_role`, `sb_secret_`, `eyJhbGciOi`, `ghp_`, `sk-`, private-key headers). Any hit stops the release.
- Preview and production get separate secrets. Rotate anything that was ever pasted, committed, or screen-shared — rotation, not deletion of the message, is the fix.
- Print secrets never; report presence, length, and shape only. When scripting with credentials, load them inside the script and emit status codes, never values.

## Worker / Pages configuration audit

- `wrangler.jsonc`: no account IDs of other projects, no stale bindings, `compatibility_date` current, `nodejs_compat` only if needed. Every KV/R2/D1/Queue/Service binding is used, least-privilege, and environment-correct (no prod bindings reachable from preview).
- Security headers on all responses: CSP (no `unsafe-inline` for scripts unless justified per-route), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, frame protection (`frame-ancestors` / `X-Frame-Options`). Authenticated and API responses: `Cache-Control: private, no-store`.
- Caching: CDN cache only for genuinely public, non-personalised assets. Never cache authenticated HTML/API, signed URLs, or per-tenant data; check cache rules and `Set-Cookie` handling.
- CORS: explicit origin allowlist; never `*` with credentials. Cookies: `HttpOnly; Secure; SameSite`, scoped path/domain.
- WAF & rate limiting enabled (this repo ships `cloudflare/waf-*.json` — apply or consciously defer each ruleset); bot/Turnstile on public forms; request body size limits on every upload/parse endpoint.
- Source maps are not publicly served. Error pages and API errors leak no stack traces, SQL, env names with values, internal paths, or provider raw errors — map to safe user messages server-side.
- Logs: metadata only (request id, route, status, timing, sizes, hashes). Never log `Authorization`, cookies, full headers, request/response bodies with user data, uploaded file contents, or AI prompts containing tenant data. Set retention deliberately; restrict log access.
- Redirects/headers files (`_headers`, `_redirects`, `_routes.json` in `dist/`) reviewed — no open redirects to arbitrary external URLs from user input.

## Memory & resource safety (Workers are not servers)

- Respect the Worker memory/CPU envelope: stream large files (never buffer whole uploads/PDFs/CSVs in memory), paginate every list query, bound concurrency and batch sizes, set timeouts on all outbound fetches.
- No unbounded in-memory caches, no per-request global state that grows, no retained references to request-scoped data in module scope (cross-request tenant data leakage is a memory bug and a security bug).
- Validate and cap: file size, row counts, JSON body size, decompression (zip bombs), image/PDF page counts — before parsing.
- Every external call (Supabase, AI providers, email) has timeout + bounded retry; failures degrade to safe errors, never hang the request open.

## Audit procedure

1. Inventory: Pages/Workers projects, bindings, secret *names* (not values), domains/routes, WAF/cache rules in force.
2. Run the checks above against config files, source, and the built artifact.
3. Probe the live URL: headers, cache behaviour on an authenticated route, error shapes, CORS preflight from a foreign origin, oversized upload rejection.
4. Report findings as: severity (Critical/High/Medium/Low) · evidence (`file:line` or live response) · impact · fix · verification. No finding without evidence; no "looks fine" without a check.
5. Gate: Critical/High open ⇒ no public deploy/push. Re-run after fixes and state what was re-verified.

## Red flags — stop immediately

- Any secret in a built bundle, git history, or chat; "temporary" public access, disabled RLS, or wildcard CORS "for the demo"; logging turned up to raw bodies "just for tonight"; source maps shipped to production unnoticed. Each of these ends the release until fixed.
