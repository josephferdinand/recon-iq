-- Disposable DB only. Apply after the complete migration chain, then execute this file.
BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f4200000-0000-4000-8000-000000000001','Multi BU Regression','f4200000-0000-4000-8000-000000000002','Multi BU Regression'),
       ('f4200000-0000-4000-8000-000000000005','Multi BU Other Family','f4200000-0000-4000-8000-000000000006','Multi BU Other Family');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000001','multi-bu-regression','Multi BU Regression','dev'),
 ('f4200000-0000-4000-8000-000000000004','f4200000-0000-4000-8000-000000000005','multi-bu-other','Multi BU Other','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f4200000-0000-4000-8000-000000000011','multi-bu-admin@example.invalid',now(),now()),
 ('f4200000-0000-4000-8000-000000000012','multi-bu-member@example.invalid',now(),now()),
 ('f4200000-0000-4000-8000-000000000013','multi-bu-outsider@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000011','tenant_admin',true),
 ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000012','tenant_analyst',true),
 ('f4200000-0000-4000-8000-000000000004','f4200000-0000-4000-8000-000000000013','tenant_admin',true);
INSERT INTO public.tenant_groups(id,tenant_id,name) VALUES
 ('f4200000-0000-4000-8000-000000000031','f4200000-0000-4000-8000-000000000003','Local group'),
 ('f4200000-0000-4000-8000-000000000032','f4200000-0000-4000-8000-000000000004','Foreign group');
INSERT INTO public.business_units(id,tenant_id,name,code) VALUES
 ('f4200000-0000-4000-8000-000000000041','f4200000-0000-4000-8000-000000000003','Fund Accounting','FA'),
 ('f4200000-0000-4000-8000-000000000042','f4200000-0000-4000-8000-000000000003','Transfer Agency','TA'),
 ('f4200000-0000-4000-8000-000000000043','f4200000-0000-4000-8000-000000000004','Foreign BU','FB');
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES ('f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000003','Multi owner','two_sided','[]','[]','draft'),
       ('f4200000-0000-4000-8000-000000000022','f4200000-0000-4000-8000-000000000003','Legacy unclassified','two_sided','[]','[]','draft');

INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by) VALUES
 ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000041','f4200000-0000-4000-8000-000000000011'),
 ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000042','f4200000-0000-4000-8000-000000000011');
UPDATE public.recon_definitions SET multi_bu_governed=true WHERE id='f4200000-0000-4000-8000-000000000021';

DO $$ BEGIN
  BEGIN
    INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id)
    VALUES ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000043');
    RAISE EXCEPTION 'cross-tenant BU owner accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status,multi_bu_governed)
    VALUES ('f4200000-0000-4000-8000-000000000023','f4200000-0000-4000-8000-000000000003','Missing owner','two_sided','[]','[]','draft',true);
    RAISE EXCEPTION 'governed reconciliation without owner accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='governed reconciliation without owner accepted' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM public.recon_definition_business_units WHERE recon_id='f4200000-0000-4000-8000-000000000021' AND bu_id='f4200000-0000-4000-8000-000000000041';
    DELETE FROM public.recon_definition_business_units WHERE recon_id='f4200000-0000-4000-8000-000000000021' AND bu_id='f4200000-0000-4000-8000-000000000042';
    RAISE EXCEPTION 'last governed owner removed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='last governed owner removed' THEN RAISE; END IF; END;
END $$;

INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by) VALUES
 ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000041','user','f4200000-0000-4000-8000-000000000012','view','f4200000-0000-4000-8000-000000000011'),
 ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000042','group','f4200000-0000-4000-8000-000000000031','view','f4200000-0000-4000-8000-000000000011');
DO $$ DECLARE n integer; BEGIN
  SELECT count(DISTINCT principal_type) INTO n FROM public.recon_definition_bu_grants
  WHERE tenant_id='f4200000-0000-4000-8000-000000000003' AND recon_id='f4200000-0000-4000-8000-000000000021' AND action='view';
  IF n<>2 THEN RAISE EXCEPTION 'direct and group grants did not both contribute to union fixture'; END IF;
  BEGIN
    INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action)
    VALUES ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000041','user','f4200000-0000-4000-8000-000000000013','run');
    RAISE EXCEPTION 'cross-tenant user grant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant user grant accepted' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action)
    VALUES ('f4200000-0000-4000-8000-000000000003','f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000041','group','f4200000-0000-4000-8000-000000000032','run');
    RAISE EXCEPTION 'cross-tenant group grant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant group grant accepted' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.recon_definition_business_unit_audit SET changed_at=now();
    RAISE EXCEPTION 'owner audit mutation accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='owner audit mutation accepted' THEN RAISE; END IF; END;
END $$;

-- A pre-existing NULL bu_id is intentionally left unclassified and ungoverned.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.recon_definitions WHERE id='f4200000-0000-4000-8000-000000000022' AND bu_id IS NULL AND NOT multi_bu_governed)<>1 THEN
    RAISE EXCEPTION 'legacy NULL bu_id was silently governed or rewritten';
  END IF;
  IF (SELECT count(*) FROM public.recon_definition_business_unit_audit WHERE recon_id='f4200000-0000-4000-8000-000000000021' AND operation='INSERT')<>2 THEN
    RAISE EXCEPTION 'owner insert audit rows missing';
  END IF;
END $$;
ROLLBACK;
