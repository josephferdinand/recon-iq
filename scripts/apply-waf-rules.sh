#!/usr/bin/env bash
# apply-waf-rules.sh — Apply cloudflare/waf-custom-rules.json to the FVI zone.
#
# Per LL-013 / LL-014 / LL-015: bash PATH-based invocation + printf pipe pattern.
# Cloudflare expects the entrypoint ruleset to exist for the
# http_request_firewall_custom phase before rules can be appended. The script:
#   1) reads the rules JSON
#   2) checks for an existing entrypoint ruleset
#   3) creates one if missing, then UPDATEs (append/replace rules)
#   4) prints the resulting ruleset id + rule count for audit
#
# Required env:
#   CLOUDFLARE_API_TOKEN   — token with WAF:Edit scope
#   ZONE_ID                — defaults to reconiq.example prod zone
#
# Usage:
#   CLOUDFLARE_API_TOKEN=cfut_... ZONE_ID=YOUR_CLOUDFLARE_ID \
#     bash scripts/apply-waf-rules.sh

set -euo pipefail

ZONE_ID="${ZONE_ID:-YOUR_CLOUDFLARE_ID}"
RULES_FILE="${RULES_FILE:-$(dirname "$0")/../cloudflare/waf-custom-rules.json}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required" >&2
  exit 2
fi

if [[ ! -f "$RULES_FILE" ]]; then
  echo "Rules file not found: $RULES_FILE" >&2
  exit 2
fi

API="https://api.cloudflare.com/client/v4"
PHASE="http_request_firewall_custom"

echo "phase=$PHASE zone=$ZONE_ID rules=$RULES_FILE"

# 1. Find or create the entrypoint ruleset.
echo ">> locating entrypoint ruleset..."
ENTRY=$(curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "${API}/zones/${ZONE_ID}/rulesets/phases/${PHASE}/entrypoint")

if echo "$ENTRY" | grep -q '"id"'; then
  RULESET_ID=$(printf '%s' "$ENTRY" | python -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
  echo ">> entrypoint ruleset exists: $RULESET_ID"
else
  echo ">> no entrypoint; creating one..."
  CREATED=$(curl -sS -X PUT \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"name":"FVI custom WAF","description":"Sprint 1 hardening — FVI custom WAF rules","rules":[]}' \
    "${API}/zones/${ZONE_ID}/rulesets/phases/${PHASE}/entrypoint")
  if ! echo "$CREATED" | grep -q '"success"[ ]*:[ ]*true'; then
    echo ">> failed to create entrypoint:" >&2
    printf '%s' "$CREATED" >&2
    exit 1
  fi
  RULESET_ID=$(printf '%s' "$CREATED" | python -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
  echo ">> created entrypoint ruleset: $RULESET_ID"
fi

# 2. Build the ruleset payload by stripping the $comment / $schema / phase / kind fields.
# (kind is only valid on POST create; PUT update infers it from the existing ruleset.)
PAYLOAD=$(python -c "
import json, sys
src = json.load(open(sys.argv[1]))
src.pop('\$comment', None); src.pop('\$schema', None); src.pop('phase', None); src.pop('kind', None)
src['name'] = 'FVI custom WAF'
src['description'] = 'Sprint 1 hardening - FVI custom WAF rules'
# Strip fields the ruleset PUT API rejects on per-rule entries.
# 'id' and 'version' are server-assigned on first PUT; presence confuses the
# API when no rule with that id exists yet.
for r in src.get('rules', []):
    r.pop('comment', None)
    r.pop('log', None)
    r.pop('id', None)
    r.pop('version', None)
print(json.dumps(src))
" "$RULES_FILE")

# 3. PUT to the ruleset (replaces existing rules with the supplied set).
echo ">> applying ${RULES_FILE} to ruleset $RULESET_ID..."
RESULT=$(printf '%s' "$PAYLOAD" | curl -sS -X PUT \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "${API}/zones/${ZONE_ID}/rulesets/${RULESET_ID}")

# 4. Audit summary.
if echo "$RESULT" | grep -q '"success"[ ]*:[ ]*true'; then
  RULE_COUNT=$(printf '%s' "$RESULT" | python -c "import sys,json; print(len(json.load(sys.stdin)['result']['rules']))")
  echo ">> ok: ${RULE_COUNT} rules active in ruleset ${RULESET_ID}"
  printf '%s' "$RESULT" | python -c "
import sys,json
r = json.load(sys.stdin)['result']
print('rules:')
for rule in r['rules']:
    print(f\"  - {rule.get('id'):32s} {rule.get('action'):20s} enabled={rule.get('enabled')}\")
"
else
  echo ">> FAILED" >&2
  printf '%s' "$RESULT" >&2
  exit 1
fi