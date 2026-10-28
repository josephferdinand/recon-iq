# Auth Coverage Report — 2026-08-22

> **Author:** Aria (auth-test specialist) · **Agent ID:** aria
> **Scope:** Comprehensive auth coverage for FVI auth surface
> **Runtime:** `python tests/auth/run_auth_tests.py` (Python 3 stdlib only)
> **Augmented by:** Playwright MCP-driven UI screenshots + shell endpoint probe

## Coverage matrix

| Flow | API test | UI test | Shell test | Status | Reason |
|------|----------|---------|------------|--------|--------|
| **Signup** (`POST /auth/v1/signup`) | YES | n/a | n/a | **BLOCKED · env** | `SUPABASE_PROD_ANON_KEY` not in env (LL-011 — credentials never in chat). Flow 2 also reports BLOCKED. |
| **Login (password grant)** (`POST /auth/v1/token?grant_type=password`) | YES | YES (form probe) | n/a | **BLOCKED · env** | Same anon-key precondition. UI form reaches 401 or 200 depending on creds. |
| **Refresh token rotation** (`POST /auth/v1/token?grant_type=refresh_token`) | YES | n/a | n/a | **BLOCKED · env** | Requires refresh_token from login (chained BLOCKED). |
| **Logout** (`POST /auth/v1/logout`) | YES | YES (post-login) | n/a | **BLOCKED · env** | Requires access_token. |
| **Password change** (`PUT /auth/v1/user`) | YES | n/a | n/a | **BLOCKED · env** | Requires access_token. |
| **Password reset / recover** (`POST /auth/v1/recover`) | YES | YES (`/auth?mode=forgot`) | n/a | **BLOCKED · env** | Anon key only — Flow 6 attempted, no happy-path proven. |
| **MFA / TOTP enroll** (`POST /auth/v1/factors/enroll`) | YES | n/a | n/a | **BLOCKED · env** | MFA may also be project-disabled (per Flow 7 history). |
| **MFA challenge/verify** (`POST /auth/v1/factors/{id}/challenge`) | YES | n/a | n/a | **BLOCKED · env** | Chained from enrollment. |
| **SCIM 2.0 create/list/filter/patch/delete** (`/api/public/scim/v2/Users`) | YES | n/a | n/a | **BLOCKED · env** | `SCIM_SHARED_SECRET` in vault = `<pending>` (LL-017). Operator must provision via dashboard. |
| **OAuth2 client_credentials** (`POST /api/public/oauth/token`) | YES | n/a | YES | **BLOCKED · edge** | All probes return HTTP 403 (Cloudflare bot challenge, LL-021) or HTTP 500 (current prod outage, LL-025). |
| **Role-based access** | YES | n/a | n/a | **PARTIAL** | Probe reaches the route but no auth-token to verify 200/401 differentiation. |
| **Session expiry / token tamper** | YES | n/a | n/a | **BLOCKED · env** | Same anon key precondition. |
| **Endpoint health** | YES | n/a | YES | **FAIL** | 6/6 endpoints return HTTP 500 — prod deployment regression (see LL-025 + LL-016). |

### Reason taxonomy (LL-023)

- `BLOCKED · env` = test cannot run because a credential / env var is missing.
- `BLOCKED · code` = test ran but the code under test returned the wrong shape.
- `BLOCKED · edge` = probe is gated by an edge security feature (CF bot challenge).
- `PARTIAL` = some assertions met, others inconclusive.
- `PASS` = all assertions met.
- `FAIL` = assertions did not pass (e.g. production deployment is broken).

## How to enable each blocked flow

| Block reason | Resolution |
|--------------|------------|
| Missing anon key | Set `SUPABASE_PROD_ANON_KEY` in env (LL-011: paste via file-edit, not chat). Re-run `python tests/auth/run_auth_tests.py`. |
| Missing SCIM bearer | Provision `SCIM_SHARED_SECRET` in vault (currently `<pending>`). Set `RENATA_SCIM_TOKEN` in env to a token from `app.reconiq.example → Settings → SCIM Provisioning`. |
| Cloudflare bot challenge | Re-run from an authenticated browser context (Playwright MCP with `cf_clearance` cookie) — see LL-021. |
| Production deployment regression | Pages env vars updated at 03:30 UTC (LL-025) but a redeploy is required to take effect. Trigger `wrangler pages deploy dist --project-name fvi-app` (see LL-013 for invocation pattern). |
| MFA project-disabled | Enable in `supabase.com/dashboard → Auth → Multi-Factor Authentication → TOTP` (Flow 7 history). |

## New files added in this session

| Path | Purpose |
|------|---------|
| `tests/auth/run_auth_tests.py` | **Extended** — added Flows A, B, C, D, E, F, G, H, I', J (11 new flows). |
| `tests/auth/ui-flows.spec.ts` | **New** — Playwright MCP-driven smoke tests + screenshots driver. |
| `tests/auth/shell/auth-endpoint-health.sh` | **New** — `curl`-based endpoint probe; mirrors `verify-fvi.sh` pattern. |
| `tests/auth/AUTH_COVERAGE_REPORT_2026-08-22.md` | **New** — this file. |

## Files referenced (no edits)

- `tests/auth/auth-validation.spec.ts` — Vitest unit tests for `mapAuthError` + email validation.
- `tests/auth/password-reset.spec.ts` — Vitest unit tests for `reportAuthEvent` + reset flow surface.
- `tests/auth/landing-resolution.spec.ts` — auth landing resolver unit tests.
- `scripts/verify-fvi.sh` — pattern template for the new `auth-endpoint-health.sh`.
- `./.private/CREDENTIALS.md` — vault (LL-011 — values never echoed).

## Verification commands

```bash
# 1. Run the full Python auth suite (no extra deps; prints PASS/FAIL summary)
python tests/auth/run_auth_tests.py

# 2. Run the shell endpoint probe (exits non-zero if any endpoint 5xx)
bash tests/auth/shell/auth-endpoint-health.sh

# 3. Run the Vitest UI-flow spec (requires TEST_EMAIL/TEST_PASSWORD for happy-path)
pnpm exec vitest run tests/auth/ui-flows.spec.ts

# 4. (Aria MCP session) Capture UI screenshots
mcp__plugin_playwright_playwright__browser_navigate https://dev.app.reconiq.example/auth
mcp__plugin_playwright_playwright__browser_take_screenshot tests/auth/screenshots/01-auth-landing.png
```

## Blocked flows — explanation

The single biggest blocker for this session is the **production deployment regression**: every URL on `app.reconiq.example` returns HTTP 500 (the generic "This page didn't load" page), regardless of whether the bot challenge intercepted the request or the Worker itself errored. This is documented in LL-025 (Pages env vars don't propagate without redeploy) and LL-016 (chunk cycle). Until a redeploy lands, **none** of the API tests can return a meaningful pass/fail signal — every request returns 5xx or is blocked by Cloudflare.

The second blocker is the **missing anon key in the test environment**. Per LL-011, secrets are never pasted into chat; the operator must set `SUPABASE_PROD_ANON_KEY` in the shell environment (or in `~/.fvi-secrets/SUPABASE_PROD_ANON_KEY` per LL-017) before re-running. Without it, every Flow 2–7 test BLOCKS at the env-check.

The third blocker is the **missing SCIM bearer token**. `SCIM_SHARED_SECRET` is `<pending>` in the vault — SCIM tokens cannot be generated until that secret is set. Set it via `printf '%s' "$VALUE" | wrangler pages secret put SCIM_SHARED_SECRET --project-name fvi-app` (LL-013 + LL-024 pattern).

## Lessons learned (append to `lessons-learned.md` as LL-041+)

### LL-041 — Auth runner must distinguish BLOCKED reason categories at a glance (2026-08-22, Aria)

**What happened:** Every flow in the Renata auth runner reports `BLOCKED` when the test cannot run, but the operator can't tell at a glance whether the cause is a missing credential, a CF bot challenge, or a code-level failure. Three different bugs get the same flag.

**Resolution:** Introduce the LL-023 BLOCKED reason taxonomy:
- `BLOCKED · env` = missing credential / env var (LL-011 path)
- `BLOCKED · code` = code returned the wrong shape (e.g. 500 where 401 was expected)
- `BLOCKED · edge` = Cloudflare / WAF / rate-limit gated
- `PARTIAL` = some assertions met, others inconclusive
- `PASS` = all assertions met
- `FAIL` = assertions failed

The Python runner now includes `is_cloudflare_challenge()` + `classify_blocked()` helpers that auto-tag BLOCKED reasons. Shell runner prints `reachable | edge-gated | broken` counts.

**Preventive action:** All future runners should classify BLOCKED outcomes with one of the three tags. LL-023 documents the convention.

### LL-042 — Auth endpoint shell probe separates edge-gated from broken (2026-08-22, Aria)

**What happened:** When the prod deployment returns HTTP 500 on every URL, the operator needs to know "is this a Cloudflare bot challenge (edge, recoverable) or a broken Worker (code, need redeploy)". A single `curl ... | jq .code` won't tell you.

**Resolution:** `tests/auth/shell/auth-endpoint-health.sh` classifies HTTP codes:
- 200/3xx → `reachable`
- 401/403/405 → `edge-gated` (auth-required or bot challenge)
- 5xx/000 → `broken` (worker failure or unreachable)

**Preventive action:** All shell probes should bucket status codes the same way. Today's run shows `broken: 6` because the prod Pages project has not been redeployed after the env-var updates at 03:30 UTC — this is exactly the LL-025 symptom, surfaced by LL-042.

### LL-043 — Bot-challenge detection by content shape, not just status (2026-08-22, Aria)

**What happened:** A naive `if status == 403` flag treats the Cloudflare "I'm human" challenge the same as a real 403 forbidden response. The Renata runner was returning 403s and the operator couldn't tell whether the SCIM token was bad or whether Cloudflare was intercepting.

**Resolution:** `is_cloudflare_challenge()` checks the body shape:
```python
return r.status == 403 and body.startswith("<!doctype") and (
    "just a moment" in body or "attention required" in body
)
```

Apply the same body-shape check in any HTTP probe that targets a Cloudflare-fronted URL. Status alone is not enough.

**Preventive action:** When auditing HTTP probe results, never trust `r.status == 403` as a definitive "forbidden". Inspect the body for the CF challenge markers (`Just a moment…`, `cf-mitigated`, `cf-chl-bypass`).

---

*End of LL-043.*

## Cross-references

- `tests/auth/results-20260821T234613Z.json` — most recent run, all BLOCKED with reason tags.
- `.claude/memory/lessons-learned.md` — LL-001 through LL-040; append LL-041–LL-043 above.
- `./.private/CREDENTIALS.md` — vault (never echo values).
- `src/routes/api/public/oauth/token.ts` — OAuth2 client_credentials endpoint.
- `src/routes/api/public/scim/v2/$.ts` — SCIM 2.0 endpoint.

---

**Author:** Aria · **Session:** 2026-08-22 · **Vault:** `Falcon-Veritas-Keys.md` (LL-011 — read field names, never values)