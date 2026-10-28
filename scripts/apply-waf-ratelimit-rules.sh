#!/usr/bin/env bash
# apply-waf-ratelimit-rules.sh — Apply cloudflare/waf-ratelimit-rules.json (the
# rate-limit rules) to the FVI zone on a separate rate-limit ruleset.
#
# Cloudflare's ruleset API rejects rate-limit rules on the
# http_request_firewall_custom phase with kind=zone. The pattern that works is:
#   1) PUT a ruleset on http_ratelimit with ruleset type = zone, OR
#   2) PUT a ruleset on http_request_firewall_custom with kind=zone and only
#      non-rate-limit rules (handled by apply-waf-rules.sh).
# We use option (1) because rate-limit rules belong on the rate-limit phase.
#
# Required env: CLOUDFLARE_API_TOKEN, ZONE_ID (default: reconiq.example).

set -euo pipefail

ZONE_ID="${ZONE_ID:-YOUR_CLOUDFLARE_ID}"
RULES_FILE="${RULES_FILE:-$(dirname "$0")/../cloudflare/waf-ratelimit-rules.json}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required" >&2
  exit 2
fi

if [[ ! -f "$RULES_FILE" ]]; then
  echo "Rules file not found: $RULES_FILE" >&2
  exit 2
fi

API="https://api.cloudflare.com/client/v4"

echo "phase=http_ratelimit zone=$ZONE_ID rules=$RULES_FILE"

# Locate the existing entrypoint ruleset for http_ratelimit.
ENTRY=$(curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "${API}/zones/${ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint")

if echo "$ENTRY" | python -c "import sys,json; r=json.load(sys.stdin).get('result'); sys.exit(0 if r else 1)"; then
  RULESET_ID=$(printf '%s' "$ENTRY" | python -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
  echo ">> entrypoint ruleset exists: $RULESET_ID"
else
  echo ">> no entrypoint; creating one..."
  CREATED=$(curl -sS -X PUT \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"name":"FVI rate limit WAF","description":"Sprint 1 hardening - FVI rate-limit WAF rules","rules":[]}' \
    "${API}/zones/${ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint")
  RULESET_ID=$(printf '%s' "$CREATED" | python -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
  echo ">> created entrypoint ruleset: $RULESET_ID"
fi

# Build the ruleset payload by stripping CF-unfriendly fields.
PAYLOAD=$(python -c "
import json, sys
src = json.load(open(sys.argv[1]))
src.pop('\$comment', None); src.pop('\$schema', None); src.pop('phase', None)
src['name'] = 'FVI rate limit WAF'
src['description'] = 'Sprint 1 hardening - FVI rate-limit WAF rules'
for r in src.get('rules', []):
    r.pop('id', None); r.pop('version', None); r.pop('comment', None); r.pop('log', None)
print(json.dumps(src))
" "$RULES_FILE")

echo ">> applying ${RULES_FILE} to ruleset $RULESET_ID..."
RESULT=$(printf '%s' "$PAYLOAD" | curl -sS -X PUT \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "${API}/zones/${ZONE_ID}/rulesets/${RULESET_ID}")

if echo "$RESULT" | grep -q '"success"[ ]*:[ ]*true'; then
  RULE_COUNT=$(printf '%s' "$RESULT" | python -c "import sys,json; print(len(json.load(sys.stdin)['result']['rules']))")
  echo ">> ok: ${RULE_COUNT} rate-limit rules active in ruleset ${RULESET_ID}"
  printf '%s' "$RESULT" | python -c "
import sys,json
r = json.load(sys.stdin)['result']
for rule in r['rules']:
    rl = rule.get('ratelimit', {})
    print(f\"  - {rule['description'][:80]}  {rl.get('requests_per_period')}/{rl.get('period')}s\")
"
else
  echo ">> FAILED" >&2
  printf '%s' "$RESULT" >&2
  exit 1
fi