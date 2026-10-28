#!/usr/bin/env bash
# FVI — export the source Supabase database.
#
# Usage:
#   SOURCE_DB_URL="postgres://postgres:PASS@HOST:5432/postgres" \
#     bash scripts/migration/01-export-db.sh ./export
#
# Produces (in the output directory):
#   roles.sql        cluster roles (filtered)
#   schema.sql       full DDL for public + private + storage + auth
#   data.sql         data-only dump, disable-triggers
#   globals.txt      extension / sequence / cron inventory for verification
#
# Requires pg_dump >= 15 matching the server major version.

set -euo pipefail

OUT="${1:-./export}"
: "${SOURCE_DB_URL:?SOURCE_DB_URL must be set}"

mkdir -p "$OUT"
echo "==> Output: $OUT"

echo "==> Verifying client/server version parity"
psql "$SOURCE_DB_URL" -Atc "select version()"
pg_dump --version

echo "==> 1/5 roles"
pg_dumpall --dbname="$SOURCE_DB_URL" --roles-only --no-role-passwords \
  | grep -Ev '^(CREATE|ALTER) ROLE (postgres|rds_|cloudsql|supabase_admin)\b' \
  > "$OUT/roles.sql" || true

echo "==> 2/5 schema (DDL)"
pg_dump "$SOURCE_DB_URL" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=private \
  --schema=auth \
  --schema=storage \
  --file="$OUT/schema.sql"

echo "==> 3/5 data"
pg_dump "$SOURCE_DB_URL" \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  --column-inserts=false \
  --schema=public \
  --schema=private \
  --schema=auth \
  --schema=storage \
  --file="$OUT/data.sql"

echo "==> 4/5 grants + policies (captured separately for diffing)"
pg_dump "$SOURCE_DB_URL" --schema-only --schema=public \
  | grep -E '^(GRANT|REVOKE|CREATE POLICY|ALTER TABLE .* ENABLE ROW LEVEL SECURITY)' \
  > "$OUT/grants-policies.sql"

echo "==> 5/5 inventory snapshot"
psql "$SOURCE_DB_URL" -At -F'|' > "$OUT/globals.txt" <<'SQL'
select 'extension', extname, extversion from pg_extension order by extname;
select 'table_count', count(*)::text, '' from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE';
select 'policy_count', count(*)::text, '' from pg_policies where schemaname='public';
select 'index_count', count(*)::text, '' from pg_indexes where schemaname='public';
select 'function_count', count(*)::text, '' from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';
select 'trigger_count', count(*)::text, '' from pg_trigger where not tgisinternal;
select 'fk_count', count(*)::text, '' from pg_constraint where contype='f';
select 'cron_job', jobid::text, schedule from cron.job order by jobid;
select 'bucket', id, case when public then 'public' else 'private' end from storage.buckets order by id;
select 'rowcount', relname, n_live_tup::text from pg_stat_user_tables
  where schemaname='public' order by relname;
SQL

echo "==> Export complete."
ls -lh "$OUT"
echo
echo "REMINDER: supabase_vault secrets are NOT exportable in plaintext."
echo "Re-provision every vault entry on the target — see docs/migration/06-database.md."
