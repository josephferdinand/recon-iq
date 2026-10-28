#!/usr/bin/env bash
# warm-cache.sh — Hit every production URL once after a deploy so Cloudflare
# warms the edge cache with the freshly-deployed HTML. Combined with the
# Cache-Control: no-cache, no-store, must-revalidate header set in
# src/start.ts (LL-053), this eliminates the failure mode where a stale
# browser session kept serving the "didn't load" page from a previous
# broken build even after the upstream had been fixed.
#
# Run automatically at the end of deploy-fvi.sh. Safe to invoke manually:
#   bash scripts/warm-cache.sh
#
# Exit code: 0 on full success, 1 if any URL still serves the broken
# error page after warm-up. Warnings (non-200 responses) are non-fatal.

set -uo pipefail

# Canonical prod URLs — keep in sync with deploy-fvi.sh PROD_URLS.
URLS=(
  "https://app.reconiq.example/"
  "https://reconiq.example/"
  "https://www.reconiq.example/"
  "https://status.reconiq.example/"
)

DIDNT_LOAD_MARKER="didn't load"
FVI_MARKER="ReconIQ"

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

step "Warming ${#URLS[@]} production URLs"
fails=0
for url in "${URLS[@]}"; do
  # Two hits per URL: first to populate edge, second to confirm stable.
  body1=$(curl -sS --max-time 30 -A "FVI-WarmCache/1.0" "$url" 2>/dev/null || true)
  body2=$(curl -sS --max-time 30 -A "FVI-WarmCache/1.0" "$url" 2>/dev/null || true)
  status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 30 "$url" 2>/dev/null || echo "ERR")
  has_didnt=$(printf '%s' "$body2" | grep -c "$DIDNT_LOAD_MARKER" || true)
  has_fvi=$(printf '%s' "$body2" | grep -c "$FVI_MARKER" || true)
  if [[ "$status" == "200" && "$has_didnt" -eq 0 && "$has_fvi" -ge 1 ]]; then
    ok "$url -> HTTP $status, FVI content present"
  else
    warn "$url -> HTTP $status, didn't_load=$has_didnt, fvi_mentions=$has_fvi"
    fails=$((fails + 1))
  fi
done

if [[ "$fails" -gt 0 ]]; then
  fail "warm-cache: $fails URL(s) still serving broken content — investigate before reporting deploy complete"
  exit 1
fi

step "warm-cache complete"
ok "All ${#URLS[@]} URLs serve fresh FVI content"