-- Final-state privilege repair for clean-room replay and live environments.
-- Later table alterations can reapply Supabase default grants, so this
-- migration deliberately runs after all historical DDL.

revoke all on table public.email_send_log, public.suppressed_emails
  from public, anon, authenticated;
grant all on table public.email_send_log, public.suppressed_emails
  to service_role;

revoke all on table public.github_sync_settings, public.github_sync_change_requests
  from public, anon, authenticated;
grant select on table public.github_sync_settings to authenticated;
grant select, insert, update on table public.github_sync_change_requests to authenticated;
grant all on table public.github_sync_settings, public.github_sync_change_requests
  to service_role;

alter table public.audit_chain_head enable row level security;
drop policy if exists audit_chain_head_deny_clients on public.audit_chain_head;
create policy audit_chain_head_deny_clients
  on public.audit_chain_head
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.audit_chain_head
  from public, anon, authenticated, service_role;
grant select on table public.audit_chain_head to service_role;

-- Canonicalize the manually created keepalive table. The pg_cron writer runs
-- as the database owner and therefore remains functional with client RLS.
create table if not exists public.heartbeat (
  service text primary key,
  last_ping_at timestamptz not null default now()
);
alter table public.heartbeat enable row level security;
drop policy if exists heartbeat_deny_clients on public.heartbeat;
create policy heartbeat_deny_clients
  on public.heartbeat
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
revoke all on table public.heartbeat
  from public, anon, authenticated, service_role;
grant select on table public.heartbeat to service_role;

-- The UI may invoke the verifiers, but each SECURITY DEFINER function performs
-- a fresh platform-admin check before reading the chain.
revoke execute on function public.verify_audit_chain(integer)
  from public, anon;
grant execute on function public.verify_audit_chain(integer)
  to authenticated, service_role;
revoke execute on function public.audit_chain_integrity_status(integer)
  from public, anon;
grant execute on function public.audit_chain_integrity_status(integer)
  to authenticated, service_role;
