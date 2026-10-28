create or replace function public.list_unprotected_tables()
returns table(schema text, name text)
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select n.nspname::text, c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname = 'public'
    and (not c.relrowsecurity
         or not exists (
           select 1 from pg_policies p
           where p.schemaname = n.nspname
             and p.tablename = c.relname
         ));
$$;

revoke execute on function public.list_unprotected_tables() from public, anon, authenticated;
grant execute on function public.list_unprotected_tables() to service_role;