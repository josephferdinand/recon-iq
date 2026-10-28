#!/usr/bin/env bash
# verify-fvi.sh — Curl all FVI production / staging / dev URLs and report HTTP status.
#
# Exits 0 if all URLs return HTTP 200.
# Exits 1 if any URL returns non-200 (or fails to connect).
#
# Usage:
#   bash scripts/verify-fvi.sh

set -uo pipefail

PROD_URLS=(
  "https://app.reconiq.example/"
  "https://reconiq.example/"
  "https://www.reconiq.example/"
  "https://status.reconiq.example/"
)

STAGING_URLS=(
  "https://staging-app.reconiq.example/"
  "https://staging-marketing.reconiq.example/"
)

DEV_URLS=(
  "http://localhost:5173/"
)

MAX_TIME="${VERIFY_TIMEOUT:-30}"

check_url() {
  local url="$1"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time "$MAX_TIME" "$url" 2>/dev/null || echo "000")
  printf '%-50s -> HTTP %s\n' "$url" "$code"
  if [[ "$code" == "200" ]]; then
    return 0
  else
    return 1
  fi
}

failed=0

printf '\n\033[1;34m▶ Production URLs\033[0m\n'
for url in "${PROD_URLS[@]}"; do
  if ! check_url "$url"; then
    failed=$((failed + 1))
  fi
done

printf '\n\033[1;34m▶ Staging URLs\033[0m\n'
for url in "${STAGING_URLS[@]}"; do
  if ! check_url "$url"; then
    failed=$((failed + 1))
  fi
done

printf '\n\033[1;34m▶ Dev URLs\033[0m\n'
for url in "${DEV_URLS[@]}"; do
  if ! check_url "$url"; then
    failed=$((failed + 1))
  fi
done

printf '\n'
if [[ "$failed" -eq 0 ]]; then
  printf '\033[1;32m✓ All URLs returned HTTP 200\033[0m\n'
  exit 0
else
  printf '\033[1;31m✗ %d URL(s) failed\033[0m\n' "$failed"
  exit 1
fi
