-- Disposable DB only. Apply after the complete migration chain, then execute this file.
BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES
 ('f3100000-0000-4000-8000-000000000001','Retirement Regression','f3100000-0000-4000-8000-000000000002','Retirement Regression'),
 ('f3100000-0000-4000-8000-000000000005','Retirement Other Family','f3100000-0000-4000-8000-000000000006','Retirement Other Family');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000001','retirement-regression','Retirement Regression','dev'),
 ('f3100000-0000-4000-8000-000000000004','f3100000-0000-4000-8000-000000000005','retirement-other-tenant','Retirement Other Tenant','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f3100000-0000-4000-8000-000000000011','retire-maker@example.invalid',now(),now()),
 ('f3100000-0000-4000-8000-000000000012','retire-checker@example.invalid',now(),now()),
 ('f3100000-0000-4000-8000-000000000013','retire-outsider@example.invalid',now(),now()),
 ('f3100000-0000-4000-8000-000000000014','retire-analyst@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000011','tenant_admin',true),
 ('f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000012','tenant_admin',true),
 ('f3100000-0000-4000-8000-000000000004','f3100000-0000-4000-8000-000000000013','tenant_admin',true),
 ('f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000014','tenant_analyst',true);
-- These fixtures model definitions that existed before the governance migration.
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status,governance_state,access_mode)
VALUES
 ('f3100000-0000-4000-8000-000000000021','f3100000-0000-4000-8000-000000000003','Retained Active','two_sided','[]','[]','active','legacy_unreviewed','legacy_passthrough'),
 ('f3100000-0000-4000-8000-000000000031','f3100000-0000-4000-8000-000000000003','Rejected Retirement','two_sided','[]','[]','active','legacy_unreviewed','legacy_passthrough'),
 ('f3100000-0000-4000-8000-000000000024','f3100000-0000-4000-8000-000000000003','Run Draft','two_sided','[]','[]','draft','legacy_unreviewed','legacy_passthrough'),
 ('f3100000-0000-4000-8000-000000000025','f3100000-0000-4000-8000-000000000003','Disposable Draft','two_sided','[]','[]','draft','legacy_unreviewed','legacy_passthrough');
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;
INSERT INTO public.recon_runs(id,tenant_id,definition_id,status,total_rows,run_uid)
VALUES ('f3100000-0000-4000-8000-000000000022','f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000021','completed',2,'R-RETIRE-A-20260924'),
 ('f3100000-0000-4000-8000-000000000026','f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000024','completed',1,'R-RETIRE-B-20260924');
INSERT INTO public.recon_matches(id,run_id,tenant_id,match_key,members)
VALUES ('f3100000-0000-4000-8000-000000000027','f3100000-0000-4000-8000-000000000022','f3100000-0000-4000-8000-000000000003','retained-match','{"A":["a1"],"B":["b1"]}');
INSERT INTO public.recon_exceptions(id,run_id,tenant_id,reason,severity,status,payload)
VALUES ('f3100000-0000-4000-8000-000000000028','f3100000-0000-4000-8000-000000000022','f3100000-0000-4000-8000-000000000003','Retained exception','high','open','{}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f3100000-0000-4000-8000-000000000011',true);
DO $$ DECLARE result record; rejected_result record; BEGIN
  BEGIN
    PERFORM * FROM public.request_recon_retirement('f3100000-0000-4000-8000-000000000004','f3100000-0000-4000-8000-000000000021','wrong tenant');
    RAISE EXCEPTION 'cross-tenant definition ID accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='cross-tenant definition ID accepted' THEN RAISE; END IF;
  END;
  SELECT * INTO result FROM public.request_recon_retirement(
    'f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000021','Owner approved retirement request');
  IF result.status<>'pending' OR result.retired_at IS NOT NULL THEN RAISE EXCEPTION 'unexpected request result'; END IF;
  SELECT * INTO rejected_result FROM public.request_recon_retirement(
    'f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000031','Owner requested a rejected retirement');
  IF rejected_result.status<>'pending' THEN RAISE EXCEPTION 'rejection request was not pending'; END IF;
  BEGIN
    PERFORM * FROM public.request_recon_retirement(
      'f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000021','duplicate');
    RAISE EXCEPTION 'duplicate pending request accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='duplicate pending request accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM public.decide_recon_retirement(result.request_id,true,'self approval');
    RAISE EXCEPTION 'requester self-approval accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='requester self-approval accepted' THEN RAISE; END IF;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','f3100000-0000-4000-8000-000000000014',true);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.request_recon_retirement(
      'f3100000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000021','analyst without retirement mapping');
    RAISE EXCEPTION 'tenant analyst bypassed unresolved BU and explicit retirement mapping';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='tenant analyst bypassed unresolved BU and explicit retirement mapping' THEN RAISE; END IF;
  END;
END $$;

-- service_role bypasses RLS, so the trigger must independently reject both paths.
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    UPDATE public.recon_definitions SET status='archived'
      WHERE id='f3100000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'direct service-role status retirement accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.recon_definitions SET status='draft'
      WHERE id='f3100000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'service-role downgraded active definition to draft';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.recon_definitions WHERE id='f3100000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'service-role deleted non-draft definition with history';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.recon_definitions WHERE id='f3100000-0000-4000-8000-000000000024';
    RAISE EXCEPTION 'service-role deleted draft definition with runs';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- A different active tenant checker approves; all run evidence remains queryable.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f3100000-0000-4000-8000-000000000012',true);
DO $$ DECLARE request_id uuid; rejected_request_id uuid; result record; rejected_result record; BEGIN
  SELECT id INTO request_id FROM public.recon_retirement_requests
    WHERE recon_id='f3100000-0000-4000-8000-000000000021' AND status='pending';
  SELECT * INTO result FROM public.decide_recon_retirement(request_id,true,'Independent checker approved');
  IF result.status<>'approved' OR result.retired_at IS NULL THEN RAISE EXCEPTION 'approval did not return tombstone'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id=result.recon_id
      AND status='archived' AND retired_at=result.retired_at AND retirement_request_id=request_id) THEN
    RAISE EXCEPTION 'approved retirement tombstone missing';
  END IF;
  IF (SELECT count(*) FROM public.recon_runs WHERE definition_id=result.recon_id)<>1
     OR (SELECT count(*) FROM public.recon_matches WHERE run_id='f3100000-0000-4000-8000-000000000022')<>1
     OR (SELECT count(*) FROM public.recon_exceptions WHERE run_id='f3100000-0000-4000-8000-000000000022')<>1
     OR NOT EXISTS (SELECT 1 FROM public.recon_runs WHERE id='f3100000-0000-4000-8000-000000000022'
        AND definition_snapshot IS NOT NULL) THEN
    RAISE EXCEPTION 'retirement removed run, match, or exception evidence';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE resource_type='recon_retirement_request'
       AND resource_id=request_id::text AND action IN ('recon.retirement.requested','recon.retirement.approved'))<>2 THEN
    RAISE EXCEPTION 'request and approval audit records missing';
  END IF;
  SELECT id INTO rejected_request_id FROM public.recon_retirement_requests
    WHERE recon_id='f3100000-0000-4000-8000-000000000031' AND status='pending';
  SELECT * INTO rejected_result FROM public.decide_recon_retirement(rejected_request_id,false,'Checker rejected with reason');
  IF rejected_result.status<>'rejected' OR rejected_result.retired_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id='f3100000-0000-4000-8000-000000000031'
        AND status='active' AND retired_at IS NULL) THEN
    RAISE EXCEPTION 'rejection changed definition lifecycle';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE resource_type='recon_retirement_request'
       AND resource_id=rejected_request_id::text
       AND action IN ('recon.retirement.requested','recon.retirement.rejected'))<>2 THEN
    RAISE EXCEPTION 'request and rejection audit records missing';
  END IF;
  BEGIN
    PERFORM * FROM public.decide_recon_retirement(request_id,true,'replay');
    RAISE EXCEPTION 'retirement decision replay accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='retirement decision replay accepted' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.recon_definitions SET retired_at=NULL,retirement_request_id=NULL,status='active'
      WHERE id=result.recon_id;
    RAISE EXCEPTION 'direct unretirement accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Unrun draft deletion remains available to its existing tenant editor.
SELECT set_config('request.jwt.claim.sub','f3100000-0000-4000-8000-000000000011',true);
DELETE FROM public.recon_definitions WHERE id='f3100000-0000-4000-8000-000000000025';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.recon_definitions WHERE id='f3100000-0000-4000-8000-000000000025') THEN
    RAISE EXCEPTION 'unrun draft deletion did not succeed';
  END IF;
END $$;

ROLLBACK;
