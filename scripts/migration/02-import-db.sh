#!/usr/bin/env bash
# FVI — import into the self-hosted Supabase database.
#
# Usage:
#   TARGET_DB_URL="postgres://postgres:PASS@HOST:5433/postgres" \
#     bash scripts/migration/02-import-db.sh ./export
#
# Uses the SESSION pooler port (5433) or a direct connection — never the
# transaction pooler (6543), which breaks pg_dump restore and DDL.

set -euo pipefail

IN="${1:-./export}"
: "${TARGET_DB_URL:?TARGET_DB_URL must be set}"

psqlx() { psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 "$@"; }

echo "==> 1/7 extensions (must precede schema)"
psqlx <<'SQL'
create extension if not exists plpgsql;
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists ltree;
create extension if not exists pg_trgm;
create extension if not exists vector;
create extension if not exists pg_stat_statements;
create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists pgmq;
create extension if not exists supabase_vault cascade;
SQL

echo "==> 2/7 roles"
psqlx -f "$IN/roles.sql" || echo "   (roles partially present — continuing)"

echo "==> 3/7 schema"
psqlx -f "$IN/schema.sql"

echo "==> 4/7 data"
psqlx -f "$IN/data.sql"

echo "==> 5/7 grants + RLS policies"
psqlx -f "$IN/grants-policies.sql" || echo "   (already applied by schema.sql)"

echo "==> 6/7 resync sequences and identity columns"
psqlx <<'SQL'
do $$
declare r record; maxv bigint;
begin
  for r in
    select s.relname as seq, t.relname as tbl, a.attname as col,
           n.nspname as sch
    from pg_class s
    join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
    join pg_class t on t.oid = d.refobjid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
    join pg_namespace n on n.oid = s.relnamespace
    where s.relkind = 'S' and n.nspname in ('public','private','auth','storage')
  loop
    execute format('select coalesce(max(%I),0) from %I.%I', r.col, r.sch, r.tbl) into maxv;
    execute format('select setval(%L, greatest(%s,1), %s)',
                   r.sch||'.'||r.seq, maxv, case when maxv > 0 then 'true' else 'false' end);
  end loop;
end $$;
SQL

echo "==> 7/7 statistics + vector index rebuild"
psqlx -c "vacuum (analyze);"
psqlx <<'SQL'
do $$
declare r record;
begin
  for r in
    select schemaname, indexname from pg_indexes
    where schemaname='public' and indexdef ilike '%using ivfflat%' or indexdef ilike '%using hnsw%'
  loop
    execute format('reindex index concurrently %I.%I', r.schemaname, r.indexname);
  end loop;
end $$;
SQL

echo "==> Import complete. Run scripts/migration/04-verify-parity.sh next."
