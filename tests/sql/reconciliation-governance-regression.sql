BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f3000000-0000-4000-8000-000000000001','Recon Governance Evidence','f3000000-0000-4000-8000-000000000002','Recon Governance Evidence');
INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES ('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000001','recon-governance-evidence','Recon Governance Evidence','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f3000000-0000-4000-8000-000000000011','maker@example.invalid',now(),now()),
 ('f3000000-0000-4000-8000-000000000012','checker@example.invalid',now(),now()),
 ('f3000000-0000-4000-8000-000000000013','assignee@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000011','tenant_admin',true),
 ('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000012','tenant_admin',true),
 ('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000013','tenant_analyst',true);

INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES ('f3000000-0000-4000-8000-000000000021','f3000000-0000-4000-8000-000000000003','Governed Cash Recon','two_sided','[]','[]','active');
INSERT INTO public.recon_runs(id,tenant_id,definition_id,status,total_rows)
VALUES ('f3000000-0000-4000-8000-000000000022','f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000021','completed',2);
INSERT INTO public.recon_exceptions(id,run_id,tenant_id,reason,severity,status,tags,payload)
VALUES ('f3000000-0000-4000-8000-000000000023','f3000000-0000-4000-8000-000000000022','f3000000-0000-4000-8000-000000000003','Amount mismatch','high','open',ARRAY['cash'],'{}');
INSERT INTO public.recon_exceptions(id,run_id,tenant_id,reason,severity,status,lifecycle_state,tags,payload)
VALUES ('f3000000-0000-4000-8000-000000000027','f3000000-0000-4000-8000-000000000022','f3000000-0000-4000-8000-000000000003','Historical written-off break','high','open','written_off',ARRAY['cash'],'{}');
INSERT INTO public.exception_assignment_rules(id,tenant_id,recon_id,name,strategy,assignee_pool,enabled,created_by)
VALUES ('f3000000-0000-4000-8000-000000000024','f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000021','Cash Ops Round Robin','round_robin',ARRAY['f3000000-0000-4000-8000-000000000013'::uuid],true,'f3000000-0000-4000-8000-000000000011');
INSERT INTO public.proposed_matches(id,tenant_id,run_id,definition_id,members,cardinality,ml_score,ml_features,rule_hint)
VALUES ('f3000000-0000-4000-8000-000000000025','f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000022','f3000000-0000-4000-8000-000000000021','{"A":["cash-1"],"B":["ledger-1"]}','1:1',0.93,'{"amount_delta":0.01}','ml_amount_date');
INSERT INTO public.manual_match_approvals(id,tenant_id,run_id,exception_ids,members,cardinality,rationale,proposed_by)
VALUES ('f3000000-0000-4000-8000-000000000026','f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000022',ARRAY['f3000000-0000-4000-8000-000000000023'::uuid],'{"A":["cash-2"],"B":["ledger-2"]}','1:1','Evidence confirms same economic event','f3000000-0000-4000-8000-000000000011');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f3000000-0000-4000-8000-000000000011',true);
SELECT public.assign_exceptions_from_rule('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000024',ARRAY['f3000000-0000-4000-8000-000000000023'::uuid]);

DO $$
DECLARE replay jsonb;
BEGIN
  replay := public.assign_exceptions_from_rule(
    'f3000000-0000-4000-8000-000000000003',
    'f3000000-0000-4000-8000-000000000024',
    ARRAY['f3000000-0000-4000-8000-000000000023'::uuid]);
  IF replay->>'assigned'<>'0' OR replay->>'skipped'<>'1' THEN
    RAISE EXCEPTION 'already assigned exception was reassigned';
  END IF;
  IF (SELECT count(*) FROM public.audit_log
      WHERE action='exception.auto_assigned'
        AND resource_id='f3000000-0000-4000-8000-000000000023')<>1 THEN
    RAISE EXCEPTION 'replay created a second assignment audit';
  END IF;
  replay := public.assign_exceptions_from_rule(
    'f3000000-0000-4000-8000-000000000003',
    'f3000000-0000-4000-8000-000000000024',
    ARRAY['f3000000-0000-4000-8000-000000000027'::uuid]);
  IF replay->>'assigned'<>'0' OR replay->>'skipped'<>'1'
     OR EXISTS (SELECT 1 FROM public.recon_exceptions
       WHERE id='f3000000-0000-4000-8000-000000000027' AND assignee IS NOT NULL) THEN
    RAISE EXCEPTION 'written-off lifecycle exception was assigned';
  END IF;
  BEGIN
    PERFORM public.assign_exceptions_from_rule(
      'f3000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000024',
      array_fill('f3000000-0000-4000-8000-000000000023'::uuid,ARRAY[501]));
    RAISE EXCEPTION 'oversized assignment batch was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%assignment batch must contain 1 to 500%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.assign_exceptions_from_rule(
      'f3000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000024',
      ARRAY['f3000000-0000-4000-8000-000000000023'::uuid,
            'f3000000-0000-4000-8000-000000000023'::uuid]);
    RAISE EXCEPTION 'duplicate assignment IDs were accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%must be non-null and unique%' THEN RAISE; END IF;
  END;
END $$;

DO $$ BEGIN
  PERFORM public.decide_manual_match_atomic('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000026','approved',NULL);
  RAISE EXCEPTION 'maker self approval unexpectedly accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='maker self approval unexpectedly accepted' THEN RAISE; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','f3000000-0000-4000-8000-000000000012',true);
SELECT public.review_proposed_match_atomic('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000025','accepted','confidence reviewed');
SELECT public.decide_manual_match_atomic('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000026','approved',NULL);

DO $$
DECLARE replay jsonb;
BEGIN
  replay := public.assign_exceptions_from_rule(
    'f3000000-0000-4000-8000-000000000003',
    'f3000000-0000-4000-8000-000000000024',
    ARRAY['f3000000-0000-4000-8000-000000000023'::uuid]);
  IF replay->>'assigned'<>'0' OR replay->>'skipped'<>'1' THEN
    RAISE EXCEPTION 'resolved exception was reassigned';
  END IF;
END $$;

DO $$ BEGIN
  UPDATE public.proposed_matches SET review_note='direct bypass' WHERE id='f3000000-0000-4000-8000-000000000025';
  RAISE EXCEPTION 'direct proposed-match update unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

RESET ROLE;

DO $$ BEGIN
  IF (SELECT assignee FROM public.recon_exceptions WHERE id='f3000000-0000-4000-8000-000000000023') <> 'f3000000-0000-4000-8000-000000000013'::uuid THEN
    RAISE EXCEPTION 'assignment result is incorrect';
  END IF;
  IF (SELECT status FROM public.proposed_matches WHERE id='f3000000-0000-4000-8000-000000000025') <> 'accepted' THEN
    RAISE EXCEPTION 'proposed match decision missing';
  END IF;
  IF (SELECT count(*) FROM public.recon_match_feedback WHERE recon_id='f3000000-0000-4000-8000-000000000021') <> 1 THEN
    RAISE EXCEPTION 'proposed match feedback missing';
  END IF;
  IF (SELECT status FROM public.manual_match_approvals WHERE id='f3000000-0000-4000-8000-000000000026') <> 'approved' THEN
    RAISE EXCEPTION 'manual match approval missing';
  END IF;
  IF (SELECT status FROM public.recon_exceptions WHERE id='f3000000-0000-4000-8000-000000000023') <> 'resolved' THEN
    RAISE EXCEPTION 'manual match did not resolve the scoped exception';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE tenant_id='f3000000-0000-4000-8000-000000000003' AND action IN ('exception.auto_assigned','proposed_match.accepted','manual_match.approved')) <> 3 THEN
    RAISE EXCEPTION 'governance audit coverage is incomplete';
  END IF;
END $$;

SELECT 'reconciliation_governance_PASS assignment=yes proposed_feedback=yes manual_4eyes=yes audit=3' AS result;

COMMIT;
