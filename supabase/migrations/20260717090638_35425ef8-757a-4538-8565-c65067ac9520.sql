do $migration$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'revoke insert, update on public.marketplace_listings from sandbox_exec';
  else
    raise notice 'sandbox_exec role is not installed; skipping marketplace revoke';
  end if;
end
$migration$;
