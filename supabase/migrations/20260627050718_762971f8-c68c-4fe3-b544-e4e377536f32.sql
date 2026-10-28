
-- Set search_path on the small helpers we missed
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.audit_log_block_mutation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin raise exception 'audit_log is append-only'; end; $$;

-- Lock down SECURITY DEFINER helpers: revoke from anon/public
revoke execute on function public.has_platform_role(uuid, public.platform_role) from public, anon;
revoke execute on function public.is_platform_admin(uuid) from public, anon;
revoke execute on function public.is_tenant_member(uuid, uuid) from public, anon;
revoke execute on function public.has_tenant_role(uuid, uuid, public.tenant_role) from public, anon;
revoke execute on function public.verify_audit_chain(int) from public, anon;
-- handle_new_user / audit_log_chain are trigger-only; revoke too
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.audit_log_chain() from public, anon;

grant execute on function public.has_platform_role(uuid, public.platform_role) to authenticated;
grant execute on function public.is_platform_admin(uuid) to authenticated;
grant execute on function public.is_tenant_member(uuid, uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid, uuid, public.tenant_role) to authenticated;
grant execute on function public.verify_audit_chain(int) to authenticated;

-- Tighten audit insert: actor must equal auth.uid() (or NULL — trigger will fill)
drop policy if exists "Authenticated insert audit" on public.audit_log;
create policy "Authenticated insert audit" on public.audit_log for insert to authenticated
  with check (actor_user_id is null or actor_user_id = auth.uid());

-- Move pgcrypto and citext out of public into the dedicated `extensions` schema
create schema if not exists extensions;
grant usage on schema extensions to authenticated, anon, service_role;
alter extension pgcrypto set schema extensions;
alter extension citext set schema extensions;
-- Ensure functions referencing digest() still resolve
alter database postgres set search_path = "$user", public, extensions;
