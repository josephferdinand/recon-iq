-- Disposable PG15 only. Synthetic encrypted envelopes; fixture rolls back.
BEGIN;
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('e9030000-0000-4000-8000-000000000001','Vault A','e9030000-0000-4000-8000-000000000011','Vault A'),
 ('e9030000-0000-4000-8000-000000000002','Vault B','e9030000-0000-4000-8000-000000000012','Vault B');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('e9030000-0000-4000-8000-000000000101','e9030000-0000-4000-8000-000000000001','vault-boundary-a','Vault A','dev'),
 ('e9030000-0000-4000-8000-000000000102','e9030000-0000-4000-8000-000000000002','vault-boundary-b','Vault B','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('e9030000-0000-4000-8000-000000000201','vault-active-a@example.invalid',now(),now()),
 ('e9030000-0000-4000-8000-000000000202','vault-active-b@example.invalid',now(),now()),
 ('e9030000-0000-4000-8000-000000000203','vault-inactive-a@example.invalid',now(),now()),
 ('e9030000-0000-4000-8000-000000000204','vault-platform@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('e9030000-0000-4000-8000-000000000101','e9030000-0000-4000-8000-000000000201','tenant_admin',true),
 ('e9030000-0000-4000-8000-000000000102','e9030000-0000-4000-8000-000000000202','tenant_admin',true),
 ('e9030000-0000-4000-8000-000000000101','e9030000-0000-4000-8000-000000000203','tenant_admin',false);
INSERT INTO public.platform_roles(user_id,role) VALUES
 ('e9030000-0000-4000-8000-000000000204','platform_admin');
INSERT INTO public.app_vault_secrets(id,scope,tenant_id,secret_class,name,ciphertext,iv,auth_tag,wrapped_dek,fingerprint_sha256) VALUES
 ('e9030000-0000-4000-8000-000000000301','tenant','e9030000-0000-4000-8000-000000000101','llm_api_key','TEST_A',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'synthetic-a'),
 ('e9030000-0000-4000-8000-000000000302','tenant','e9030000-0000-4000-8000-000000000102','llm_api_key','TEST_B',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'synthetic-b'),
 ('e9030000-0000-4000-8000-000000000303','platform',NULL,'llm_api_key','TEST_PLATFORM',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'synthetic-platform');
INSERT INTO public.app_vault_kms_bindings(id,scope,tenant_id,provider,key_ref) VALUES
 ('e9030000-0000-4000-8000-000000000401','tenant','e9030000-0000-4000-8000-000000000101','meta_managed','synthetic-a'),
 ('e9030000-0000-4000-8000-000000000402','tenant','e9030000-0000-4000-8000-000000000102','meta_managed','synthetic-b'),
 ('e9030000-0000-4000-8000-000000000403','platform',NULL,'meta_managed','synthetic-platform');
INSERT INTO public.app_vault_rotation_log(id,secret_id,from_version,to_version,from_fingerprint,to_fingerprint,kek_provider,kek_ref) VALUES
 ('e9030000-0000-4000-8000-000000000501','e9030000-0000-4000-8000-000000000301',1,2,'synthetic-a','synthetic-a2','meta_managed','synthetic'),
 ('e9030000-0000-4000-8000-000000000502','e9030000-0000-4000-8000-000000000302',1,2,'synthetic-b','synthetic-b2','meta_managed','synthetic'),
 ('e9030000-0000-4000-8000-000000000503','e9030000-0000-4000-8000-000000000303',1,2,'synthetic-platform','synthetic-platform2','meta_managed','synthetic');
INSERT INTO public.app_vault_secret_versions(id,secret_id,version,scope,tenant_id,secret_class,name,ciphertext,iv,auth_tag,wrapped_dek,kek_provider,kek_ref,fingerprint_sha256,change_kind) VALUES
 ('e9030000-0000-4000-8000-000000000601','e9030000-0000-4000-8000-000000000301',1,'tenant','e9030000-0000-4000-8000-000000000101','llm_api_key','TEST_A',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'meta_managed','synthetic','synthetic-a','create'),
 ('e9030000-0000-4000-8000-000000000602','e9030000-0000-4000-8000-000000000302',1,'tenant','e9030000-0000-4000-8000-000000000102','llm_api_key','TEST_B',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'meta_managed','synthetic','synthetic-b','create'),
 ('e9030000-0000-4000-8000-000000000603','e9030000-0000-4000-8000-000000000303',1,'platform',NULL,'llm_api_key','TEST_PLATFORM',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'meta_managed','synthetic','synthetic-platform','create');

CREATE FUNCTION pg_temp.assert_vault(expected_suffix text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
  SELECT string_agg(visible_table || '=' || visible_names, ';' ORDER BY visible_table) INTO actual FROM (
    SELECT 'bindings' AS visible_table, coalesce(string_agg(key_ref, ',' ORDER BY key_ref),'') AS visible_names FROM public.app_vault_kms_bindings WHERE id::text LIKE 'e903%'
    UNION ALL SELECT 'rotation', coalesce(string_agg(to_fingerprint, ',' ORDER BY to_fingerprint),'') FROM public.app_vault_rotation_log WHERE id::text LIKE 'e903%'
    UNION ALL SELECT 'secrets', coalesce(string_agg(name, ',' ORDER BY name),'') FROM public.app_vault_secrets WHERE id::text LIKE 'e903%'
    UNION ALL SELECT 'versions', coalesce(string_agg(name, ',' ORDER BY name),'') FROM public.app_vault_secret_versions WHERE id::text LIKE 'e903%'
  ) q;
  IF actual <> expected_suffix THEN RAISE EXCEPTION 'Vault visibility mismatch: %', actual; END IF;
END $$;

CREATE FUNCTION pg_temp.expect_vault_denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected vault write denial';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e9030000-0000-4000-8000-000000000201',true);
SELECT pg_temp.assert_vault('bindings=synthetic-a;rotation=synthetic-a2;secrets=TEST_A;versions=TEST_A');
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_secrets(scope,tenant_id,secret_class,name,ciphertext,iv,auth_tag,wrapped_dek,fingerprint_sha256) VALUES ('tenant','e9030000-0000-4000-8000-000000000102','llm_api_key','ILLEGAL',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'x')$q$);
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_kms_bindings(scope,tenant_id,provider,key_ref) VALUES ('tenant','e9030000-0000-4000-8000-000000000102','meta_managed','illegal')$q$);
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_rotation_log(secret_id,from_version,to_version,from_fingerprint,to_fingerprint,kek_provider,kek_ref) VALUES ('e9030000-0000-4000-8000-000000000302',2,3,'x','y','meta_managed','illegal')$q$);
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_secret_versions(secret_id,version,scope,tenant_id,secret_class,name,ciphertext,iv,auth_tag,wrapped_dek,kek_provider,kek_ref,fingerprint_sha256,change_kind) VALUES ('e9030000-0000-4000-8000-000000000302',2,'tenant','e9030000-0000-4000-8000-000000000102','llm_api_key','ILLEGAL',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'meta_managed','illegal','x','rotate')$q$);
DO $$ DECLARE changed integer; BEGIN
  UPDATE public.app_vault_secrets SET fingerprint_sha256='synthetic-a-updated'
  WHERE id='e9030000-0000-4000-8000-000000000301';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'active tenant admin cannot update own vault secret'; END IF;
  UPDATE public.app_vault_kms_bindings SET status='disabled'
  WHERE id='e9030000-0000-4000-8000-000000000401';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'active tenant admin cannot update own KMS binding'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','e9030000-0000-4000-8000-000000000202',true);
SELECT pg_temp.assert_vault('bindings=synthetic-b;rotation=synthetic-b2;secrets=TEST_B;versions=TEST_B');
SELECT set_config('request.jwt.claim.sub','e9030000-0000-4000-8000-000000000203',true);
SELECT pg_temp.assert_vault('bindings=;rotation=;secrets=;versions=');
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_secrets(scope,tenant_id,secret_class,name,ciphertext,iv,auth_tag,wrapped_dek,fingerprint_sha256) VALUES ('tenant','e9030000-0000-4000-8000-000000000101','llm_api_key','ILLEGAL',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'x')$q$);
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_kms_bindings(scope,tenant_id,provider,key_ref) VALUES ('tenant','e9030000-0000-4000-8000-000000000101','meta_managed','illegal')$q$);
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_rotation_log(secret_id,from_version,to_version,from_fingerprint,to_fingerprint,kek_provider,kek_ref) VALUES ('e9030000-0000-4000-8000-000000000301',2,3,'x','y','meta_managed','illegal')$q$);
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_secret_versions(secret_id,version,scope,tenant_id,secret_class,name,ciphertext,iv,auth_tag,wrapped_dek,kek_provider,kek_ref,fingerprint_sha256,change_kind) VALUES ('e9030000-0000-4000-8000-000000000301',2,'tenant','e9030000-0000-4000-8000-000000000101','llm_api_key','ILLEGAL',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'meta_managed','illegal','x','rotate')$q$);
SELECT set_config('request.jwt.claim.sub','e9030000-0000-4000-8000-000000000204',true);
SELECT pg_temp.assert_vault('bindings=synthetic-platform;rotation=synthetic-platform2;secrets=TEST_PLATFORM;versions=TEST_PLATFORM');
SELECT pg_temp.expect_vault_denied($q$INSERT INTO public.app_vault_secrets(scope,tenant_id,secret_class,name,ciphertext,iv,auth_tag,wrapped_dek,fingerprint_sha256) VALUES ('tenant','e9030000-0000-4000-8000-000000000101','llm_api_key','ILLEGAL',decode('01','hex'),decode('02','hex'),decode('03','hex'),decode('04','hex'),'x')$q$);
DO $$ DECLARE changed integer; BEGIN
  UPDATE public.app_vault_secrets SET fingerprint_sha256='synthetic-platform-updated'
  WHERE id='e9030000-0000-4000-8000-000000000303';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'platform admin cannot update platform vault secret'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_vault('bindings=;rotation=;secrets=;versions=');
RESET ROLE;
ROLLBACK;
