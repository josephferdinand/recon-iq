-- Synthetic new QA identities; no copied hosted identities/tokens/business rows.
CREATE SCHEMA fvi_test;
GRANT USAGE ON SCHEMA fvi_test TO authenticated,anon,service_role;
CREATE TABLE fvi_test.state(key text PRIMARY KEY,value text);
GRANT SELECT,INSERT,UPDATE ON fvi_test.state TO authenticated,anon,service_role;
CREATE FUNCTION fvi_test.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'case failed: %',label; END IF; END $$;
CREATE FUNCTION fvi_test.denied(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE=expected THEN RETURN; END IF; RAISE EXCEPTION 'wrong denial state %, wanted %: %',SQLSTATE,expected,SQLERRM;
 END;
 RAISE EXCEPTION 'expected denial %',expected;
END $$;
CREATE FUNCTION fvi_test.token() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT value::uuid FROM fvi_test.state WHERE key='token'$$;
INSERT INTO auth.users(id) VALUES
 ('ca000000-0000-4000-8000-000000000011'),('ca000000-0000-4000-8000-000000000012'),
 ('ca000000-0000-4000-8000-000000000013'),('ca000000-0000-4000-8000-000000000014');
INSERT INTO public.tenants(id,slug) VALUES('ca000000-0000-4000-8000-000000000001','qa-curie'),('ca000000-0000-4000-8000-000000000002','qa-other');
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000011','tenant_admin',true),
 ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000012','tenant_admin',true),
 ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000013','tenant_viewer',true),
 ('ca000000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000014','tenant_admin',true);
INSERT INTO public.api_tokens(id,tenant_id,name,prefix,token_hash,scopes,created_by)
 VALUES('ca000000-0000-4000-8000-000000000021','ca000000-0000-4000-8000-000000000001','Old unclassified','fvi_00000000',repeat('0',64),ARRAY['recons.read'],'ca000000-0000-4000-8000-000000000011');
INSERT INTO public.recon_definitions(id,tenant_id,access_mode,visibility,status,environment,governance_state) VALUES
 ('ca000000-0000-4000-8000-000000000031','ca000000-0000-4000-8000-000000000001','mapped_exact','restricted','active','development','development_draft'),
 ('ca000000-0000-4000-8000-000000000032','ca000000-0000-4000-8000-000000000001','legacy_passthrough','tenant','active','development','development_draft'),
 ('ca000000-0000-4000-8000-000000000033','ca000000-0000-4000-8000-000000000001','unmapped_pending','restricted','active','development','development_draft'),
 ('ca000000-0000-4000-8000-000000000034','ca000000-0000-4000-8000-000000000002','legacy_passthrough','tenant','active','development','development_draft');
INSERT INTO public.business_units(id,tenant_id,path,is_archived) VALUES
 ('ca000000-0000-4000-8000-000000000041','ca000000-0000-4000-8000-000000000001','qa.curie',false);
INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id) VALUES
 ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000031','ca000000-0000-4000-8000-000000000041');
INSERT INTO public.tenant_groups(id,tenant_id,name) VALUES('ca000000-0000-4000-8000-000000000051','ca000000-0000-4000-8000-000000000001','QA group');
INSERT INTO public.tenant_group_members(group_id,user_id) VALUES('ca000000-0000-4000-8000-000000000051','ca000000-0000-4000-8000-000000000011');
INSERT INTO public.bu_group_assignments(tenant_id,bu_id,group_id,inherit_descendants) VALUES
 ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000041','ca000000-0000-4000-8000-000000000051',false);
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action) VALUES
 ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000031','ca000000-0000-4000-8000-000000000041','group','ca000000-0000-4000-8000-000000000051','view');
INSERT INTO public.recon_runs(id,tenant_id,definition_id,status,started_at,completed_at,run_uid,matched_count,exception_count,total_rows,stats)
 SELECT ('ca000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000031','completed',now()-n*interval '1 second',NULL,'R-QA-'||n,NULL,NULL,NULL,'{}' FROM generate_series(1,123) n;
INSERT INTO public.recon_runs(id,tenant_id,definition_id,status,started_at,run_uid) VALUES
 ('ca000000-0000-4000-8001-000000000124','ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000031','completed',now()-interval '60 days','R-OLD'),
 ('ca000000-0000-4000-8001-000000000125','ca000000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000034','completed',now(),'R-OTHER'),
 ('ca000000-0000-4000-8001-000000000126','ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000032','completed',now(),'R-LEGACY');
INSERT INTO public.recon_matches(id,tenant_id,run_id,created_at,cardinality,members)
 SELECT ('ca000000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid,'ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8001-000000000001',now()+n*interval '1 second','1:1','{"A":[{"amount":"0.01"}],"B":[{"amount":"0.01"}]}' FROM generate_series(1,101) n;
INSERT INTO public.recon_exceptions(id,tenant_id,run_id,created_at,public_case_id,side,reason,status,payload) VALUES
 ('ca000000-0000-4000-8003-000000000001','ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8001-000000000001',now(),'QA-CASE-1','A','missing','open','{"key":"x","missing_side":"B","row":{"amount":"1.00"}}'),
 ('ca000000-0000-4000-8003-000000000002','ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8001-000000000001',now(),'QA-CASE-2','A','missing','open','{"key":"x","missing_sides":["B"],"row":{"amount":"2.00"}}'),
 ('ca000000-0000-4000-8003-000000000003','ca000000-0000-4000-8000-000000000002','ca000000-0000-4000-8001-000000000001',now(),'QA-CASE-OTHER','A','cross tenant','open','{}');
INSERT INTO fvi_test.state VALUES('old-token',(SELECT md5(to_jsonb(t)::text) FROM public.api_tokens t WHERE id='ca000000-0000-4000-8000-000000000021')),
 ('old-runs',(SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM public.recon_runs r));
-- AFTER MIGRATION:
-- CASE: no existing token reclassification, creator/hash/scope alteration or run rewrite
SELECT fvi_test.assert_true((SELECT value=(SELECT md5(to_jsonb(t)::text) FROM public.api_tokens t WHERE id='ca000000-0000-4000-8000-000000000021') FROM fvi_test.state WHERE key='old-token'),'old token intact');
SELECT fvi_test.assert_true((SELECT value=(SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM public.recon_runs r) FROM fvi_test.state WHERE key='old-runs'),'old runs intact');
-- CASE: read RPC and private result helper ACLs are purpose restricted
SELECT fvi_test.assert_true(has_function_privilege('service_role','public.read_reconciliation_runs_for_api(uuid,uuid,text,uuid,text,uuid,integer,integer,text,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.read_reconciliation_runs_for_api(uuid,uuid,text,uuid,text,uuid,integer,integer,text,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.read_reconciliation_runs_for_api(uuid,uuid,text,uuid,text,uuid,integer,integer,text,uuid)','EXECUTE'),'RPC ACL');
SELECT fvi_test.assert_true(NOT has_function_privilege('service_role','private.recon_api_persisted_result_page(uuid,uuid,integer,text)','EXECUTE'),'private page ACL');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000011',false);
-- CASE: legitimate new self-bound issuance commits audit int8 beyond JS safe range
INSERT INTO fvi_test.state SELECT 'token',(public.issue_user_delegated_api_token('ca000000-0000-4000-8000-000000000001','New QA','fvi_aaaaaaaa',repeat('a',64),ARRAY['recons.read','ai.inference'],NULL)->>'id');
SELECT fvi_test.assert_true((SELECT principal_kind='user_delegated' AND subject_user_id=created_by AND issuer_user_id=created_by FROM public.api_tokens WHERE id=fvi_test.token()),'new actor bound');
-- CASE: ordinary caller cannot insert another actor creator
SELECT fvi_test.denied($sql$INSERT INTO public.api_tokens(tenant_id,name,prefix,token_hash,scopes,created_by) VALUES('ca000000-0000-4000-8000-000000000001','Forged','fvi_bbbbbbbb',repeat('b',64),ARRAY['recons.read'],'ca000000-0000-4000-8000-000000000012')$sql$,'23514');
-- CASE: ordinary caller cannot self-classify into trusted delegated subject
SELECT fvi_test.denied($sql$INSERT INTO public.api_tokens(tenant_id,name,prefix,token_hash,scopes,created_by,principal_kind,subject_user_id) VALUES('ca000000-0000-4000-8000-000000000001','Forged','fvi_bbbbbbbb',repeat('b',64),ARRAY['recons.read'],'ca000000-0000-4000-8000-000000000011','user_delegated','ca000000-0000-4000-8000-000000000011')$sql$,'23514');
-- CASE: immutable creator, tenant and bearer hash prevent privilege substitution
SELECT fvi_test.denied('UPDATE public.api_tokens SET created_by=''ca000000-0000-4000-8000-000000000012'' WHERE id=fvi_test.token()','23514');
SELECT fvi_test.denied('UPDATE public.api_tokens SET tenant_id=''ca000000-0000-4000-8000-000000000002'' WHERE id=fvi_test.token()','23514');
SELECT fvi_test.denied('UPDATE public.api_tokens SET token_hash=repeat(''b'',64) WHERE id=fvi_test.token()','23514');
-- CASE: immutable subject/classification/id/scope/expiry guard also denies service mutation
RESET ROLE;
SELECT fvi_test.denied('UPDATE public.api_tokens SET subject_user_id=''ca000000-0000-4000-8000-000000000012'' WHERE id=fvi_test.token()','23514');
SELECT fvi_test.denied('UPDATE public.api_tokens SET principal_kind=''unclassified'',subject_user_id=NULL WHERE id=fvi_test.token()','23514');
SELECT fvi_test.denied('UPDATE public.api_tokens SET id=gen_random_uuid() WHERE id=fvi_test.token()','23514');
SELECT fvi_test.denied('UPDATE public.api_tokens SET scopes=ARRAY[''*''] WHERE id=fvi_test.token()','23514');
SELECT fvi_test.denied('UPDATE public.api_tokens SET expires_at=now()+interval ''1 year'' WHERE id=fvi_test.token()','23514');
-- CASE: issuer is generated and cannot be separately supplied
SELECT fvi_test.denied('UPDATE public.api_tokens SET issuer_user_id=''ca000000-0000-4000-8000-000000000012'' WHERE id=fvi_test.token()','428C9');
-- CASE: lower actor to ordinary viewer; current group view is sufficient without run/edit
UPDATE public.tenant_members SET role='tenant_viewer' WHERE user_id='ca000000-0000-4000-8000-000000000011';
CREATE FUNCTION fvi_test.read_api(mode text DEFAULT 'history',run uuid DEFAULT NULL,page integer DEFAULT 1,days integer DEFAULT 30,status text DEFAULT 'all',recon uuid DEFAULT 'ca000000-0000-4000-8000-000000000031',tenant uuid DEFAULT 'ca000000-0000-4000-8000-000000000001',slug text DEFAULT 'qa-curie',token uuid DEFAULT fvi_test.token()) RETURNS jsonb LANGUAGE sql VOLATILE AS $$
 SELECT public.read_reconciliation_runs_for_api(token,tenant,slug,recon,mode,run,page,days,status,'ca000000-0000-4000-8000-000000000099') $$;
-- Test-only definer simulates the named AI service RPC, without adding product grants.
CREATE FUNCTION fvi_test.ai_principal(token uuid DEFAULT fvi_test.token()) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER AS $$
 SELECT to_jsonb(p) FROM private.qualified_user_delegated_api_token(token,'ca000000-0000-4000-8000-000000000001','ai.inference') p $$;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000012',false);
-- CASE: shared AI principal contract exact row/subject/current membership; no service EXECUTE grant
SELECT fvi_test.assert_true((fvi_test.ai_principal()->>'actor_user_id')='ca000000-0000-4000-8000-000000000011' AND (fvi_test.ai_principal()->>'principal_kind')='user_delegated','shared AI contract positive');
SELECT fvi_test.assert_true(NOT has_function_privilege('service_role','private.qualified_user_delegated_api_token(uuid,uuid,text)','EXECUTE'),'shared private-only ACL');
-- CASE: exact 50-row history, total and has-next page1/page2/page3/outside page
SELECT fvi_test.assert_true((SELECT jsonb_array_length(p->'rows')=50 AND p->>'total'='123' AND p->>'has_next'='true' FROM fvi_test.read_api() p),'history page1');
SELECT fvi_test.assert_true((SELECT jsonb_array_length(p->'rows')=50 AND p->>'page'='2' FROM fvi_test.read_api(page=>2) p),'history page2');
SELECT fvi_test.assert_true((SELECT jsonb_array_length(p->'rows')=23 AND p->>'has_next'='false' FROM fvi_test.read_api(page=>3) p),'history page3');
SELECT fvi_test.assert_true((SELECT jsonb_array_length(p->'rows')=0 AND p->>'total'='123' FROM fvi_test.read_api(page=>10000) p),'outside page retains total');
-- CASE: days-window matches exact tenant/recon only
SELECT fvi_test.assert_true((fvi_test.read_api(days=>90)->>'total')='124','90 day window');
-- CASE: stored counts remain null, no computed-zero substitutions
SELECT fvi_test.assert_true((fvi_test.read_api()->'rows'->0->'total_rows')='null'::jsonb AND (fvi_test.read_api()->'rows'->0->'matched_input_memberships')='null'::jsonb,'nulls retained');
-- CASE: int8 receipt remains string, actor is bound subject despite hostile service JWT sub
SELECT fvi_test.assert_true((fvi_test.read_api()->>'audit_id')::bigint>9007199254740991,'int8 string receipt');
SELECT fvi_test.assert_true(current_setting('request.jwt.claim.sub')='ca000000-0000-4000-8000-000000000012','JWT unchanged');
RESET ROLE;
SELECT fvi_test.assert_true((SELECT actor_user_id='ca000000-0000-4000-8000-000000000011' AND context->>'api_token_id'=fvi_test.token()::text AND octet_length(row_hash)=32 FROM public.audit_log ORDER BY id DESC LIMIT 1),'actor/chain receipt');
SET ROLE service_role;
-- CASE: exact persisted result pages and 101 match-group counts, normalized missing-child parents
SELECT fvi_test.assert_true((SELECT jsonb_array_length(p->'results')=50 AND p->>'parent_count'='102' AND p->'status_counts'->>'match_groups'='101' AND p->'status_counts'->>'exception_items'='2' FROM fvi_test.read_api('results','ca000000-0000-4000-8001-000000000001') p),'result page');
SELECT fvi_test.assert_true((SELECT jsonb_array_length(p->'results')=2 AND p->>'has_next'='false' FROM fvi_test.read_api('results','ca000000-0000-4000-8001-000000000001',3) p),'result page3');
SELECT fvi_test.assert_true((SELECT jsonb_array_length(p->'results')=1 AND jsonb_array_length(p->'results'->0->'exception_items')=2 AND p->>'parent_count'='1' FROM fvi_test.read_api('results','ca000000-0000-4000-8001-000000000001',1,30,'missing') p),'missing exact parent');
-- CASE: wrong tenant/slug/recon/run are uniformly hidden, including same-tenant wrong definition
SELECT fvi_test.denied('SELECT fvi_test.read_api(tenant=>''ca000000-0000-4000-8000-000000000002'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.read_api(slug=>''qa-other'')','P0002');
SELECT fvi_test.denied('SELECT fvi_test.read_api(recon=>''ca000000-0000-4000-8000-000000000034'')','P0002');
SELECT fvi_test.denied('SELECT fvi_test.read_api(''results'',''ca000000-0000-4000-8001-000000000125'')','P0002');
SELECT fvi_test.denied('SELECT fvi_test.read_api(''results'',''ca000000-0000-4000-8001-000000000126'')','P0002');
-- CASE: invalid arguments never read or audit
SELECT fvi_test.denied('SELECT fvi_test.read_api(page=>0)','22023');
SELECT fvi_test.denied('SELECT fvi_test.read_api(page=>10001)','22023');
SELECT fvi_test.denied('SELECT fvi_test.read_api(days=>365)','22023');
SELECT fvi_test.denied('SELECT fvi_test.read_api(status=>''missing'')','22023');
-- CASE: existing unclassified row not trusted; legitimate issuer alias alone is insufficient
SELECT fvi_test.denied('SELECT fvi_test.read_api(token=>''ca000000-0000-4000-8000-000000000021'')','42501');
-- CASE: current legacy access permits view; unmapped ordinary viewer denies
SELECT fvi_test.assert_true(fvi_test.read_api(recon=>'ca000000-0000-4000-8000-000000000032')->>'total'='1','legacy viewer');
SELECT fvi_test.denied('SELECT fvi_test.read_api(recon=>''ca000000-0000-4000-8000-000000000033'')','42501');
-- CASE: group/view grant, BU association, BU archive and membership revocation immediately deny
RESET ROLE;
BEGIN; DELETE FROM public.tenant_group_members WHERE user_id='ca000000-0000-4000-8000-000000000011'; SET LOCAL ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api()','42501'); ROLLBACK;
BEGIN; DELETE FROM public.recon_definition_bu_grants; SET LOCAL ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api()','42501'); ROLLBACK;
BEGIN; DELETE FROM public.bu_group_assignments; SET LOCAL ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api()','42501'); ROLLBACK;
BEGIN; UPDATE public.business_units SET is_archived=true; SET LOCAL ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api()','42501'); ROLLBACK;
BEGIN; UPDATE public.tenant_members SET active=false WHERE user_id='ca000000-0000-4000-8000-000000000011'; SET LOCAL ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api()','42501');
SELECT fvi_test.denied('SELECT fvi_test.ai_principal()','42501'); ROLLBACK;
-- CASE: retired mapped read uses current actual view semantics, not run/edit approval
BEGIN; UPDATE public.recon_definitions SET status='archived',retired_at=now() WHERE id='ca000000-0000-4000-8000-000000000031'; SET LOCAL ROLE service_role;
SELECT fvi_test.assert_true(fvi_test.read_api()->>'total'='123','retired authorized history'); ROLLBACK;
-- CASE: current token revocation cannot be undone, and denies read immediately
BEGIN; UPDATE public.api_tokens SET revoked_at=now() WHERE id=fvi_test.token();
SELECT fvi_test.denied('UPDATE public.api_tokens SET revoked_at=NULL WHERE id=fvi_test.token()','23514'); SET LOCAL ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api()','42501'); ROLLBACK;
-- CASE: explicit scope only, expiry and mismatched typed subject deny without trusting creator
INSERT INTO public.api_tokens(id,tenant_id,name,prefix,token_hash,scopes,created_by,principal_kind,subject_user_id,expires_at) VALUES
 ('ca000000-0000-4000-8000-000000000022','ca000000-0000-4000-8000-000000000001','Wildcard','fvi_cccccccc',repeat('c',64),ARRAY['*'],'ca000000-0000-4000-8000-000000000011','user_delegated','ca000000-0000-4000-8000-000000000011',NULL),
 ('ca000000-0000-4000-8000-000000000023','ca000000-0000-4000-8000-000000000001','Expired','fvi_dddddddd',repeat('d',64),ARRAY['recons.read'],'ca000000-0000-4000-8000-000000000011','user_delegated','ca000000-0000-4000-8000-000000000011',now()-interval '1 second'),
 ('ca000000-0000-4000-8000-000000000024','ca000000-0000-4000-8000-000000000001','Other subject','fvi_eeeeeeee',repeat('e',64),ARRAY['recons.read'],'ca000000-0000-4000-8000-000000000011','user_delegated','ca000000-0000-4000-8000-000000000012',NULL);
SET ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api(token=>''ca000000-0000-4000-8000-000000000022'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.read_api(token=>''ca000000-0000-4000-8000-000000000023'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.read_api(token=>''ca000000-0000-4000-8000-000000000024'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.ai_principal(''ca000000-0000-4000-8000-000000000021'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.ai_principal(''ca000000-0000-4000-8000-000000000022'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.ai_principal(''ca000000-0000-4000-8000-000000000023'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.ai_principal(''ca000000-0000-4000-8000-000000000024'')','42501');
-- CASE: machine principal and read-only token cannot masquerade as AI human subject
RESET ROLE;
INSERT INTO public.api_service_principals(id,tenant_id,name,active) VALUES('ca000000-0000-4000-8000-000000000061','ca000000-0000-4000-8000-000000000001','Synthetic machine',true);
INSERT INTO public.api_tokens(id,tenant_id,name,prefix,token_hash,scopes,created_by,principal_kind,service_principal_id) VALUES
 ('ca000000-0000-4000-8000-000000000025','ca000000-0000-4000-8000-000000000001','Machine','fvi_66666666',repeat('6',64),ARRAY['recons.read','ai.inference'],'ca000000-0000-4000-8000-000000000011','tenant_machine','ca000000-0000-4000-8000-000000000061');
INSERT INTO public.api_tokens(id,tenant_id,name,prefix,token_hash,scopes,created_by,principal_kind,subject_user_id) VALUES
 ('ca000000-0000-4000-8000-000000000026','ca000000-0000-4000-8000-000000000001','Read only','fvi_55555555',repeat('5',64),ARRAY['recons.read'],'ca000000-0000-4000-8000-000000000011','user_delegated','ca000000-0000-4000-8000-000000000011');
SET ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api(token=>''ca000000-0000-4000-8000-000000000025'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.ai_principal(''ca000000-0000-4000-8000-000000000025'')','42501');
SELECT fvi_test.denied('SELECT fvi_test.ai_principal(''ca000000-0000-4000-8000-000000000026'')','42501');
-- CASE: caller role cannot elevate using service claim spoof
SET ROLE authenticated;
SELECT fvi_test.denied('SELECT fvi_test.read_api()','42501');
SELECT fvi_test.denied('SELECT fvi_test.ai_principal()','42501');
RESET ROLE;
-- CASE: audit trigger failure aborts read and leaves chain/count unchanged
CREATE FUNCTION fvi_test.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE='23514'; END$$;
CREATE TRIGGER zz_qa_audit_fail AFTER INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION fvi_test.fail_audit();
INSERT INTO fvi_test.state VALUES('audit-count',(SELECT count(*)::text FROM public.audit_log)),('chain',(SELECT encode(last_hash,'hex') FROM public.audit_chain_head));
SET ROLE service_role;
SELECT fvi_test.denied('SELECT fvi_test.read_api()','23514');
SELECT fvi_test.assert_true(current_setting('request.jwt.claim.sub')='ca000000-0000-4000-8000-000000000012','JWT unchanged on error');
RESET ROLE;
SELECT fvi_test.assert_true((SELECT value=(SELECT count(*)::text FROM public.audit_log) FROM fvi_test.state WHERE key='audit-count'),'failed audit count rollback');
SELECT fvi_test.assert_true((SELECT value=(SELECT encode(last_hash,'hex') FROM public.audit_chain_head) FROM fvi_test.state WHERE key='chain'),'failed chain rollback');
-- CASE: failed issuance rolls back token row and failed revocation rolls back old timestamp
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000012',false);
SELECT fvi_test.denied($sql$SELECT public.issue_user_delegated_api_token('ca000000-0000-4000-8000-000000000001','Failed','fvi_ffffffff',repeat('f',64),ARRAY['recons.read'],NULL)$sql$,'23514');
SELECT fvi_test.denied('SELECT public.revoke_user_delegated_api_token(''ca000000-0000-4000-8000-000000000001'',fvi_test.token())','23514');
RESET ROLE;
SELECT fvi_test.assert_true(NOT EXISTS(SELECT 1 FROM public.api_tokens WHERE token_hash=repeat('f',64)) AND EXISTS(SELECT 1 FROM public.api_tokens WHERE id=fvi_test.token() AND revoked_at IS NULL),'issuance/revoke rollback');
DROP TRIGGER zz_qa_audit_fail ON public.audit_log;
-- CASE: nonadmin/inactive/cross-tenant minting and scope/hash collision rejected
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000013',false);
SELECT fvi_test.denied($sql$SELECT public.issue_user_delegated_api_token('ca000000-0000-4000-8000-000000000001','No admin','fvi_ffffffff',repeat('f',64),ARRAY['recons.read'],NULL)$sql$,'42501');
SELECT set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000012',false);
SELECT fvi_test.denied($sql$SELECT public.issue_user_delegated_api_token('ca000000-0000-4000-8000-000000000002','Wrong tenant','fvi_ffffffff',repeat('f',64),ARRAY['recons.read'],NULL)$sql$,'42501');
SELECT fvi_test.denied($sql$SELECT public.issue_user_delegated_api_token('ca000000-0000-4000-8000-000000000001','Collision','fvi_aaaaaaaa',repeat('a',64),ARRAY['recons.read'],NULL)$sql$,'23505');
SELECT fvi_test.denied($sql$SELECT public.issue_user_delegated_api_token('ca000000-0000-4000-8000-000000000001','Wildcard','fvi_ffffffff',repeat('f',64),ARRAY['*'],NULL)$sql$,'22023');
RESET ROLE;
-- CASE: inactive administrator cannot mint or revoke under retained role metadata
BEGIN; UPDATE public.tenant_members SET active=false WHERE user_id='ca000000-0000-4000-8000-000000000012'; SET LOCAL ROLE authenticated;
SELECT fvi_test.denied($sql$SELECT public.issue_user_delegated_api_token('ca000000-0000-4000-8000-000000000001','Inactive','fvi_ffffffff',repeat('f',64),ARRAY['recons.read'],NULL)$sql$,'42501');
SELECT fvi_test.denied('SELECT public.revoke_user_delegated_api_token(''ca000000-0000-4000-8000-000000000001'',fvi_test.token())','42501'); ROLLBACK;
SET ROLE authenticated;
-- CASE: legitimate independent admin revokes existing unclassified token without relabelling
SELECT fvi_test.assert_true(public.revoke_user_delegated_api_token('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000021')->>'id'='ca000000-0000-4000-8000-000000000021','legacy revoke');
RESET ROLE;
SELECT fvi_test.assert_true((SELECT principal_kind='unclassified' AND subject_user_id IS NULL AND revoked_at IS NOT NULL FROM public.api_tokens WHERE id='ca000000-0000-4000-8000-000000000021'),'legacy identity intact on revoke');
SELECT 'native semantic qualification complete';
