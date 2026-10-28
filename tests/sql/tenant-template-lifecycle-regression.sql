BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('f6000000-0000-4000-8000-000000000001','My Templates Evidence A','f6000000-0000-4000-8000-000000000011','My Templates Evidence A'),
 ('f6000000-0000-4000-8000-000000000002','My Templates Evidence B','f6000000-0000-4000-8000-000000000012','My Templates Evidence B');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f6000000-0000-4000-8000-000000000003','f6000000-0000-4000-8000-000000000001','my-templates-a','My Templates A','dev'),
 ('f6000000-0000-4000-8000-000000000004','f6000000-0000-4000-8000-000000000002','my-templates-b','My Templates B','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f6000000-0000-4000-8000-000000000021','template-maker@example.invalid',now(),now()),
 ('f6000000-0000-4000-8000-000000000022','template-checker@example.invalid',now(),now()),
 ('f6000000-0000-4000-8000-000000000023','template-submitter@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f6000000-0000-4000-8000-000000000003','f6000000-0000-4000-8000-000000000021','tenant_admin',true),
 ('f6000000-0000-4000-8000-000000000003','f6000000-0000-4000-8000-000000000022','tenant_admin',true),
 ('f6000000-0000-4000-8000-000000000003','f6000000-0000-4000-8000-000000000023','tenant_admin',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,status,inferred_schema,sample_rows,row_count) VALUES
 ('f6000000-0000-4000-8000-000000000031','f6000000-0000-4000-8000-000000000003','Template A','csv','ready','{"reference":"text"}','[{"reference":"R1"}]',1),
 ('f6000000-0000-4000-8000-000000000032','f6000000-0000-4000-8000-000000000003','Template B','csv','ready','{"reference":"text"}','[{"reference":"R1"}]',1);
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status,created_by) VALUES
 ('f6000000-0000-4000-8000-000000000041','f6000000-0000-4000-8000-000000000003','Real Tenant Recon','two_sided',
  '[{"side_id":"A","label":"A","data_source_id":"f6000000-0000-4000-8000-000000000031"},{"side_id":"B","label":"B","data_source_id":"f6000000-0000-4000-8000-000000000032"}]',
  '[{"id":"reference","kind":"exact_match","fields":{"A":"reference","B":"reference"},"is_key":true}]','active','f6000000-0000-4000-8000-000000000021');

CREATE TEMP TABLE lifecycle_ids(template_id uuid,version_id uuid);
GRANT SELECT,INSERT,UPDATE ON lifecycle_ids TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000021',true);
INSERT INTO lifecycle_ids
SELECT tenant_template_id,version_id FROM public.save_tenant_template_from_recon_atomic(
  'f6000000-0000-4000-8000-000000000003','f6000000-0000-4000-8000-000000000041',
  'Cash Control Template','Versioned from a real reconciliation',NULL,'1.0.0','Initial version');
DO $$ BEGIN
  INSERT INTO public.tenant_templates(tenant_id,title,status,created_by)
  VALUES ('f6000000-0000-4000-8000-000000000003','Forged publication','published',auth.uid());
  RAISE EXCEPTION 'direct published insert unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO public.tenant_template_versions(tenant_template_id,tenant_id,semver,spec,created_by)
  VALUES ((SELECT template_id FROM lifecycle_ids),'f6000000-0000-4000-8000-000000000003','9.0.0','{}','f6000000-0000-4000-8000-000000000022');
  RAISE EXCEPTION 'forged version authorship unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM public.clone_tenant_template_atomic('f6000000-0000-4000-8000-000000000004',(SELECT template_id FROM lifecycle_ids),'Cross tenant clone');
  RAISE EXCEPTION 'cross-tenant clone unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'submit');
DO $$ BEGIN
  PERFORM public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'approve');
  RAISE EXCEPTION 'maker self-approval unexpectedly accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='maker self-approval unexpectedly accepted' THEN RAISE; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000022',true);
SELECT public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'approve');
SELECT public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'publish');
SELECT public.instantiate_tenant_template_atomic(
  'f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'Instantiated Cash Control');
DO $$ BEGIN
  UPDATE public.tenant_templates SET status='archived' WHERE id=(SELECT template_id FROM lifecycle_ids);
  RAISE EXCEPTION 'direct lifecycle update unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  UPDATE public.tenant_templates SET spec='{"kind":"reconciliation","rules":[]}' WHERE id=(SELECT template_id FROM lifecycle_ids);
  RAISE EXCEPTION 'post-approval content edit unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  UPDATE public.tenant_templates SET approved_by=auth.uid(),current_semver='9.0.0' WHERE id=(SELECT template_id FROM lifecycle_ids);
  RAISE EXCEPTION 'approval/version substitution unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  DELETE FROM public.tenant_templates WHERE id=(SELECT template_id FROM lifecycle_ids);
  RAISE EXCEPTION 'direct template deletion unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM public.instantiate_tenant_template_atomic('f6000000-0000-4000-8000-000000000004',(SELECT template_id FROM lifecycle_ids),'Cross tenant run');
  RAISE EXCEPTION 'cross-tenant instantiation unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'unpublish');
SELECT public.clone_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'Cash Control Template Copy');

-- A different author writes version 1.1.0 and a third actor submits it.
-- That version's author must still be unable to approve it.
SELECT public.save_tenant_template_from_recon_atomic(
  'f6000000-0000-4000-8000-000000000003','f6000000-0000-4000-8000-000000000041',
  'Cash Control Template','Second immutable snapshot',(SELECT template_id FROM lifecycle_ids),'1.1.0','Mapped fields reviewed');
DO $$ DECLARE changed integer; BEGIN
  UPDATE public.tenant_template_versions SET changelog='tampered' WHERE id=(SELECT version_id FROM lifecycle_ids);
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'immutable version update unexpectedly accepted'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  IF (SELECT status FROM public.tenant_templates WHERE id=(SELECT template_id FROM lifecycle_ids))<>'draft' THEN
    RAISE EXCEPTION 'new version did not reset approval';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000023',true);
SELECT public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'submit');
SELECT set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000022',true);
DO $$ BEGIN
  PERFORM public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'approve');
  RAISE EXCEPTION 'current version author self-approval unexpectedly accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='current version author self-approval unexpectedly accepted' THEN RAISE; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000021',true);
SELECT public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'approve');
SELECT public.transition_tenant_template_atomic('f6000000-0000-4000-8000-000000000003',(SELECT template_id FROM lifecycle_ids),'publish');
RESET ROLE;

DO $$
DECLARE original_id uuid:=(SELECT template_id FROM lifecycle_ids);
BEGIN
  IF (SELECT status FROM public.tenant_templates WHERE id=original_id)<>'published' THEN RAISE EXCEPTION 'independently reviewed version was not published'; END IF;
  IF (SELECT count(*) FROM public.tenant_template_versions WHERE tenant_template_id=original_id)<>2 THEN RAISE EXCEPTION 'version history is incomplete'; END IF;
  IF (SELECT count(*) FROM public.tenant_templates WHERE tenant_id='f6000000-0000-4000-8000-000000000003')<>2 THEN RAISE EXCEPTION 'clone was not retained'; END IF;
  IF (SELECT count(*) FROM public.recon_definitions WHERE tenant_template_id=original_id AND name='Instantiated Cash Control')<>1 THEN RAISE EXCEPTION 'published template was not instantiated'; END IF;
  IF (SELECT count(*) FROM public.mkt_audit_log WHERE tenant_id='f6000000-0000-4000-8000-000000000003'
      AND action IN ('create','submit','approve','publish','instantiate','unpublish','clone','version'))<>11 THEN
    RAISE EXCEPTION 'template lifecycle audit coverage is incomplete';
  END IF;
  -- FVI-CX-099: every transition audit must carry explicit immutable version correlation.
  -- The enriched after payload includes version_id + semver + source_recon_definition_id.
  IF EXISTS (
    SELECT 1 FROM public.mkt_audit_log
    WHERE tenant_id='f6000000-0000-4000-8000-000000000003'
      AND entity_type='tenant_template' AND entity_id=original_id
      AND action IN ('submit','approve','publish','unpublish')
      AND (after->>'version_id' IS NULL OR after->>'semver' IS NULL)
  ) THEN RAISE EXCEPTION 'transition audit is missing explicit version correlation (FVI-CX-099)'; END IF;
  -- An approved-version row must exist for correlation pairing (defensive proof).
  IF (SELECT count(*) FROM public.tenant_template_versions WHERE tenant_template_id=original_id AND semver='1.1.0')<>1 THEN
    RAISE EXCEPTION 'expected immutable version row is missing for correlation';
  END IF;
END $$;

SELECT 'tenant_template_lifecycle_PASS create=yes version=yes immutable=yes clone=yes four_eyes=yes current_author=yes direct_bypass=denied cross_tenant=denied publish=yes unpublish=yes instantiate=yes audit=11' AS result;
COMMIT;
