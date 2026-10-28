do $migration$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'grant insert, update on public.marketplace_listings to sandbox_exec';
  else
    raise notice 'sandbox_exec role is not installed; skipping marketplace grant';
  end if;
end
$migration$;
