-- Run after migrations on a disposable database: psql -v ON_ERROR_STOP=1 -f this_file.sql
BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('c7100000-0000-4000-8000-000000000001','Run Result Count QA','c7100000-0000-4000-8000-000000000002','Run Result Count QA'),
       ('c7100000-0000-4000-8000-000000000003','Run Result Other Tenant','c7100000-0000-4000-8000-000000000004','Run Result Other Tenant');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000001','run-result-qa','Run Result Count QA','dev'),
 ('c7100000-0000-4000-8000-000000000012','c7100000-0000-4000-8000-000000000003','run-result-other','Run Result Other Tenant','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('c7100000-0000-4000-8000-000000000021','run-result-qa@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000021','tenant_admin',true);
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status) VALUES
 ('c7100000-0000-4000-8000-000000000031','c7100000-0000-4000-8000-000000000011','One-side','one_sided','[{"side_id":"A"}]','[]','active'),
 ('c7100000-0000-4000-8000-000000000032','c7100000-0000-4000-8000-000000000011','Two-side','two_sided','[{"side_id":"A"},{"side_id":"B"}]','[]','active'),
 ('c7100000-0000-4000-8000-000000000033','c7100000-0000-4000-8000-000000000011','Three-side','three_sided','[{"side_id":"A"},{"side_id":"B"},{"side_id":"C"}]','[]','active'),
 ('c7100000-0000-4000-8000-000000000034','c7100000-0000-4000-8000-000000000012','Other tenant','one_sided','[{"side_id":"A"}]','[]','active');
INSERT INTO public.recon_runs(id,run_uid,tenant_id,definition_id,status) VALUES
 ('c7100000-0000-4000-8000-000000000041','FVI-RUN-RESULT-ONE','c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000031','completed'),
 ('c7100000-0000-4000-8000-000000000042','FVI-RUN-RESULT-TWO','c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000032','completed'),
 ('c7100000-0000-4000-8000-000000000043','FVI-RUN-RESULT-THREE','c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000033','completed'),
 ('c7100000-0000-4000-8000-000000000044','FVI-RUN-RESULT-OTHER','c7100000-0000-4000-8000-000000000012','c7100000-0000-4000-8000-000000000034','completed');
INSERT INTO public.recon_matches(id,run_id,tenant_id,cardinality,members) VALUES
 ('c7100000-0000-4000-8000-000000000051','c7100000-0000-4000-8000-000000000041','c7100000-0000-4000-8000-000000000011','1:1','{"A":[{"account":"one"}]}'),
 ('c7100000-0000-4000-8000-000000000052','c7100000-0000-4000-8000-000000000042','c7100000-0000-4000-8000-000000000011','1:1','{"A":[{"account":"two-a"}],"B":[{"account":"two-b"}]}'),
 ('c7100000-0000-4000-8000-000000000053','c7100000-0000-4000-8000-000000000043','c7100000-0000-4000-8000-000000000011','1:1','{"A":[{"account":"three-a"}],"B":[{"account":"three-b"}],"C":[{"account":"three-c"}]}'),
 ('c7100000-0000-4000-8000-000000000054','c7100000-0000-4000-8000-000000000043','c7100000-0000-4000-8000-000000000011','2:1:1','{"A":[{"account":"multi-a1"},{"account":"multi-a2"}],"B":[{"account":"multi-b"}],"C":[{"account":"multi-c"}]}');
INSERT INTO public.recon_exceptions(id,run_id,tenant_id,side,reason,payload) VALUES
 ('c7100000-0000-4000-8000-000000000061','c7100000-0000-4000-8000-000000000041','c7100000-0000-4000-8000-000000000011','A','Keyless','{"disposition":"keyless_input","row":{"account":"bad"}}'),
 ('c7100000-0000-4000-8000-000000000062','c7100000-0000-4000-8000-000000000041','c7100000-0000-4000-8000-000000000011','A','Legacy unknown','{}'),
 ('c7100000-0000-4000-8000-000000000070','c7100000-0000-4000-8000-000000000041','c7100000-0000-4000-8000-000000000011','A','Overlapping legacy markers','{"disposition":"keyless_input","missing_sides":["B"],"rule_kind":"unique","row":{"account":"overlap"}}'),
 ('c7100000-0000-4000-8000-000000000063','c7100000-0000-4000-8000-000000000044','c7100000-0000-4000-8000-000000000012','A','Other tenant secret','{"row":{"secret":"other-tenant"}}'),
 ('c7100000-0000-4000-8000-000000000064','c7100000-0000-4000-8000-000000000042','c7100000-0000-4000-8000-000000000011','A','Missing C from A','{"key":"reference=SHARED","missing_sides":["C"],"row":{"account":"A-ROW"}}'),
 ('c7100000-0000-4000-8000-000000000065','c7100000-0000-4000-8000-000000000042','c7100000-0000-4000-8000-000000000011','B','Missing C from B','{"key":"reference=SHARED","missing_sides":["C"],"row":{"account":"B-ROW"}}'),
 ('c7100000-0000-4000-8000-000000000066','c7100000-0000-4000-8000-000000000042','c7100000-0000-4000-8000-000000000011','A','Duplicate','{"rule_kind":"unique","row":{"account":"DUP"}}'),
 ('c7100000-0000-4000-8000-000000000067','c7100000-0000-4000-8000-000000000042','c7100000-0000-4000-8000-000000000011','A/B','Partial','{"key":"reference=PARTIAL","rule_id":"amount","sides":{"A":{"account":"P-A"},"B":{"account":"P-B"}}}'),
 ('c7100000-0000-4000-8000-000000000068','c7100000-0000-4000-8000-000000000043','c7100000-0000-4000-8000-000000000011','A','Missing C from A','{"key":"reference=THREE","missing_sides":["C"],"row":{"account":"T-A"}}'),
 ('c7100000-0000-4000-8000-000000000069','c7100000-0000-4000-8000-000000000043','c7100000-0000-4000-8000-000000000011','B','Missing C from B','{"key":"reference=THREE","missing_sides":["C"],"row":{"account":"T-B"}}'),
 ('c7100000-0000-4000-8000-000000000071','c7100000-0000-4000-8000-000000000043','c7100000-0000-4000-8000-000000000011','A','Unknown legacy payload','{"legacy_marker":"preserve"}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','c7100000-0000-4000-8000-000000000021',true);
DO $$
DECLARE one_side jsonb; two_side jsonb; three_side jsonb; grouped jsonb; other_tenant jsonb; other_tenant_page jsonb;
BEGIN
  one_side := public.get_recon_run_result_status_counts('c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000041');
  IF one_side->>'match_groups' <> '1' OR one_side->>'exception_items' <> '3'
    OR one_side#>>'{exception_buckets,invalid_key}' <> '2'
    OR one_side#>>'{exception_buckets,unavailable}' <> '1' THEN
    RAISE EXCEPTION 'one-sided full-run count oracle mismatch: %',one_side;
  END IF;
  IF (one_side#>>'{exception_buckets,partial}')::integer
      + (one_side#>>'{exception_buckets,missing}')::integer
      + (one_side#>>'{exception_buckets,duplicate}')::integer
      + (one_side#>>'{exception_buckets,invalid_key}')::integer
      + (one_side#>>'{exception_buckets,other}')::integer
      + (one_side#>>'{exception_buckets,unavailable}')::integer <> (one_side->>'exception_items')::integer THEN
    RAISE EXCEPTION 'one persisted exception was counted in multiple status buckets: %',one_side;
  END IF;
  two_side := public.get_recon_run_result_status_counts('c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000042');
  IF two_side->>'match_groups' <> '1' OR two_side->>'exception_items' <> '4'
    OR two_side#>>'{exception_buckets,missing}' <> '2'
    OR two_side#>>'{exception_buckets,duplicate}' <> '1'
    OR two_side#>>'{exception_buckets,partial}' <> '1' THEN
    RAISE EXCEPTION 'two-sided full-run count oracle mismatch: %',two_side;
  END IF;
  grouped := public.get_recon_run_result_page('c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000042',0,'missing');
  IF grouped->>'parent_count' <> '1'
    OR jsonb_array_length(grouped#>'{rows,0,exception_items}') <> 2
    OR grouped#>>'{rows,0,exception_items,0,public_case_id}' !~ '^FVI-EXC-[A-F0-9]{32}$'
    OR grouped#>>'{rows,0,members,A,0,account}' <> 'A-ROW'
    OR grouped#>>'{rows,0,members,B,0,account}' <> 'B-ROW' THEN
    RAISE EXCEPTION 'two-sided missing-source items were not grouped with all source rows: %',grouped;
  END IF;
  three_side := public.get_recon_run_result_status_counts('c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000043');
  IF three_side->>'match_groups' <> '2' OR three_side->>'exception_items' <> '3'
    OR three_side#>>'{exception_buckets,missing}' <> '2'
    OR three_side#>>'{exception_buckets,other}' <> '1' THEN
    RAISE EXCEPTION 'three-sided 1:N full-run count oracle mismatch: %',three_side;
  END IF;
  other_tenant := public.get_recon_run_result_status_counts('c7100000-0000-4000-8000-000000000012','c7100000-0000-4000-8000-000000000044');
  IF other_tenant IS NOT NULL THEN RAISE EXCEPTION 'cross-tenant exact-run count returned data'; END IF;
  other_tenant_page := public.get_recon_run_result_page('c7100000-0000-4000-8000-000000000012','c7100000-0000-4000-8000-000000000044',0,'all');
  IF other_tenant_page IS NOT NULL THEN RAISE EXCEPTION 'cross-tenant exact-run page returned data'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
