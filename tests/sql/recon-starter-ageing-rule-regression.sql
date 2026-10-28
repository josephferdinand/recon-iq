-- Runs after the retained local Starter Kit tenant/actor fixture.
BEGIN;
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,status,inferred_schema,sample_rows,row_count)
VALUES ('f5000000-0000-4000-8000-000000000034','f5000000-0000-4000-8000-000000000003',
 'Suspense ageing dates','csv','ready','{"txn_id":"text","posted_at":"date","amount":"number"}',
 '[{"txn_id":"S-001","posted_at":"2026-09-14","amount":100}]',1);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000020',true);
SELECT public.install_recon_starter_template_atomic(
 'f5000000-0000-4000-8000-000000000003',
 (SELECT id FROM public.recon_definition_templates WHERE code='acct_suspense_v1'),
 'Suspense Ageing Rule Assurance',
 '[{"side_id":"A","label":"Suspense GL","data_source_id":"f5000000-0000-4000-8000-000000000034"}]',
 '[{"id":"key","kind":"unique","fields":{"A":"txn_id"}},{"id":"required","kind":"non_null","fields":{"A":"txn_id"}},{"id":"age","kind":"date_age_days","fields":{"A":"posted_at"},"params":{"days":30}}]'
);
RESET ROLE;
DO $$ DECLARE definition_id uuid; BEGIN
 SELECT id INTO definition_id FROM public.recon_definitions
 WHERE tenant_id='f5000000-0000-4000-8000-000000000003' AND name='Suspense Ageing Rule Assurance';
 IF definition_id IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.recon_definitions WHERE id=definition_id AND recon_type='one_sided'
     AND rules @> '[{"kind":"date_age_days","params":{"days":30}}]'::jsonb
 ) THEN RAISE EXCEPTION 'ageing rule was not installed'; END IF;
 IF (SELECT count(*) FROM public.audit_log WHERE resource_id=definition_id::text AND action='recon.template.install')<>1
 THEN RAISE EXCEPTION 'ageing installation audit missing'; END IF;
END $$;
SELECT 'starter_ageing_rule_install_PASS threshold=30 sides=1 audit=1' AS result;
COMMIT;
