BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
('f5500000-0000-4000-8000-000000000001','Public ID Regression','f5500000-0000-4000-8000-000000000001','Public ID Regression');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
('f5500000-0000-4000-8000-000000000001','f5500000-0000-4000-8000-000000000001','public-id-regression','Public ID Regression','dev');

DO $$
DECLARE
  v_source uuid;
  v_upload uuid;
  v_template uuid;
  v_document uuid;
  v_reference uuid;
  v_id text;
BEGIN
  INSERT INTO public.workspace_data_sources(tenant_id,name,source_type)
  VALUES ('f5500000-0000-4000-8000-000000000001','Source','csv')
  RETURNING id,public_id INTO v_source,v_id;
  IF v_id !~ '^FVI-DS-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'source ID format mismatch'; END IF;

  INSERT INTO public.workspace_data_source_uploads(tenant_id,data_source_id,filename)
  VALUES ('f5500000-0000-4000-8000-000000000001',v_source,'sample.csv')
  RETURNING id,public_id INTO v_upload,v_id;
  IF v_id !~ '^FVI-UP-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'upload ID format mismatch'; END IF;
  INSERT INTO public.data_source_schedules(tenant_id,data_source_id,name,connector_type)
  VALUES ('f5500000-0000-4000-8000-000000000001',v_source,'Schedule','manual') RETURNING public_id INTO v_id;
  IF v_id !~ '^FVI-SCH-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'schedule ID format mismatch'; END IF;

  INSERT INTO public.rekon_db_connections(tenant_id,name,dialect)
  VALUES ('f5500000-0000-4000-8000-000000000001','DB','postgres') RETURNING public_id INTO v_id;
  IF v_id !~ '^FVI-DB-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'database connector ID format mismatch'; END IF;
  INSERT INTO public.rekon_inline_api_sources(tenant_id,name,url)
  VALUES ('f5500000-0000-4000-8000-000000000001','API','https://example.invalid') RETURNING public_id INTO v_id;
  IF v_id !~ '^FVI-API-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'API connector ID format mismatch'; END IF;
  INSERT INTO public.erp_connector_configs(tenant_id,connector_kind,display_name,auth_method)
  VALUES ('f5500000-0000-4000-8000-000000000001','sap','ERP','api_key') RETURNING public_id INTO v_id;
  IF v_id !~ '^FVI-ERP-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'ERP connector ID format mismatch'; END IF;

  INSERT INTO public.data_watchers(tenant_id,data_source_id,name,watch_type)
  VALUES ('f5500000-0000-4000-8000-000000000001',v_source,'Watcher','freshness') RETURNING public_id INTO v_id;
  IF v_id !~ '^FVI-FW-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'watcher ID format mismatch'; END IF;
  INSERT INTO public.aidp_templates(tenant_id,name,doc_kind)
  VALUES ('f5500000-0000-4000-8000-000000000001','Template','invoice') RETURNING id,public_id INTO v_template,v_id;
  IF v_id !~ '^FVI-AIDPT-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'AIDP template ID format mismatch'; END IF;
  INSERT INTO public.aidp_documents(tenant_id,template_id,original_filename,mime)
  VALUES ('f5500000-0000-4000-8000-000000000001',v_template,'invoice.pdf','application/pdf') RETURNING public_id INTO v_id;
  IF v_id !~ '^FVI-AIDPD-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'AIDP document ID format mismatch'; END IF;
  INSERT INTO public.reference_data_tables(tenant_id,name)
  VALUES ('f5500000-0000-4000-8000-000000000001','Reference') RETURNING id,public_id INTO v_reference,v_id;
  IF v_id !~ '^FVI-REF-[0-9A-F]{20}$' THEN RAISE EXCEPTION 'reference ID format mismatch'; END IF;

  BEGIN
    UPDATE public.workspace_data_sources SET public_id='FVI-DS-FORGED' WHERE id=v_source;
    RAISE EXCEPTION 'public ID mutation unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%generated always%' THEN RAISE; END IF;
  WHEN SQLSTATE '428C9' THEN
    NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='workspace_data_sources_tenant_public_id_uidx') THEN
    RAISE EXCEPTION 'tenant uniqueness index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='data_prep_pipelines' AND column_name='public_uid')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='recon_definitions' AND column_name='recon_code') THEN
    RAISE EXCEPTION 'existing Data Prep or reconciliation identifier contract is missing';
  END IF;
  IF (SELECT public_id FROM public.workspace_data_sources WHERE id='f5600000-0000-4000-8000-000000000011') <> 'FVI-DS-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000011','sha256'),'hex'),1,20))
     OR (SELECT created_at FROM public.workspace_data_sources WHERE id='f5600000-0000-4000-8000-000000000011') <> '2020-01-02T03:04:05Z'::timestamptz
     OR (SELECT updated_at FROM public.workspace_data_sources WHERE id='f5600000-0000-4000-8000-000000000011') <> '2020-01-03T03:04:05Z'::timestamptz THEN
    RAISE EXCEPTION 'historical ID backfill or timestamp preservation failed';
  END IF;
  IF (SELECT public_id FROM public.workspace_data_source_uploads WHERE id='f5600000-0000-4000-8000-000000000012') <> 'FVI-UP-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000012','sha256'),'hex'),1,20))
     OR (SELECT public_id FROM public.data_source_schedules WHERE id='f5600000-0000-4000-8000-000000000020') <> 'FVI-SCH-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000020','sha256'),'hex'),1,20))
     OR (SELECT public_id FROM public.rekon_db_connections WHERE id='f5600000-0000-4000-8000-000000000013') <> 'FVI-DB-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000013','sha256'),'hex'),1,20))
     OR (SELECT public_id FROM public.rekon_inline_api_sources WHERE id='f5600000-0000-4000-8000-000000000014') <> 'FVI-API-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000014','sha256'),'hex'),1,20))
     OR (SELECT public_id FROM public.erp_connector_configs WHERE id='f5600000-0000-4000-8000-000000000015') <> 'FVI-ERP-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000015','sha256'),'hex'),1,20))
     OR (SELECT public_id FROM public.data_watchers WHERE id='f5600000-0000-4000-8000-000000000016') <> 'FVI-FW-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000016','sha256'),'hex'),1,20))
     OR (SELECT public_id FROM public.aidp_templates WHERE id='f5600000-0000-4000-8000-000000000017') <> 'FVI-AIDPT-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000017','sha256'),'hex'),1,20))
     OR (SELECT public_id FROM public.aidp_documents WHERE id='f5600000-0000-4000-8000-000000000018') <> 'FVI-AIDPD-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000018','sha256'),'hex'),1,20))
     OR (SELECT public_id FROM public.reference_data_tables WHERE id='f5600000-0000-4000-8000-000000000019') <> 'FVI-REF-' || upper(substr(encode(digest('f5600000-0000-4000-8000-000000000019','sha256'),'hex'),1,20)) THEN
    RAISE EXCEPTION 'historical public ID backfill failed';
  END IF;
END $$;

ROLLBACK;
