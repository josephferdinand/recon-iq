#!/usr/bin/env bash
# CI guard: disallow direct process.env access to secret-class names outside allow-listed bootstrap files.
# All new code should resolve secrets via the vault (src/lib/vault-resolver.server.ts).
set -euo pipefail

ALLOW='^(src/lib/vault\.server\.ts|src/lib/vault\.functions\.ts|src/lib/vault-resolver\.server\.ts|src/lib/crypto\.server\.ts|src/start\.ts|scripts/|tests/)'
PATTERN='process\.env\[?["'\'']?(LLM_TENANT_|LLM_PLATFORM_|GITHUB_DOCS_TOKEN|SLA_CRON_HMAC|AUDIT_SIGNING_KEY|APP_DATA_ENC_KEY)'

if command -v rg >/dev/null; then
  HITS=$(rg -n --no-heading -g '!node_modules' -g '*.ts' -g '*.tsx' "$PATTERN" src || true)
else
  HITS=$(grep -RnE --include='*.ts' --include='*.tsx' "$PATTERN" src || true)
fi

FAIL=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file="${line%%:*}"
  if ! echo "$file" | grep -Eq "$ALLOW"; then
    echo "❌ Unauthorized secret env access: $line"
    FAIL=1
  fi
done <<< "$HITS"

if [ "$FAIL" -eq 1 ]; then
  echo ""
  echo "Use vault-resolver.server.ts instead of process.env for secret values."
  exit 1
fi
echo "✅ Vault guard: no unauthorized process.env secret access."
