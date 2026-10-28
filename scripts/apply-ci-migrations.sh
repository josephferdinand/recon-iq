#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 -f scripts/ci-supabase-bootstrap.sql
psql -v ON_ERROR_STOP=1 -f tests/sql/tenant-email-domain-auth-compat.sql

for migration in $(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort); do
  if [[ $(basename "$migration") == "20260925092000_require_tenant_email_domain_cutover.sql" ]]; then
    psql -v ON_ERROR_STOP=1 -f tests/sql/tenant-email-domain-precutover-compat.sql
  fi
  echo "Applying $migration"
  psql -v ON_ERROR_STOP=1 -f "$migration"
done
