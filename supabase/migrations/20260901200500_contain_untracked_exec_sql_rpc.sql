-- Emergency containment for an untracked live debug RPC discovered on PROD.
-- Keep the function available to service_role for bounded compatibility while
-- removing all client-callable execution paths. A later owner-reviewed change
-- may drop it after downstream consumer evidence is complete.

begin;

do $contain$
begin
  if to_regprocedure('public.exec_sql(text)') is not null then
    execute 'revoke all on function public.exec_sql(text) from public, anon, authenticated';
    execute 'grant execute on function public.exec_sql(text) to service_role';
  end if;
end
$contain$;

commit;
