-- Serialize future audit inserts through an explicit chain head and verify the
-- historical structure as a cryptographic parent graph. This preserves the
-- immutable 2026-08-22 concurrency fork instead of rewriting evidence.

create table if not exists public.audit_chain_head (
  singleton boolean primary key default true check (singleton),
  last_audit_id bigint,
  last_hash bytea,
  updated_at timestamptz not null default now()
);

revoke all on table public.audit_chain_head from public, anon, authenticated;
grant select on table public.audit_chain_head to service_role;

insert into public.audit_chain_head (singleton, last_audit_id, last_hash, updated_at)
select true, id, row_hash, now()
from public.audit_log
order by id desc
limit 1
on conflict (singleton) do update
set last_audit_id = excluded.last_audit_id,
    last_hash = excluded.last_hash,
    updated_at = excluded.updated_at;

insert into public.audit_chain_head (singleton, last_audit_id, last_hash)
values (true, null, null)
on conflict (singleton) do nothing;

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
  select last_hash into v_prev
  from public.audit_chain_head
  where singleton = true
  for update;

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

  update public.audit_chain_head
  set last_audit_id = new.id,
      last_hash = new.row_hash,
      updated_at = now()
  where singleton = true;

  return new;
end
$function$;

-- Legacy contract: `ok` now means every row hash is valid and every non-null
-- parent hash resolves to an earlier row. A separate detailed function reports
-- forks so callers do not confuse graph integrity with strict linearity.
create or replace function public.verify_audit_chain(_limit int default 10000)
returns table (ok boolean, first_bad_id bigint)
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  r record;
  v_expected bytea;
  v_payload text;
begin
  if auth.uid() is null or not public.is_platform_admin(auth.uid()) then
    raise exception 'Forbidden: platform_admin required' using errcode = '42501';
  end if;

  for r in select * from public.audit_log order by id asc limit _limit loop
    if r.prev_hash is not null and not exists (
      select 1 from public.audit_log p where p.id <> r.id and p.row_hash = r.prev_hash
    ) then
      return query select false, r.id;
      return;
    end if;

    v_payload := coalesce(encode(r.prev_hash,'hex'),'') || '|' ||
                 coalesce(r.actor_user_id::text,'') || '|' ||
                 coalesce(r.tenant_id::text,'') || '|' || r.scope || '|' || r.action || '|' ||
                 coalesce(r.resource_type,'') || '|' || coalesce(r.resource_id,'') || '|' ||
                 coalesce(r.context::text,'{}') || '|' || r.occurred_at::text;
    v_expected := digest(v_payload, 'sha256');
    if v_expected <> r.row_hash then
      return query select false, r.id;
      return;
    end if;
  end loop;

  return query select true::boolean, null::bigint;
end
$function$;

create or replace function public.audit_chain_integrity_status(_limit int default 10000)
returns table (
  ok boolean,
  first_bad_id bigint,
  fork_count bigint,
  orphan_count bigint,
  head_matches_latest boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $function$
declare
  v_ok boolean;
  v_first_bad bigint;
  v_forks bigint;
  v_orphans bigint;
  v_head_matches boolean;
begin
  if auth.uid() is null or not public.is_platform_admin(auth.uid()) then
    raise exception 'Forbidden: platform_admin required' using errcode = '42501';
  end if;

  select v.ok, v.first_bad_id into v_ok, v_first_bad
  from public.verify_audit_chain(_limit) v;

  with bounded as (
    select * from public.audit_log order by id asc limit _limit
  )
  select count(*) into v_forks from (
    select prev_hash from bounded where prev_hash is not null
    group by prev_hash having count(*) > 1
  ) f;

  with bounded as (
    select * from public.audit_log order by id asc limit _limit
  ), recomputed as (
    select b.id,
      digest(
        coalesce(encode(b.prev_hash,'hex'),'') || '|' ||
        coalesce(b.actor_user_id::text,'') || '|' ||
        coalesce(b.tenant_id::text,'') || '|' || b.scope || '|' || b.action || '|' ||
        coalesce(b.resource_type,'') || '|' || coalesce(b.resource_id,'') || '|' ||
        coalesce(b.context::text,'{}') || '|' || b.occurred_at::text,
        'sha256'
      ) as expected_hash,
      b.row_hash,
      b.prev_hash,
      exists(select 1 from public.audit_log p where p.id <> b.id and p.row_hash=b.prev_hash) as parent_exists
    from bounded b
  )
  select count(*) into v_orphans
  from recomputed
  where expected_hash <> row_hash or (prev_hash is not null and not parent_exists);

  select h.last_hash = l.row_hash and h.last_audit_id = l.id
    into v_head_matches
  from public.audit_chain_head h
  left join lateral (select id,row_hash from public.audit_log order by id desc limit 1) l on true
  where h.singleton=true;

  return query select v_ok, v_first_bad, v_forks, v_orphans, coalesce(v_head_matches,false);
end
$function$;

revoke execute on function public.audit_log_chain() from public, anon, authenticated;
revoke execute on function public.verify_audit_chain(integer) from public, anon;
grant execute on function public.verify_audit_chain(integer) to authenticated, service_role;
revoke execute on function public.audit_chain_integrity_status(integer) from public, anon;
grant execute on function public.audit_chain_integrity_status(integer) to authenticated, service_role;
