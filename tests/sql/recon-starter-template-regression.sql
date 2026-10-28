BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('f5000000-0000-4000-8000-000000000001','Starter Kit Evidence A','f5000000-0000-4000-8000-000000000011','Starter Kit Evidence A'),
 ('f5000000-0000-4000-8000-000000000002','Starter Kit Evidence B','f5000000-0000-4000-8000-000000000012','Starter Kit Evidence B');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f5000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000001','starter-evidence-a','Starter Kit Evidence A','dev'),
 ('f5000000-0000-4000-8000-000000000004','f5000000-0000-4000-8000-000000000002','starter-evidence-b','Starter Kit Evidence B','dev');
INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ('f5000000-0000-4000-8000-000000000020','starter-admin@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active)
VALUES ('f5000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000020','tenant_admin',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,status,inferred_schema,sample_rows,row_count) VALUES
 ('f5000000-0000-4000-8000-000000000031','f5000000-0000-4000-8000-000000000003','OMS trades','csv','ready','{"trade_id":"text","isin":"text","side":"text","price":"number","quantity":"number"}','[{"trade_id":"T1","isin":"US0001","side":"BUY","price":10,"quantity":5}]',1),
 ('f5000000-0000-4000-8000-000000000032','f5000000-0000-4000-8000-000000000003','Broker confirms','csv','ready','{"trade_id":"text","isin":"text","side":"text","price":"number","quantity":"number"}','[{"trade_id":"T1","isin":"US0001","side":"BUY","price":10,"quantity":5}]',1),
 ('f5000000-0000-4000-8000-000000000033','f5000000-0000-4000-8000-000000000004','Other tenant source','csv','ready','{"trade_id":"text"}','[{"trade_id":"T1"}]',1);

CREATE TEMP TABLE starter_baseline AS
SELECT id,install_count FROM public.recon_definition_templates WHERE code='equities_trade_vs_confirm';
GRANT SELECT ON starter_baseline TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000020',true);
SELECT public.install_recon_starter_template_atomic(
  'f5000000-0000-4000-8000-000000000003',
  (SELECT id FROM starter_baseline),
  'Mapped Equities Trade Assurance',
  '[{"side_id":"A","label":"OMS","data_source_id":"f5000000-0000-4000-8000-000000000031"},{"side_id":"B","label":"Broker","data_source_id":"f5000000-0000-4000-8000-000000000032"}]',
  '[{"id":"tpl-key-trade","kind":"exact_match","fields":{"A":"trade_id","B":"trade_id"},"is_key":true},{"id":"tpl-key-isin","kind":"exact_match","fields":{"A":"isin","B":"isin"},"is_key":true},{"id":"tpl-price","kind":"numeric_tolerance_pct","fields":{"A":"price","B":"price"},"params":{"pct":0.05}}]'
);

DO $$ BEGIN
  PERFORM public.install_recon_starter_template_atomic(
    'f5000000-0000-4000-8000-000000000003',(SELECT id FROM starter_baseline),'Duplicate Source Rejected',
    '[{"side_id":"A","label":"A","data_source_id":"f5000000-0000-4000-8000-000000000031"},{"side_id":"B","label":"B","data_source_id":"f5000000-0000-4000-8000-000000000031"}]',
    '[{"id":"key","kind":"exact_match","fields":{"A":"trade_id","B":"trade_id"},"is_key":true}]');
  RAISE EXCEPTION 'duplicate source binding unexpectedly accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM public.install_recon_starter_template_atomic(
    'f5000000-0000-4000-8000-000000000003',(SELECT id FROM starter_baseline),'Cross Tenant Rejected',
    '[{"side_id":"A","label":"A","data_source_id":"f5000000-0000-4000-8000-000000000031"},{"side_id":"B","label":"B","data_source_id":"f5000000-0000-4000-8000-000000000033"}]',
    '[{"id":"key","kind":"exact_match","fields":{"A":"trade_id","B":"trade_id"},"is_key":true}]');
  RAISE EXCEPTION 'cross-tenant source binding unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM public.install_recon_starter_template_atomic(
    'f5000000-0000-4000-8000-000000000003',(SELECT id FROM starter_baseline),'Unsupported Rule Rejected',
    '[{"side_id":"A","label":"A","data_source_id":"f5000000-0000-4000-8000-000000000031"},{"side_id":"B","label":"B","data_source_id":"f5000000-0000-4000-8000-000000000032"}]',
    '[{"id":"unsafe","kind":"arbitrary_code","fields":{"A":"trade_id","B":"trade_id"}}]');
  RAISE EXCEPTION 'unsupported rule unexpectedly accepted';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;
RESET ROLE;

DO $$
DECLARE definition_id uuid;
BEGIN
  SELECT id INTO definition_id FROM public.recon_definitions
  WHERE tenant_id='f5000000-0000-4000-8000-000000000003' AND name='Mapped Equities Trade Assurance';
  IF definition_id IS NULL THEN RAISE EXCEPTION 'mapped reconciliation was not created'; END IF;
  IF (SELECT jsonb_array_length(sides) FROM public.recon_definitions WHERE id=definition_id) <> 2 THEN
    RAISE EXCEPTION 'mapped sides were not persisted';
  END IF;
  IF (SELECT jsonb_array_length(rules) FROM public.recon_definitions WHERE id=definition_id) <> 3 THEN
    RAISE EXCEPTION 'compiled rules were not persisted';
  END IF;
  IF (SELECT starter_template_code FROM public.recon_definitions WHERE id=definition_id) <> 'equities_trade_vs_confirm' THEN
    RAISE EXCEPTION 'template provenance was not persisted';
  END IF;
  IF (SELECT install_count FROM public.recon_definition_templates WHERE id=(SELECT id FROM starter_baseline))
     <> (SELECT install_count+1 FROM starter_baseline) THEN
    RAISE EXCEPTION 'install counter is not atomic';
  END IF;
  IF EXISTS (SELECT 1 FROM public.recon_definitions WHERE name IN ('Duplicate Source Rejected','Cross Tenant Rejected','Unsupported Rule Rejected')) THEN
    RAISE EXCEPTION 'failed install left a reconciliation residue';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE resource_id=definition_id::text AND action='recon.template.install') <> 1 THEN
    RAISE EXCEPTION 'template install audit is missing';
  END IF;
END $$;

SELECT 'recon_starter_template_PASS mapped=yes atomic=yes cross_tenant=denied duplicate=denied unsupported=denied audit=yes' AS result;
COMMIT;
