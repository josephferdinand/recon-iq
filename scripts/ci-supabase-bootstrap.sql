-- Minimal Supabase Auth compatibility for the standalone Postgres image used
-- by CI. Managed Supabase already provides these helpers; this file is never
-- applied to PROD or DEV.
create or replace function auth.jwt()
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$function$;

revoke execute on function auth.jwt() from public;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- The standalone CI image carries an older minimal storage.buckets shape than
-- managed Supabase. Add only the managed columns used by repository migrations;
-- this compatibility shim is never applied to PROD or DEV.
alter table if exists storage.buckets
  add column if not exists public boolean not null default false,
  add column if not exists file_size_limit bigint,
  add column if not exists allowed_mime_types text[];
