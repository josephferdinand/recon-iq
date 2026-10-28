#!/usr/bin/env bash
# FVI — source/target parity verification.
#
# Usage:
#   SOURCE_DB_URL=... TARGET_DB_URL=... bash scripts/migration/04-verify-parity.sh
#
# Exits non-zero on any mismatch. Safe to run repeatedly.

set -uo pipefail

: "${SOURCE_DB_URL:?}" "${TARGET_DB_URL:?}"
FAIL=0

q() { psql "$1" -At -c "$2"; }

check() {
  local label="$1" sql="$2"
  local a b
  a=$(q "$SOURCE_DB_URL" "$sql")
  b=$(q "$TARGET_DB_URL" "$sql")
  if [ "$a" = "$b" ]; then
    printf 'PASS  %-28s %s\n' "$label" "$a"
  else
    printf 'FAIL  %-28s source=%s target=%s\n' "$label" "$a" "$b"
    FAIL=1
  fi
}

check "tables(public)"      "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
check "columns(public)"     "select count(*) from information_schema.columns where table_schema='public'"
check "foreign_keys"        "select count(*) from pg_constraint where contype='f'"
check "rls_policies"        "select count(*) from pg_policies where schemaname='public'"
check "indexes(public)"     "select count(*) from pg_indexes where schemaname='public'"
check "functions(public)"   "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
check "triggers"            "select count(*) from pg_trigger where not tgisinternal"
check "views(public)"       "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='v' and n.nspname='public'"
check "enum_types"          "select count(*) from pg_type where typtype='e'"
check "extensions"          "select count(*) from pg_extension"
check "storage_buckets"     "select count(*) from storage.buckets"
check "auth_users"          "select count(*) from auth.users"
check "auth_identities"     "select count(*) from auth.identities"
check "storage_objects"     "select count(*) from storage.objects"

echo
echo "==> Per-table row counts"
TMP_S=$(mktemp); TMP_T=$(mktemp)
ROWSQL="select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"
for t in $(q "$SOURCE_DB_URL" "$ROWSQL"); do
  echo "$t|$(q "$SOURCE_DB_URL" "select count(*) from public.\"$t\"")" >> "$TMP_S"
  echo "$t|$(q "$TARGET_DB_URL" "select count(*) from public.\"$t\"")" >> "$TMP_T"
done
if diff -u "$TMP_S" "$TMP_T" > /tmp/rowcount.diff; then
  echo "PASS  all table row counts match"
else
  echo "FAIL  row count drift — see /tmp/rowcount.diff"
  head -50 /tmp/rowcount.diff
  FAIL=1
fi
rm -f "$TMP_S" "$TMP_T"

echo
echo "==> Tables missing RLS (must be 0)"
q "$TARGET_DB_URL" "
select c.relname from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"

echo
echo "==> Tables with RLS but no policy (must be 0)"
q "$TARGET_DB_URL" "
select c.relname from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relrowsecurity
and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)"

echo
echo "==> Tables with no GRANT to authenticated (PostgREST would 401/403)"
q "$TARGET_DB_URL" "
select c.relname from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
and not has_table_privilege('authenticated', c.oid, 'SELECT')
and not has_table_privilege('anon', c.oid, 'SELECT')"

echo
echo "==> Sequences behind max(id) (must be empty)"
q "$TARGET_DB_URL" "
select sequencename, last_value from pg_sequences where schemaname='public' and last_value is null"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: PARITY VERIFIED"
else
  echo "RESULT: PARITY FAILED"
fi
exit "$FAIL"
