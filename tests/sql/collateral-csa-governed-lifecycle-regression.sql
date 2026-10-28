-- Disposable DB only. Apply the complete migration chain, then execute this file.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('c5a10000-0000-4000-8000-000000000001','CSA Regression','c5a10000-0000-4000-8000-000000000011','CSA Regression'),
 ('c5a10000-0000-4000-8000-000000000002','CSA Foreign','c5a10000-0000-4000-8000-000000000012','CSA Foreign');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('c5a10000-0000-4000-8000-000000000003','c5a10000-0000-4000-8000-000000000001','csa-regression','CSA Regression','dev'),
 ('c5a10000-0000-4000-8000-000000000004','c5a10000-0000-4000-8000-000000000002','csa-foreign','CSA Foreign','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('c5a10000-0000-4000-8000-000000000011','csa-maker@example.invalid',now(),now()),
 ('c5a10000-0000-4000-8000-000000000012','csa-checker@example.invalid',now(),now()),
 ('c5a10000-0000-4000-8000-000000000013','csa-disputer@example.invalid',now(),now()),
 ('c5a10000-0000-4000-8000-000000000014','csa-resolver@example.invalid',now(),now()),
 ('c5a10000-0000-4000-8000-000000000015','csa-foreign@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('c5a10000-0000-4000-8000-000000000003','c5a10000-0000-4000-8000-000000000011','tenant_admin',true),
 ('c5a10000-0000-4000-8000-000000000003','c5a10000-0000-4000-8000-000000000012','tenant_admin',true),
 ('c5a10000-0000-4000-8000-000000000003','c5a10000-0000-4000-8000-000000000013','tenant_admin',true),
 ('c5a10000-0000-4000-8000-000000000003','c5a10000-0000-4000-8000-000000000014','tenant_admin',true),
 ('c5a10000-0000-4000-8000-000000000004','c5a10000-0000-4000-8000-000000000015','tenant_admin',true);

CREATE TEMP TABLE csa_ids(label text PRIMARY KEY, agreement_id uuid, version_id uuid, call_id uuid, dispute_id uuid);
GRANT SELECT,INSERT,UPDATE ON csa_ids TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c5a10000-0000-4000-8000-000000000011',true);

INSERT INTO csa_ids(label,agreement_id,version_id)
SELECT 'v1',agreement_id,version_id FROM public.create_collateral_csa_draft(
  'c5a10000-0000-4000-8000-000000000003',NULL,'CSA-REG-001','Entity A','Counterparty B','USD',10,20,10,
  '2026-01-01','2026-12-31','{"scope":"bilateral_vm","valuation_source":"operator supplied"}', 'draft-create-001');
DO $$ DECLARE first_row record; replay_row record; BEGIN
  SELECT * INTO first_row FROM csa_ids WHERE label='v1';
  SELECT * INTO replay_row FROM public.create_collateral_csa_draft(
    'c5a10000-0000-4000-8000-000000000003',NULL,'CSA-REG-001','Entity A','Counterparty B','USD',10,20,10,
    '2026-01-01','2026-12-31','{"scope":"bilateral_vm","valuation_source":"operator supplied"}', 'draft-create-001');
  IF replay_row.agreement_id<>first_row.agreement_id OR replay_row.version_id<>first_row.version_id OR NOT replay_row.replayed THEN
    RAISE EXCEPTION 'agreement creation replay was not idempotent';
  END IF;
  BEGIN
    PERFORM * FROM public.create_collateral_csa_draft(
      'c5a10000-0000-4000-8000-000000000004',(SELECT agreement_id FROM csa_ids WHERE label='v1'),
      'CSA-REG-001','Entity A','Counterparty B','USD',10,20,10,'2026-01-01','2026-12-31','{}','foreign-key-001');
    RAISE EXCEPTION 'cross-tenant agreement reference accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.collateral_csa_versions SET terms_snapshot='{"tampered":true}' WHERE id=(SELECT version_id FROM csa_ids WHERE label='v1');
    RAISE EXCEPTION 'direct version mutation unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT public.submit_collateral_csa_version('c5a10000-0000-4000-8000-000000000003',(SELECT version_id FROM csa_ids WHERE label='v1'));
DO $$ BEGIN
  BEGIN
    PERFORM public.decide_collateral_csa_version('c5a10000-0000-4000-8000-000000000003',(SELECT version_id FROM csa_ids WHERE label='v1'),true,'self approval');
    RAISE EXCEPTION 'version maker self-approval unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','c5a10000-0000-4000-8000-000000000012',true);
SELECT public.decide_collateral_csa_version('c5a10000-0000-4000-8000-000000000003',(SELECT version_id FROM csa_ids WHERE label='v1'),true,'Independent checker approval');
SELECT set_config('request.jwt.claim.sub','c5a10000-0000-4000-8000-000000000011',true);
INSERT INTO csa_ids(label,call_id)
SELECT 'call1',call_id FROM public.calculate_collateral_vm_call(
  'c5a10000-0000-4000-8000-000000000003',(SELECT version_id FROM csa_ids WHERE label='v1'),'2026-06-30',150,20,'vm-calc-001');
DO $$ DECLARE first_call record; replay_call record; BEGIN
  SELECT * INTO first_call FROM csa_ids WHERE label='call1';
  SELECT * INTO replay_call FROM public.calculate_collateral_vm_call(
    'c5a10000-0000-4000-8000-000000000003',(SELECT version_id FROM csa_ids WHERE label='v1'),'2026-06-30',150,20,'vm-calc-001');
  IF replay_call.call_id<>first_call.call_id OR replay_call.call_amount<>120 OR replay_call.direction<>'counterparty_to_us' OR NOT replay_call.replayed THEN
    RAISE EXCEPTION 'call snapshot or idempotent replay mismatch';
  END IF;
  BEGIN
    PERFORM * FROM public.calculate_collateral_vm_call(
      'c5a10000-0000-4000-8000-000000000004',(SELECT version_id FROM csa_ids WHERE label='v1'),'2026-06-30',150,20,'foreign-call-001');
    RAISE EXCEPTION 'cross-tenant calculation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.approve_collateral_vm_call('c5a10000-0000-4000-8000-000000000003',(SELECT call_id FROM csa_ids WHERE label='call1'));
    RAISE EXCEPTION 'call maker self-approval unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','c5a10000-0000-4000-8000-000000000012',true);
SELECT public.approve_collateral_vm_call('c5a10000-0000-4000-8000-000000000003',(SELECT call_id FROM csa_ids WHERE label='call1'));

SELECT set_config('request.jwt.claim.sub','c5a10000-0000-4000-8000-000000000013',true);
INSERT INTO csa_ids(label,dispute_id)
SELECT 'dispute1',public.dispute_collateral_vm_call('c5a10000-0000-4000-8000-000000000003',
  (SELECT call_id FROM csa_ids WHERE label='call1'),30,'Counterparty valuation differs','dispute-001');
DO $$ DECLARE dispute_id uuid; replay_id uuid; BEGIN
  SELECT csa_ids.dispute_id INTO dispute_id FROM csa_ids WHERE label='dispute1';
  replay_id := public.dispute_collateral_vm_call('c5a10000-0000-4000-8000-000000000003',
    (SELECT call_id FROM csa_ids WHERE label='call1'),30,'Counterparty valuation differs','dispute-001');
  IF replay_id<>dispute_id THEN RAISE EXCEPTION 'dispute replay changed identity'; END IF;
  BEGIN
    PERFORM public.record_collateral_vm_settlement('c5a10000-0000-4000-8000-000000000003',
      (SELECT call_id FROM csa_ids WHERE label='call1'),10,'SET-1','settlement-blocked');
    RAISE EXCEPTION 'settlement of disputed call unexpectedly accepted';
  EXCEPTION WHEN data_exception THEN
    IF SQLERRM='settlement of disputed call unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','c5a10000-0000-4000-8000-000000000014',true);
SELECT public.resolve_collateral_vm_dispute('c5a10000-0000-4000-8000-000000000003',(SELECT dispute_id FROM csa_ids WHERE label='dispute1'),'Counterparty evidence reviewed; call confirmed');
DO $$ DECLARE result record; BEGIN
  SELECT * INTO result FROM public.record_collateral_vm_settlement('c5a10000-0000-4000-8000-000000000003',
    (SELECT call_id FROM csa_ids WHERE label='call1'),50,'SET-CSA-001','settlement-001');
  IF result.call_status<>'partially_settled' OR result.replayed THEN RAISE EXCEPTION 'partial settlement state mismatch'; END IF;
  SELECT * INTO result FROM public.record_collateral_vm_settlement('c5a10000-0000-4000-8000-000000000003',
    (SELECT call_id FROM csa_ids WHERE label='call1'),50,'SET-CSA-001','settlement-001');
  IF result.call_status<>'partially_settled' OR NOT result.replayed THEN RAISE EXCEPTION 'settlement replay mismatch'; END IF;
  SELECT * INTO result FROM public.record_collateral_vm_settlement('c5a10000-0000-4000-8000-000000000003',
    (SELECT call_id FROM csa_ids WHERE label='call1'),70,'SET-CSA-002','settlement-002');
  IF result.call_status<>'settled' OR result.replayed THEN RAISE EXCEPTION 'final settlement state mismatch'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','c5a10000-0000-4000-8000-000000000015',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.collateral_csa_agreements WHERE id=(SELECT agreement_id FROM csa_ids WHERE label='v1')) THEN
    RAISE EXCEPTION 'foreign tenant could read CSA agreement';
  END IF;
  BEGIN
    PERFORM public.submit_collateral_csa_version('c5a10000-0000-4000-8000-000000000003',(SELECT version_id FROM csa_ids WHERE label='v1'));
    RAISE EXCEPTION 'foreign tenant could transition CSA version';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.audit_log WHERE tenant_id='c5a10000-0000-4000-8000-000000000003'
       AND resource_type IN ('collateral_csa_version','collateral_csa_call'))<>9 THEN
    RAISE EXCEPTION 'expected 9 atomic lifecycle audit entries, found %',
      (SELECT count(*) FROM public.audit_log WHERE tenant_id='c5a10000-0000-4000-8000-000000000003'
       AND resource_type IN ('collateral_csa_version','collateral_csa_call'));
  END IF;
  IF (SELECT status FROM public.collateral_csa_calls WHERE id=(SELECT call_id FROM csa_ids WHERE label='call1'))<>'settled'
    OR (SELECT settled_amount FROM public.collateral_csa_calls WHERE id=(SELECT call_id FROM csa_ids WHERE label='call1'))<>120 THEN
    RAISE EXCEPTION 'settlement readback mismatch';
  END IF;
END $$;
ROLLBACK;
SELECT 'collateral_csa_governed_lifecycle_PASS maker_checker=yes tenant_isolation=yes version_snapshot=yes call_snapshot=yes dispute=yes partial_full_settlement=yes idempotency=yes audit=yes hosted=no';
