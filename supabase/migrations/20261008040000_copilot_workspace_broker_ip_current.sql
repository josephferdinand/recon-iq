-- SOURCE IMPLEMENTATION. Appended to generated exact current dependency guard.
-- No existing RLS/table/function grants are widened or replaced.
CREATE TABLE private.copilot_broker_dispatch_receipts (
  reservation_id text PRIMARY KEY REFERENCES public.copilot_spend_reservations(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  tenant_id uuid,
  thread_id uuid NOT NULL REFERENCES public.copilot_threads(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  price_id uuid NOT NULL,
  caller_kind text NOT NULL CHECK(caller_kind='service_role'),
  verified_aal text NOT NULL CHECK(verified_aal IN ('aal1','aal2')),
  purpose text NOT NULL CHECK(purpose='copilot_reserved_dispatch'),
  leased_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.copilot_broker_dispatch_receipts OWNER TO postgres;
ALTER TABLE private.copilot_broker_dispatch_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.copilot_broker_dispatch_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.copilot_broker_receipt_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'copilot.broker_receipt_immutable'; END
$immutable$;
ALTER FUNCTION private.copilot_broker_receipt_immutable() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.copilot_broker_receipt_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER copilot_broker_receipt_immutable BEFORE UPDATE OR DELETE
ON private.copilot_broker_dispatch_receipts FOR EACH ROW EXECUTE FUNCTION private.copilot_broker_receipt_immutable();

CREATE FUNCTION private.copilot_broker_authorize(
 _verified_actor uuid,_verified_aal text,_verified_expires_at timestamptz,
 _tenant_id uuid,_scope public.copilot_scope,_thread_id uuid,_request_ip text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $authorize$
DECLARE p public.platform_ai_settings%ROWTYPE; t public.tenant_ai_settings%ROWTYPE;
  s public.tenant_security_settings%ROWTYPE; th public.copilot_threads%ROWTYPE;
  entitled boolean; entitlement_count bigint; mode_write boolean := false; permitted_models text[];
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role'
   OR _verified_actor IS NULL OR _verified_aal IS NULL OR _verified_aal NOT IN ('aal1','aal2')
   OR _verified_expires_at IS NULL OR _verified_expires_at<=clock_timestamp()
   THEN RAISE EXCEPTION 'copilot.verified_subject_required'; END IF;
 -- Service identity remains explicit. Use the native peer-safe lifecycle predicate
 -- with the verified real actor; never set auth.uid/JWT claims to impersonate it.
 IF private.rlnext_account_allowed(_verified_actor,NULL) IS DISTINCT FROM true
   OR private.rlnext_account_allowed(_verified_actor,_tenant_id) IS DISTINCT FROM true
   THEN RAISE EXCEPTION 'copilot.account_denied'; END IF;
 -- The native peer predicate deliberately does not read a peer's JWT AAL.
 -- Preserve the real upstream verified claim separately for managed MFA requirements.
 IF _verified_aal<>'aal2' AND EXISTS(SELECT 1 FROM private.rlnext_accounts a
   WHERE a.user_id=_verified_actor AND a.mfa_required)
   THEN RAISE EXCEPTION 'copilot.mfa_required'; END IF;
 IF _scope IS NULL OR ((_scope='platform') IS DISTINCT FROM (_tenant_id IS NULL))
   THEN RAISE EXCEPTION 'copilot.scope_denied'; END IF;
 IF _tenant_id IS NULL THEN
   IF _verified_aal<>'aal2' OR (NOT coalesce(private.is_platform_admin(_verified_actor),false)
      AND NOT coalesce(private.is_platform_super_admin(_verified_actor),false))
     THEN RAISE EXCEPTION 'copilot.scope_denied'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant_id
      AND tm.user_id=_verified_actor AND tm.active)
      OR NOT EXISTS(SELECT 1 FROM public.tenants tn WHERE tn.id=_tenant_id AND tn.ai_enabled)
      THEN RAISE EXCEPTION 'copilot.scope_denied'; END IF;
   SELECT * INTO s FROM public.tenant_security_settings WHERE tenant_id=_tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'copilot.policy_unavailable'; END IF;
   IF s.mfa_required AND _verified_aal<>'aal2' THEN RAISE EXCEPTION 'copilot.mfa_required'; END IF;
   IF s.ip_allowlist_enabled AND NOT coalesce(public.ip_in_tenant_allowlist(_tenant_id,_request_ip),false)
      THEN RAISE EXCEPTION 'copilot.ip_denied'; END IF;
   SELECT count(*),bool_and(allowed) INTO entitlement_count,entitled FROM public.tenant_feature_entitlements
     WHERE tenant_id=_tenant_id AND feature_key='copilot';
   IF entitlement_count<>1 OR entitled IS DISTINCT FROM true THEN RAISE EXCEPTION 'copilot.entitlement_denied'; END IF;
 END IF;
 IF _thread_id IS NOT NULL THEN
   SELECT * INTO th FROM public.copilot_threads WHERE id=_thread_id;
   IF NOT FOUND OR th.user_id IS DISTINCT FROM _verified_actor OR th.tenant_id IS DISTINCT FROM _tenant_id
      OR th.scope IS DISTINCT FROM _scope THEN RAISE EXCEPTION 'copilot.owned_thread_required'; END IF;
 END IF;
 SELECT * INTO p FROM public.platform_ai_settings WHERE id=true;
 IF NOT FOUND OR p.ai_enabled IS DISTINCT FROM true OR p.allow_copilot_global IS DISTINCT FROM true
   OR p.default_autonomy_ceiling IS NULL OR p.default_autonomy_ceiling NOT IN ('suggest','assist','auto')
   THEN RAISE EXCEPTION 'copilot.policy_unavailable'; END IF;
 IF _tenant_id IS NOT NULL THEN
   SELECT * INTO t FROM public.tenant_ai_settings WHERE tenant_id=_tenant_id;
   IF NOT FOUND OR t.ai_enabled IS DISTINCT FROM true OR t.allow_copilot IS DISTINCT FROM true
      OR t.default_autonomy IS NULL OR t.default_autonomy NOT IN ('read_only','supervised','autonomous')
      THEN RAISE EXCEPTION 'copilot.policy_unavailable'; END IF;
   mode_write:=p.default_autonomy_ceiling<>'suggest' AND t.default_autonomy<>'read_only';
 END IF;
 permitted_models:=CASE WHEN _tenant_id IS NOT NULL AND cardinality(t.allowed_models)>0 THEN t.allowed_models ELSE p.global_allowed_models END;
 IF EXISTS(SELECT 1 FROM public.ai_governance_kill_switches k WHERE k.engaged
   AND k.scope IN ('global','copilot','copilot.chat') AND (k.tenant_id IS NULL OR k.tenant_id=_tenant_id))
   THEN RAISE EXCEPTION 'copilot.kill_switch'; END IF;
 RETURN jsonb_build_object('write_proposals',mode_write,'allowed_models',coalesce(to_jsonb(permitted_models),'[]'::jsonb));
END $authorize$;
ALTER FUNCTION private.copilot_broker_authorize(uuid,text,timestamptz,uuid,public.copilot_scope,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.copilot_broker_authorize(uuid,text,timestamptz,uuid,public.copilot_scope,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.copilot_broker_context(
 _verified_actor uuid,_verified_aal text,_verified_expires_at timestamptz,
 _tenant_id uuid,_scope public.copilot_scope,_thread_id uuid,_request_ip text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $context$
DECLARE policy jsonb; choices jsonb;
BEGIN
 policy:=private.copilot_broker_authorize(_verified_actor,_verified_aal,_verified_expires_at,_tenant_id,_scope,_thread_id,_request_ip);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'label',q.label,'provider',q.provider,'model',q.model,
   'available',true,'reason',NULL,'maxInputTokens',q.max_input,'maxOutputTokens',q.max_output) ORDER BY q.priority,q.id),'[]')
 INTO choices FROM (
  SELECT l.id,coalesce(l.display_name,l.provider::text) AS label,l.provider::text AS provider,l.model AS model,l.priority,
    least(c.max_input_tokens,c.context_window-c.max_output_tokens) AS max_input,least(c.max_output_tokens,4096) AS max_output
  FROM public.llm_providers l JOIN public.ai_model_catalog c ON c.id=l.model_catalog_id AND c.model_key=l.model
  JOIN public.ai_provider_instances i ON i.id=l.provider_instance_id AND i.id=c.provider_instance_id
  JOIN public.ai_provider_registry reg ON reg.code=i.provider_code AND reg.enabled
  JOIN LATERAL(SELECT pr.* FROM public.ai_model_pricing pr WHERE pr.provider_code=i.provider_code AND pr.model_key=c.model_key
    AND pr.active AND pr.currency='USD' AND pr.effective_at<=clock_timestamp()
    AND (pr.expires_at IS NULL OR pr.expires_at>clock_timestamp()) ORDER BY pr.effective_at DESC,pr.id LIMIT 1) rate ON true
  WHERE l.is_active AND l.tenant_id IS NOT DISTINCT FROM _tenant_id AND i.tenant_id IS NOT DISTINCT FROM _tenant_id
    AND l.base_url IS NOT NULL AND l.base_url LIKE 'https://%' AND i.vault_secret_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.app_vault_secrets sv WHERE sv.id=i.vault_secret_id AND sv.tenant_id IS NOT DISTINCT FROM _tenant_id
      AND sv.scope=(CASE WHEN _tenant_id IS NULL THEN 'platform' ELSE 'tenant' END) AND sv.secret_class::text='llm_api_key'
      AND sv.name=upper(coalesce(nullif(l.key_secret_name,''),l.provider::text)))
    AND l.scope::text=(CASE WHEN _tenant_id IS NULL THEN 'platform' ELSE 'tenant' END)
    AND c.approval_status='approved' AND c.availability_status IN ('available','limited') AND i.status='active'
    AND c.max_input_tokens>0 AND c.max_output_tokens>0 AND c.context_window>c.max_output_tokens
    AND (jsonb_array_length(policy->'allowed_models')=0 OR (policy->'allowed_models') ? c.model_key OR (policy->'allowed_models') ? (i.provider_code||'/'||c.model_key))
    AND rate.input_usd_per_1m>0 AND rate.output_usd_per_1m>0
    AND rate.input_usd_per_1m::text NOT IN ('NaN','Infinity','-Infinity') AND rate.output_usd_per_1m::text NOT IN ('NaN','Infinity','-Infinity')
  ORDER BY l.priority ASC NULLS LAST,l.id LIMIT 100
 )q;
 RETURN jsonb_build_object('actor_id',_verified_actor,'tenant_id',_tenant_id,'scope',_scope,'thread_id',_thread_id,
   'allowed',true,'write_proposals',(policy->>'write_proposals')::boolean,'providers',choices);
END $context$;
ALTER FUNCTION public.copilot_broker_context(uuid,text,timestamptz,uuid,public.copilot_scope,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.copilot_broker_context(uuid,text,timestamptz,uuid,public.copilot_scope,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.copilot_broker_context(uuid,text,timestamptz,uuid,public.copilot_scope,uuid,text) TO service_role;

CREATE FUNCTION public.copilot_broker_reserved_secret(
 _verified_actor uuid,_verified_aal text,_verified_expires_at timestamptz,
 _tenant_id uuid,_scope public.copilot_scope,_thread_id uuid,_request_ip text,_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $secret$
DECLARE policy jsonb; r public.copilot_spend_reservations%ROWTYPE; l public.llm_providers%ROWTYPE;
 c public.ai_model_catalog%ROWTYPE; i public.ai_provider_instances%ROWTYPE; pr public.ai_model_pricing%ROWTYPE;
 v public.app_vault_secrets%ROWTYPE; leased text;
BEGIN
 IF _reservation_id IS NULL OR _thread_id IS NULL THEN RAISE EXCEPTION 'copilot.reservation_required'; END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role'
   THEN RAISE EXCEPTION 'copilot.verified_subject_required'; END IF;
 PERFORM pg_advisory_xact_lock(61000,1);
 SELECT * INTO r FROM public.copilot_spend_reservations WHERE id=_reservation_id::text FOR UPDATE;
 IF NOT FOUND OR r.actor_id IS DISTINCT FROM _verified_actor OR r.tenant_id IS DISTINCT FROM _tenant_id
   OR r.state IS DISTINCT FROM 'dispatched' OR r.llm_provider_id IS NULL OR r.catalog_id IS NULL OR r.price_id IS NULL
   OR r.created_at IS NULL OR r.created_at<clock_timestamp()-interval '5 minutes'
   THEN RAISE EXCEPTION 'copilot.reservation_denied'; END IF;
 policy:=private.copilot_broker_authorize(_verified_actor,_verified_aal,_verified_expires_at,_tenant_id,_scope,_thread_id,_request_ip);
 SELECT * INTO l FROM public.llm_providers WHERE id=r.llm_provider_id;
 IF NOT FOUND OR l.is_active IS DISTINCT FROM true OR l.tenant_id IS DISTINCT FROM _tenant_id
   OR l.model_catalog_id IS DISTINCT FROM r.catalog_id OR l.model IS DISTINCT FROM r.model_key
   OR l.scope::text IS DISTINCT FROM (CASE WHEN _tenant_id IS NULL THEN 'platform' ELSE 'tenant' END)
   THEN RAISE EXCEPTION 'copilot.binding_changed'; END IF;
 SELECT * INTO c FROM public.ai_model_catalog WHERE id=r.catalog_id;
 IF NOT FOUND OR c.model_key IS DISTINCT FROM r.model_key OR c.provider_instance_id IS DISTINCT FROM l.provider_instance_id
   OR c.approval_status IS DISTINCT FROM 'approved' OR c.availability_status NOT IN ('available','limited') OR c.availability_status IS NULL
   OR least(c.max_input_tokens,c.context_window-c.max_output_tokens) IS DISTINCT FROM r.max_input_tokens
   OR c.max_output_tokens IS DISTINCT FROM r.max_output_tokens THEN RAISE EXCEPTION 'copilot.binding_changed'; END IF;
 SELECT * INTO i FROM public.ai_provider_instances WHERE id=l.provider_instance_id;
 IF NOT FOUND OR i.status IS DISTINCT FROM 'active' OR i.tenant_id IS DISTINCT FROM _tenant_id OR i.vault_secret_id IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.ai_provider_registry reg WHERE reg.code=i.provider_code AND reg.enabled)
   THEN RAISE EXCEPTION 'copilot.binding_changed'; END IF;
 IF jsonb_array_length(policy->'allowed_models')>0 AND NOT ((policy->'allowed_models') ? c.model_key OR (policy->'allowed_models') ? (i.provider_code||'/'||c.model_key))
   THEN RAISE EXCEPTION 'copilot.model_policy_denied'; END IF;
 SELECT * INTO pr FROM public.ai_model_pricing WHERE id=r.price_id;
 IF NOT FOUND OR pr.active IS DISTINCT FROM true OR pr.currency IS DISTINCT FROM 'USD'
   OR pr.provider_code IS DISTINCT FROM i.provider_code OR pr.model_key IS DISTINCT FROM r.model_key
   OR pr.effective_at IS NULL OR pr.effective_at>clock_timestamp() OR (pr.expires_at IS NOT NULL AND pr.expires_at<=clock_timestamp())
   OR pr.input_usd_per_1m IS DISTINCT FROM r.input_rate OR pr.output_usd_per_1m IS DISTINCT FROM r.output_rate
   OR pr.input_usd_per_1m IS NULL OR pr.output_usd_per_1m IS NULL OR pr.input_usd_per_1m<=0 OR pr.output_usd_per_1m<=0
   OR pr.input_usd_per_1m::text IN ('NaN','Infinity','-Infinity') OR pr.output_usd_per_1m::text IN ('NaN','Infinity','-Infinity')
   THEN RAISE EXCEPTION 'copilot.pricing_unavailable'; END IF;
 SELECT * INTO v FROM public.app_vault_secrets WHERE id=i.vault_secret_id;
 IF NOT FOUND OR v.tenant_id IS DISTINCT FROM _tenant_id OR v.scope IS DISTINCT FROM (CASE WHEN _tenant_id IS NULL THEN 'platform' ELSE 'tenant' END)
   OR v.secret_class::text IS DISTINCT FROM 'llm_api_key' OR v.name IS DISTINCT FROM upper(coalesce(nullif(l.key_secret_name,''),l.provider::text))
   OR v.ciphertext IS NULL OR v.iv IS NULL OR v.auth_tag IS NULL OR v.wrapped_dek IS NULL OR v.kek_ref IS NULL
   THEN RAISE EXCEPTION 'copilot.vault_binding_unavailable'; END IF;
 INSERT INTO private.copilot_broker_dispatch_receipts(reservation_id,actor_id,tenant_id,thread_id,provider_id,catalog_id,price_id,caller_kind,verified_aal,purpose)
 VALUES(r.id,r.actor_id,r.tenant_id,_thread_id,l.id,c.id,pr.id,'service_role',_verified_aal,'copilot_reserved_dispatch')
 ON CONFLICT(reservation_id) DO NOTHING RETURNING reservation_id INTO leased;
 IF leased IS NULL THEN RAISE EXCEPTION 'copilot.already_dispatched'; END IF;
 RETURN jsonb_build_object('reservation_id',_reservation_id,'actor_id',r.actor_id,'tenant_id',r.tenant_id,'thread_id',_thread_id,
   'provider_id',l.id,'model_catalog_id',c.id,'model_key',c.model_key,'provider',l.provider::text,'base_url',l.base_url,
   'key_secret_name',upper(coalesce(nullif(l.key_secret_name,''),l.provider::text)),
   'auth_method',i.auth_method,'api_version',i.api_version,'custom_headers',coalesce(i.custom_headers,'{}'::jsonb),
   'write_proposals',(policy->>'write_proposals')::boolean,
   'vault',jsonb_build_object('ciphertext',v.ciphertext,'iv',v.iv,'auth_tag',v.auth_tag,'wrapped_dek',v.wrapped_dek,'kek_provider',v.kek_provider,'kek_ref',v.kek_ref));
END $secret$;
ALTER FUNCTION public.copilot_broker_reserved_secret(uuid,text,timestamptz,uuid,public.copilot_scope,uuid,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.copilot_broker_reserved_secret(uuid,text,timestamptz,uuid,public.copilot_scope,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.copilot_broker_reserved_secret(uuid,text,timestamptz,uuid,public.copilot_scope,uuid,text,uuid) TO service_role;

CREATE FUNCTION public.copilot_check_current_ip_access(_tenant_id uuid, _ip text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $copilot_ip$
DECLARE
  actor uuid := auth.uid();
  enabled boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
    OR current_setting('role',true) IS DISTINCT FROM 'authenticated'
    OR actor IS NULL OR _tenant_id IS NULL THEN RETURN false; END IF;
  IF private.rlnext_account_allowed(actor,NULL) IS DISTINCT FROM true
    OR private.rlnext_account_allowed(actor,_tenant_id) IS DISTINCT FROM true
    THEN RAISE EXCEPTION 'copilot.account_denied' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id=_tenant_id AND tm.user_id=actor AND tm.active)
    THEN RETURN false; END IF;
  SELECT s.ip_allowlist_enabled INTO enabled
    FROM public.tenant_security_settings s WHERE s.tenant_id=_tenant_id;
  IF NOT FOUND OR enabled IS NULL THEN RETURN false; END IF;
  IF enabled=false THEN RETURN true; END IF;
  IF _ip IS NULL OR btrim(_ip)='' THEN RETURN false; END IF;
  RETURN coalesce(public.ip_in_tenant_allowlist(_tenant_id,_ip),false);
END
$copilot_ip$;
ALTER FUNCTION public.copilot_check_current_ip_access(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.copilot_check_current_ip_access(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.copilot_check_current_ip_access(uuid,text) TO authenticated;
