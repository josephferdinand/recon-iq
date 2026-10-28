-- Disposable DB only. Proves one owner-approved synthetic legacy mapping is
-- atomic, per-definition, actor-separated, audited, and preserves status/history/bu_id.
BEGIN;

INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by) VALUES
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000021','f4410000-0000-4000-8000-000000000042','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000022','f4410000-0000-4000-8000-000000000042','f4410000-0000-4000-8000-000000000011');
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by) VALUES
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000021','f4410000-0000-4000-8000-000000000042','user','f4410000-0000-4000-8000-000000000012','view','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000021','f4410000-0000-4000-8000-000000000042','user','f4410000-0000-4000-8000-000000000012','run','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000021','f4410000-0000-4000-8000-000000000042','user','f4410000-0000-4000-8000-000000000012','edit','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000021','f4410000-0000-4000-8000-000000000042','user','f4410000-0000-4000-8000-000000000013','view','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000021','f4410000-0000-4000-8000-000000000042','group','f4410000-0000-4000-8000-000000000045','approve','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000022','f4410000-0000-4000-8000-000000000042','user','f4410000-0000-4000-8000-000000000012','view','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000022','f4410000-0000-4000-8000-000000000042','user','f4410000-0000-4000-8000-000000000012','run','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000022','f4410000-0000-4000-8000-000000000042','user','f4410000-0000-4000-8000-000000000012','edit','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000022','f4410000-0000-4000-8000-000000000042','user','f4410000-0000-4000-8000-000000000013','view','f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000022','f4410000-0000-4000-8000-000000000042','group','f4410000-0000-4000-8000-000000000045','approve','f4410000-0000-4000-8000-000000000011');

DO $privileges$
BEGIN
  IF NOT has_function_privilege('authenticated',
      'public.cutover_legacy_recon_definition_mapping(uuid,uuid,uuid[],uuid,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated',
      'public.cutover_assurance_synthetic_recon_mapping(uuid,uuid,uuid[],uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role cannot call governed legacy mapping RPC';
  END IF;
  IF has_function_privilege('service_role',
      'public.cutover_legacy_recon_definition_mapping(uuid,uuid,uuid[],uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('anon',
      'public.cutover_assurance_synthetic_recon_mapping(uuid,uuid,uuid[],uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'legacy mapping RPC has an unsafe execution grant';
  END IF;
END
$privileges$;

CREATE FUNCTION pg_temp.reject_legacy_mapping_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action='recon.legacy_mapping.cutover'
     AND current_setting('fvi.test_fail_legacy_mapping_audit',true)='1' THEN
    RAISE EXCEPTION 'synthetic audit sink failure' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER legacy_mapping_audit_failure_fixture
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_legacy_mapping_audit();

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4410000-0000-4000-8000-000000000011',true);
DO $cutover$
DECLARE result jsonb; failed boolean:=false;
BEGIN
  PERFORM set_config('fvi.test_fail_legacy_mapping_audit','1',true);
  BEGIN
    PERFORM public.cutover_assurance_synthetic_recon_mapping(
      'f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000021',
      ARRAY['f4410000-0000-4000-8000-000000000042'::uuid],
      'f4410000-0000-4000-8000-000000000012','f4410000-0000-4000-8000-000000000013',
      'Owner-approved disposable mapping regression'
    );
  EXCEPTION WHEN OTHERS THEN failed:=true; END;
  PERFORM set_config('fvi.test_fail_legacy_mapping_audit','0',true);
  IF NOT failed THEN
    RAISE EXCEPTION 'audit failure did not abort the cutover';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id='f4410000-0000-4000-8000-000000000021'
      AND access_mode='legacy_passthrough' AND governance_state='legacy_unreviewed'
      AND status='active' AND bu_id IS NULL) THEN
    RAISE EXCEPTION 'failed cutover changed legacy definition state';
  END IF;

  result:=public.cutover_assurance_synthetic_recon_mapping(
    'f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000021',
    ARRAY['f4410000-0000-4000-8000-000000000042'::uuid],
    'f4410000-0000-4000-8000-000000000012','f4410000-0000-4000-8000-000000000013',
    'Owner-approved disposable mapping regression'
  );
  IF result->>'access_mode'<>'mapped_exact' OR result->>'governance_state'<>'legacy_mapped'
     OR result->>'status'<>'active' OR result->>'legacy_bu_id' IS NOT NULL THEN
    RAISE EXCEPTION 'cutover did not return the preserved definition state';
  END IF;

  failed:=false;
  BEGIN
    PERFORM public.cutover_assurance_synthetic_recon_mapping(
      'f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000022',
      ARRAY['f4410000-0000-4000-8000-000000000042'::uuid],
      'f4410000-0000-4000-8000-000000000012','f4410000-0000-4000-8000-000000000013',
      'Sibling mapping should not be in the Assurance list'
    );
  EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
  IF NOT failed THEN RAISE EXCEPTION 'Assurance wrapper accepted a sibling public ID'; END IF;

  failed:=false;
  BEGIN
    PERFORM public.cutover_assurance_synthetic_recon_mapping(
      'f4410000-0000-4000-8000-000000000004','f4410000-0000-4000-8000-000000000021',
      ARRAY['f4410000-0000-4000-8000-000000000042'::uuid],
      'f4410000-0000-4000-8000-000000000012','f4410000-0000-4000-8000-000000000013',
      'Cross-tenant mapping should fail'
    );
  EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
  IF NOT failed THEN RAISE EXCEPTION 'cross-tenant cutover was accepted'; END IF;

  PERFORM set_config('request.jwt.claim.sub','f4410000-0000-4000-8000-000000000012',true);
  IF NOT public.recon_authoritative_access_decision('f4410000-0000-4000-8000-000000000021','view')
     OR NOT public.recon_authoritative_access_decision('f4410000-0000-4000-8000-000000000021','run')
     OR NOT public.recon_authoritative_access_decision('f4410000-0000-4000-8000-000000000021','edit')
     OR public.recon_authoritative_access_decision('f4410000-0000-4000-8000-000000000021','approve') THEN
    RAISE EXCEPTION 'maker action grants or separation of duties are incorrect';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','f4410000-0000-4000-8000-000000000013',true);
  IF NOT public.recon_authoritative_access_decision('f4410000-0000-4000-8000-000000000021','approve')
     OR public.recon_authoritative_access_decision('f4410000-0000-4000-8000-000000000021','edit') THEN
    RAISE EXCEPTION 'checker group action grant or separation of duties is incorrect';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','f4410000-0000-4000-8000-000000000011',true);
  failed:=false;
  BEGIN
    UPDATE public.recon_definitions SET multi_bu_governed=true
    WHERE id='f4410000-0000-4000-8000-000000000022';
  EXCEPTION WHEN check_violation THEN failed:=true; END;
  IF NOT failed THEN RAISE EXCEPTION 'direct shadow opt-in bypassed the governed mapping RPC'; END IF;
  failed:=false;
  BEGIN
    UPDATE public.recon_definitions SET access_mode='mapped_exact',
      governance_state='legacy_mapped',multi_bu_governed=true
    WHERE id='f4410000-0000-4000-8000-000000000022';
  EXCEPTION WHEN check_violation THEN failed:=true; END;
  IF NOT failed OR NOT EXISTS (SELECT 1 FROM public.recon_definitions
      WHERE id='f4410000-0000-4000-8000-000000000022'
        AND access_mode='legacy_passthrough' AND governance_state='legacy_unreviewed'
        AND status='draft' AND bu_id IS NULL) THEN
    RAISE EXCEPTION 'direct role update bypassed governed legacy cutover';
  END IF;
END
$cutover$;

RESET ROLE;
DO $audit_evidence$
BEGIN
  IF (SELECT count(*) FROM private.recon_legacy_mapping_cutover_receipts
      WHERE tenant_id='f4410000-0000-4000-8000-000000000003'
        AND recon_id='f4410000-0000-4000-8000-000000000021')<>1
     OR (SELECT count(*) FROM public.recon_definition_bu_admin_audit
        WHERE tenant_id='f4410000-0000-4000-8000-000000000003'
          AND recon_id='f4410000-0000-4000-8000-000000000021' AND operation='map_legacy')<>1
     OR (SELECT count(*) FROM public.audit_log WHERE tenant_id='f4410000-0000-4000-8000-000000000003'
        AND resource_id='f4410000-0000-4000-8000-000000000021'
        AND action='recon.legacy_mapping.cutover')<>1 THEN
    RAISE EXCEPTION 'cutover receipt or immutable audit evidence is missing/duplicated';
  END IF;
END
$audit_evidence$;

ROLLBACK;
