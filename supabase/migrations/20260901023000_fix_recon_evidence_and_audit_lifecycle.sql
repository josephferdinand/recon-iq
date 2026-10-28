-- Repair evidence-pack schema drift and make append-only audit identifiers
-- historical references rather than deletion-blocking foreign keys.

-- The original generator used `definition_id`; the live table column is
-- `recon_definition_id`. Patch the canonical function definition in place so
-- this migration remains small while still applying cleanly after the source
-- migration on a fresh database.
do $migration$
declare
  function_ddl text;
  fixed_ddl text;
begin
  select pg_get_functiondef('public.generate_recon_run_evidence_pack(uuid)'::regprocedure)
    into function_ddl;
  if position('WHERE definition_id = v_def.id' in function_ddl) > 0 then
    fixed_ddl := replace(
      function_ddl,
      'WHERE definition_id = v_def.id',
      'WHERE recon_definition_id = v_def.id'
    );
    execute fixed_ddl;
  elsif position('WHERE recon_definition_id = v_def.id' in function_ddl) = 0 then
    raise exception 'Unexpected generate_recon_run_evidence_pack definition';
  end if;
end
$migration$;

alter function public.generate_recon_run_evidence_pack(uuid)
  set search_path = public, extensions;
alter function public.verify_recon_evidence_chain(uuid)
  set search_path = public, extensions;

-- Updating audit identifiers during tenant/user deletion would invalidate the
-- row hash. Keep the original UUID values as historical evidence instead of
-- forcing a live FK or ON DELETE mutation.
alter table public.audit_log
  drop constraint if exists audit_log_tenant_id_fkey;
alter table public.audit_log
  drop constraint if exists audit_log_actor_user_id_fkey;

comment on column public.audit_log.tenant_id is
  'Historical tenant identifier retained after tenant deletion; intentionally not a foreign key.';
comment on column public.audit_log.actor_user_id is
  'Historical actor identifier retained after user deletion; intentionally not a foreign key.';

-- Authenticated inserts must always be attributed to the JWT subject and may
-- only name a tenant the caller can access. Trusted service/system callers may
-- supply an explicit historical actor.
create or replace function public.audit_log_chain()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_prev bytea;
  v_payload text;
  v_session_role text;
  v_system_action boolean;
begin
  select row_hash into v_prev from public.audit_log order by id desc limit 1;
  new.prev_hash := v_prev;
  v_session_role := current_setting('role', true);

  if v_session_role = 'authenticated' then
    if auth.uid() is null then
      raise exception 'audit_log: authenticated actor is missing'
        using errcode = 'check_violation';
    end if;
    new.actor_user_id := auth.uid();
    if new.tenant_id is not null
       and not public.is_tenant_member(auth.uid(), new.tenant_id)
       and not public.is_platform_admin(auth.uid()) then
      raise exception 'audit_log: tenant attribution is not authorized'
        using errcode = 'insufficient_privilege';
    end if;
  else
    new.actor_user_id := coalesce(new.actor_user_id, auth.uid());
  end if;

  v_system_action := (
    new.actor_user_id is not null
    or v_session_role in ('service_role', 'postgres')
    or new.scope = 'system'
    or new.action like 'cron.%'
    or new.action like 'webhook.%'
    or new.action like 'system.%'
    or new.action like 'scim.%'
    or new.action like 'retention.%'
    or new.action like 'backup.%'
    or new.action like 'recon.evidence_pack.%'
  );
  if not v_system_action then
    raise exception 'audit_log: actor_user_id required for non-system action "%" (scope=%)', new.action, new.scope
      using errcode = 'check_violation';
  end if;

  v_payload := coalesce(encode(v_prev,'hex'),'') || '|' ||
               coalesce(new.actor_user_id::text,'') || '|' ||
               coalesce(new.tenant_id::text,'') || '|' || new.scope || '|' || new.action || '|' ||
               coalesce(new.resource_type,'') || '|' || coalesce(new.resource_id,'') || '|' ||
               coalesce(new.context::text,'{}') || '|' || new.occurred_at::text;
  new.row_hash := digest(v_payload, 'sha256');
  return new;
end
$function$;

drop policy if exists "Authenticated insert audit" on public.audit_log;
create policy "Authenticated insert own authorized audit"
  on public.audit_log for insert to authenticated
  with check (
    actor_user_id = auth.uid()
    and (
      tenant_id is null
      or public.is_tenant_member(auth.uid(), tenant_id)
      or public.is_platform_admin(auth.uid())
    )
  );

revoke execute on function public.audit_log_chain() from public, anon, authenticated;
