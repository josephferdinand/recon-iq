#!/usr/bin/env bash
# setup-fvi-envs.sh
#
# Verifies FVI Cloudflare Pages + Supabase environments are configured correctly.
# Reports a table of Pages projects, custom domains, env vars, and URL health.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=cfut_... CLOUDFLARE_ACCOUNT_ID=... \
#     bash scripts/setup-fvi-envs.sh
#
# Required env vars:
#   CLOUDFLARE_API_TOKEN   - Cloudflare API token (Pages:Edit scope)
#   CLOUDFLARE_ACCOUNT_ID  - Cloudflare account ID
#
# Optional:
#   SUPABASE_ACCESS_TOKEN  - to query schema drift (not yet wired)
#   QUIET=1                - suppress curl progress
#
# Exit codes:
#   0  - all required env vars set on all app projects, all URLs return 2xx
#   1  - any required env var missing
#   2  - any URL returned non-2xx
#   3  - both of the above

set -euo pipefail

# ─── Required inputs ────────────────────────────────────────────────────────
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

# Supabase project refs (Day 1: prod + dev; Day 14 will add uat)
PROD_REF="${PROD_REF:-YOUR_PROJECT_REF}"
DEV_REF="${DEV_REF:-YOUR_PROJECT_REF}"

# Pages projects in scope
APP_PROJECTS=(fvi-app fvi-app-staging)
MARKETING_PROJECTS=(fvi-marketing fvi-marketing-staging)

# Required env vars per app project (must be set on every Pages project that fronts the app)
REQUIRED_APP_VARS=(SUPABASE_URL SUPABASE_PROJECT_REF SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET)

# Engineering env vars (optional but recommended)
OPTIONAL_APP_VARS=(ENVIRONMENT COOKIE_PREFIX VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY SUPABASE_ANON_KEY)

# ─── Helpers ────────────────────────────────────────────────────────────────
section() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }
ok()      { printf "  \033[1;32mOK\033[0m   %s\n" "$*"; }
warn()    { printf "  \033[1;33mWARN\033[0m %s\n" "$*"; }
fail()    { printf "  \033[1;31mFAIL\033[0m %s\n" "$*"; }

api() {
  # api METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID$path"
  else
    curl -sS -X "$method" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID$path"
  fi
}

# ─── 1. List all Pages projects + custom domains ───────────────────────────
section "Pages projects + custom domains"

PROJECTS_JSON="$(api GET /pages/projects)"
printf "%-30s %-40s %s\n" "PROJECT" "PAGES DEV" "CUSTOM DOMAINS"
printf "%-30s %-40s %s\n" "-------" "---------" "--------------"

for row in $(printf '%s' "$PROJECTS_JSON" | python -c "
import json,sys
d=json.load(sys.stdin)
for p in d.get('result', []):
    print(f\"{p['name']}\t{p.get('subdomain','?')}\t{','.join(p.get('domains',[]))}\")
"); do
  name="${row%%	*}"
  rest="${row#*	}"
  subdomain="${rest%%	*}"
  domains="${rest#*	}"
  printf "%-30s %-40s %s\n" "$name" "$subdomain" "$domains"
done

# ─── 2. Verify each URL returns 2xx ────────────────────────────────────────
section "URL health check"

URL_EXIT=0
for URL in \
  https://app.reconiq.example \
  https://status.reconiq.example \
  https://staging.app.reconiq.example \
  https://dev.app.reconiq.example \
  https://reconiq.example \
  https://www.reconiq.example \
  https://staging-marketing.reconiq.example; do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -L --max-time 20 "$URL" || echo "ERR")
  if [[ "$CODE" =~ ^2 ]]; then
    ok "$CODE  $URL"
  else
    fail "$CODE  $URL"
    URL_EXIT=2
  fi
done

# ─── 3. Verify required env vars on each app Pages project ─────────────────
section "Required env vars per Pages project"

ENV_EXIT=0
for PROJ in "${APP_PROJECTS[@]}" "${MARKETING_PROJECTS[@]}"; do
  echo ""
  echo "  → $PROJ"

  ENV_JSON="$(api GET "/pages/projects/$PROJ/env-vars")"
  PROD_ENV_NAMES=$(printf '%s' "$ENV_JSON" | python -c "
import json,sys
d=json.load(sys.stdin)
prod = (d.get('result',{}) or {}).get('deployment_configs',{}) or {}
prod_env = (prod.get('production',{}) or {}).get('env_vars') or {}
print(' '.join(sorted(prod_env.keys())))
" 2>/dev/null || echo "")

  MISSING=()
  for V in "${REQUIRED_APP_VARS[@]}"; do
    if [[ " $PROD_ENV_NAMES " == *" $V "* ]]; then
      ok "    $V"
    else
      fail "    $V  (MISSING)"
      MISSING+=("$V")
    fi
  done

  # Optional keys - report but don't fail
  for V in "${OPTIONAL_APP_VARS[@]}"; do
    if [[ " $PROD_ENV_NAMES " == *" $V "* ]]; then
      ok "    $V  (optional)"
    else
      warn "    $V  (optional, not set)"
    fi
  done

  if [[ "${#MISSING[@]}" -gt 0 ]]; then
    ENV_EXIT=1
  fi
done

# ─── 4. Custom hostname summary ────────────────────────────────────────────
section "Custom hostname -> Supabase map"

printf "%-40s %-22s %-15s %s\n" "HOSTNAME" "PAGES PROJECT" "SUPABASE" "COOKIE PREFIX"
printf "%-40s %-22s %-15s %s\n" "--------" "-------------" "--------" "------------"

hostname_map() {
  local url="$1" pages="$2" supa="$3" cookie="$4"
  printf "%-40s %-22s %-15s %s\n" "$url" "$pages" "$supa" "$cookie"
}

hostname_map "app.reconiq.example"          "fvi-app"          "fvi-prod" "fvi_prod_"
hostname_map "status.reconiq.example"       "fvi-app"          "fvi-prod" "fvi_prod_"
hostname_map "staging.app.reconiq.example"  "fvi-app-staging"  "fvi-dev"  "fvi_dev_"
hostname_map "dev.app.reconiq.example"      "fvi-app-staging"  "fvi-dev"  "fvi_dev_"
hostname_map "reconiq.example"              "fvi-marketing"    "fvi-prod" "fvi_prod_"
hostname_map "www.reconiq.example"          "fvi-marketing"    "fvi-prod" "fvi_prod_"
hostname_map "staging-marketing.reconiq.example" "fvi-marketing-staging" "fvi-dev" "fvi_dev_"

# ─── 5. Summary ─────────────────────────────────────────────────────────────
section "Summary"

if [[ "$ENV_EXIT" -eq 0 ]]; then
  ok "All required env vars set on all 4 app/marketing Pages projects"
else
  fail "Some required env vars are missing (ENV_EXIT=1)"
fi

if [[ "$URL_EXIT" -eq 0 ]]; then
  ok "All 7 monitored URLs return 2xx"
else
  fail "Some URLs returned non-2xx (URL_EXIT=2)"
fi

# Combine exit codes
FINAL=$((ENV_EXIT + URL_EXIT))
case "$FINAL" in
  0) echo ""; ok "Setup looks healthy."; exit 0 ;;
  1) echo ""; fail "Env vars missing. See above. Fix and rerun."; exit 1 ;;
  2) echo ""; fail "URL health check failed. Investigate Pages deploy."; exit 2 ;;
  *) echo ""; fail "Both env vars and URL health failed."; exit 3 ;;
esac
