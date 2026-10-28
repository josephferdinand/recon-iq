CREATE OR REPLACE FUNCTION public.verify_audit_chain(_limit integer DEFAULT 10000)
 RETURNS TABLE(ok boolean, first_bad_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_prev bytea := null; v_expected bytea; v_payload text;
begin
  if auth.uid() is null or not public.is_platform_admin(auth.uid()) then
    raise exception 'Forbidden: platform_admin required' using errcode = '42501';
  end if;
  for r in (select * from public.audit_log order by id asc limit _limit) loop
    v_payload := coalesce(encode(v_prev,'hex'),'')||'|'||coalesce(r.actor_user_id::text,'')||'|'||
                 coalesce(r.tenant_id::text,'')||'|'||r.scope||'|'||r.action||'|'||
                 coalesce(r.resource_type,'')||'|'||coalesce(r.resource_id,'')||'|'||
                 coalesce(r.context::text,'{}')||'|'||r.occurred_at::text;
    v_expected := digest(v_payload, 'sha256');
    if v_expected <> r.row_hash or coalesce(r.prev_hash,''::bytea) <> coalesce(v_prev,''::bytea) then
      return query select false, r.id; return;
    end if;
    v_prev := r.row_hash;
  end loop;
  return query select true::boolean, null::bigint;
end; $function$;

REVOKE ALL ON FUNCTION public.verify_audit_chain(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain(integer) TO authenticated;