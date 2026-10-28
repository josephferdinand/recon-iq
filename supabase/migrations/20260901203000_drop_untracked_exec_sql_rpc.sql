-- Remove the untracked arbitrary-SQL debug RPC after emergency privilege
-- containment, repository-consumer search, and live dependency readback all
-- confirmed that it is not an application or Supabase-managed dependency.

begin;

do $drop_debug_rpc$
begin
  if to_regprocedure('public.exec_sql(text)') is not null then
    execute 'revoke all on function public.exec_sql(text) from public, anon, authenticated, service_role';
    execute 'drop function public.exec_sql(text)';
  end if;
end
$drop_debug_rpc$;

commit;
