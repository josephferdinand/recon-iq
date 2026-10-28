#!/usr/bin/env bash
# auth-endpoint-health.sh — probe FVI auth-related endpoints via curl.
#
# Mirrors the verify-fvi.sh pattern. Exits non-zero if any URL returns 5xx
# or fails to connect. CF bot challenges (HTTP 403 with "Just a moment")
# are counted as blocked (LL-021), not as failure.
#
# Usage:
#   bash tests/auth/shell/auth-endpoint-health.sh

set -uo pipefail

MAX_TIME="${AUTH_PROBE_TIMEOUT:-30}"
APP_URL="${FVI_APP_URL:-https://app.reconiq.example}"
DEV_URL="${FVI_DEV_URL:-https://dev.app.reconiq.example}"

URLS=(
  "${APP_URL}/api/public/oauth/token"
  "${APP_URL}/api/public/scim/v2/Users"
  "${APP_URL}/api/public/scim/v2/ServiceProviderConfig"
  "${APP_URL}/api/public/security-event"
  "${DEV_URL}/auth"
  "${DEV_URL}/reset-password"
)

probe() {
  local url="$1"
  curl -sS -o /dev/null -w "%{http_code}" \
    --max-time "$MAX_TIME" \
    -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" \
    -H "accept: application/json" \
    "$url" 2>/dev/null || echo "000"
}

broken=0
edge=0
reachable=0

printf '\n\033[1;34m▶ FVI Auth-Endpoint Health\033[0m\n'
for url in "${URLS[@]}"; do
  code=$(probe "$url")
  printf '  %-72s -> HTTP %s\n' "$url" "$code"
  case "$code" in
    200|301|302|303|307|308)
      reachable=$((reachable + 1))
      ;;
    401|403|405)
      edge=$((edge + 1))  # auth-gated or bot challenge
      ;;
    000|5*)
      broken=$((broken + 1))
      ;;
  esac
done

printf '\n'
printf '  reachable: %d   edge-gated: %d   broken: %d\n' "$reachable" "$edge" "$broken"

if [[ "$broken" -gt 0 ]]; then
  printf '\033[1;31m✗ %d endpoint(s) broken\033[0m\n' "$broken"
  exit 1
fi
printf '\033[1;32m✓ All endpoints responded\033[0m\n'
exit 0