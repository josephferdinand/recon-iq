\set ON_ERROR_STOP on
SET ROLE service_role;
DO $tests$
DECLARE p jsonb; request_id uuid; n integer; c integer; expected record;
BEGIN
 p:=public.prepare_public_ai_inference(repeat('a',64),NULL,'chat',NULL,4096);
 IF p->>'subject_user_id'<>'20000000-0000-4000-8000-000000000002' OR (p->>'max_tokens')::integer<>1024
 OR p->'vault' IS NULL OR p->>'principal_kind'<>'user_delegated' THEN RAISE EXCEPTION 'positive subject/bounds/vault failed: %',p; END IF;
 request_id:=(p->>'request_id')::uuid;
 IF NOT public.record_public_ai_inference_usage(request_id,12,3,200,10) THEN RAISE EXCEPTION 'settlement failed'; END IF;
 IF NOT public.record_public_ai_inference_usage(request_id,12,3,200,10) THEN RAISE EXCEPTION 'settlement replay failed'; END IF;
 IF public.record_public_ai_inference_usage(request_id,99,3,200,10) THEN RAISE EXCEPTION 'changed settlement replay accepted'; END IF;
END $tests$;
RESET ROLE;
DO $$BEGIN
 IF (SELECT count(*) FROM public.ai_usage_events)<>1 OR (SELECT user_id FROM public.ai_usage_events)<>'20000000-0000-4000-8000-000000000002'::uuid
 OR (SELECT cost_usd FROM public.ai_usage_events)<>0.000054 THEN RAISE EXCEPTION 'actor/cost/exactly-once failed'; END IF;
 IF (SELECT count(*) FROM public.audit_log)<>2 THEN RAISE EXCEPTION 'atomic audit failed'; END IF;
END$$;

-- Each mutation is fixture-only and rolled back; no production rows touched.
CREATE FUNCTION private.qa_denied(_mutation text,_expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p jsonb;
BEGIN
 BEGIN
  EXECUTE _mutation;
  SET LOCAL ROLE service_role;
  p:=public.prepare_public_ai_inference(repeat('a',64),NULL,'chat',NULL,4096);
  RESET ROLE;
  IF p->>'error' IS DISTINCT FROM _expected THEN RAISE EXCEPTION 'Unexpected auth result %, expected %',p,_expected; END IF;
  RAISE SQLSTATE 'Q0001';
 EXCEPTION WHEN SQLSTATE 'Q0001' THEN NULL; END;
END$$;
SELECT private.qa_denied('UPDATE public.api_tokens SET revoked_at=now()','token_revoked');
SELECT private.qa_denied('UPDATE public.api_tokens SET expires_at=clock_timestamp()','token_expired');
SELECT private.qa_denied('UPDATE public.api_tokens SET expires_at=now()-interval ''1 minute''','token_expired');
SELECT private.qa_denied('UPDATE public.api_tokens SET scopes=ARRAY[''recons.read'']','missing_scope');
SELECT private.qa_denied('UPDATE public.api_tokens SET scopes=ARRAY[''*'']','missing_scope');
SELECT private.qa_denied('UPDATE public.api_tokens SET principal_kind=''unclassified'',subject_user_id=NULL','principal_denied');
SELECT private.qa_denied('UPDATE public.api_tokens SET principal_kind=''tenant_machine'',subject_user_id=NULL,service_principal_id=gen_random_uuid()','principal_denied');
SELECT private.qa_denied('UPDATE public.api_tokens SET issuer_user_id=NULL','principal_denied');
SELECT private.qa_denied('UPDATE public.api_tokens SET issuer_user_id=''20000000-0000-4000-8000-000000000009''','principal_denied');
SELECT private.qa_denied('UPDATE public.api_tokens SET created_by=''20000000-0000-4000-8000-000000000009''','principal_denied');
SELECT private.qa_denied('UPDATE public.tenant_members SET active=false','principal_denied');
SELECT private.qa_denied('UPDATE public.tenant_members SET deactivated_at=now()','principal_denied');
SELECT private.qa_denied('DELETE FROM public.tenant_members','principal_denied');
SELECT private.qa_denied('UPDATE public.tenants SET ai_enabled=false','ai_policy_denied');
SELECT private.qa_denied('INSERT INTO public.ai_governance_kill_switches(tenant_id,engaged) VALUES(NULL,true)','ai_paused');
SELECT private.qa_denied('INSERT INTO public.ai_governance_kill_switches(tenant_id,engaged) VALUES(''10000000-0000-4000-8000-000000000001'',true)','ai_paused');
SELECT private.qa_denied('UPDATE private.qa_rate_limit SET allowed=false','rate_limit_exceeded');
SELECT private.qa_denied('UPDATE public.ai_provider_instances SET tenant_id=''10000000-0000-4000-8000-000000000009''','route_unavailable');
SELECT private.qa_denied('UPDATE public.ai_provider_instances SET tenant_id=NULL','route_unavailable');
SELECT private.qa_denied('UPDATE public.app_vault_secrets SET tenant_id=''10000000-0000-4000-8000-000000000009''','route_unavailable');
SELECT private.qa_denied('UPDATE public.app_vault_secrets SET scope=''platform'',tenant_id=NULL','route_unavailable');
SELECT private.qa_denied('UPDATE public.tenant_members SET role=''tenant_analyst''','route_unavailable');
SELECT private.qa_denied('UPDATE public.ai_model_catalog SET approval_status=''proposed''','route_unavailable');
SELECT private.qa_denied('UPDATE public.ai_model_catalog SET availability_status=''unavailable''','route_unavailable');
SELECT private.qa_denied('UPDATE public.ai_provider_instances SET status=''disabled''','route_unavailable');
SELECT private.qa_denied('UPDATE public.ai_routing_policies SET enabled=false','route_unavailable');
SELECT private.qa_denied('UPDATE public.ai_routing_policies SET conditions=''{"request_class":"image"}''::jsonb','route_unavailable');
SELECT private.qa_denied('INSERT INTO public.api_tokens SELECT gen_random_uuid(),tenant_id,token_hash,scopes,expires_at,revoked_at,created_by,principal_kind,issuer_user_id,subject_user_id,service_principal_id,last_used_at FROM public.api_tokens','invalid_token');
SET ROLE service_role;
DO $$DECLARE p jsonb; r uuid; BEGIN
 p:=public.prepare_public_ai_inference(repeat('a',64),'10000000-0000-4000-8000-000000000009','chat',NULL,4096);
 IF p->>'error'<>'tenant_scope_mismatch' THEN RAISE EXCEPTION 'wrong tenant accepted'; END IF;
 p:=public.prepare_public_ai_inference(repeat('b',64),NULL,'chat',NULL,4096);
 IF p->>'error'<>'invalid_token' THEN RAISE EXCEPTION 'unknown hash accepted'; END IF;
 p:=public.prepare_public_ai_inference(repeat('a',64),NULL,'chat','not-allowed',4096);
 IF p->>'error'<>'route_unavailable' THEN RAISE EXCEPTION 'wrong model accepted'; END IF;
 p:=public.prepare_public_ai_inference(repeat('a',64),NULL,'chat',NULL,4097);
 IF p->>'error'<>'invalid_request' THEN RAISE EXCEPTION 'output bound ignored'; END IF;
 p:=public.prepare_public_ai_inference(repeat('a',64),NULL,'chat',NULL,4);
 IF (p->>'max_tokens')::integer<>4 THEN RAISE EXCEPTION 'caller output bound raised'; END IF;
 r:=(p->>'request_id')::uuid;
 IF NOT public.record_public_ai_inference_usage(r,NULL,NULL,0,0) THEN RAISE EXCEPTION 'unknown usage rejected'; END IF;
END$$;
RESET ROLE;
DO $$BEGIN
 IF (SELECT count(*) FROM public.ai_usage_events)<>1 THEN RAISE EXCEPTION 'unknown usage became zero event'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.public_ai_inference_requests WHERE state='usage_unknown' AND tokens_in IS NULL AND tokens_out IS NULL AND cost_usd IS NULL) THEN RAISE EXCEPTION 'unknown receipt missing'; END IF;
END$$;
-- Direct role execution and anonymous table reads are actually denied.
DO $$DECLARE denied boolean:=false; BEGIN
 BEGIN SET LOCAL ROLE anon; PERFORM public.prepare_public_ai_inference(repeat('a',64),NULL,'chat',NULL,1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 RESET ROLE; IF NOT denied THEN RAISE EXCEPTION 'anon RPC allowed'; END IF;
 denied:=false;
 BEGIN SET LOCAL ROLE authenticated; PERFORM public.prepare_public_ai_inference(repeat('a',64),NULL,'chat',NULL,1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 RESET ROLE; IF NOT denied THEN RAISE EXCEPTION 'authenticated RPC allowed'; END IF;
 denied:=false;
 BEGIN SET LOCAL ROLE anon; PERFORM * FROM public.app_vault_secrets;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 RESET ROLE; IF NOT denied THEN RAISE EXCEPTION 'anonymous vault read allowed'; END IF;
END$$;
SELECT 'AI SQL fixture regression PASS (exact Curie principal helper; hosted acceptance OPEN)' AS result;
