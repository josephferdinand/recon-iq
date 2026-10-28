-- Seed fixed historical rows immediately before the public-ID migration.
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
('f5600000-0000-4000-8000-000000000001','Public ID Backfill','f5600000-0000-4000-8000-000000000001','Public ID Backfill');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
('f5600000-0000-4000-8000-000000000001','f5600000-0000-4000-8000-000000000001','public-id-backfill','Public ID Backfill','dev');

INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000011','f5600000-0000-4000-8000-000000000001','Legacy source','csv','2020-01-02T03:04:05Z','2020-01-03T03:04:05Z');
INSERT INTO public.workspace_data_source_uploads(id,data_source_id,tenant_id,filename,created_at)
VALUES ('f5600000-0000-4000-8000-000000000012','f5600000-0000-4000-8000-000000000011','f5600000-0000-4000-8000-000000000001','legacy.csv','2020-01-04T03:04:05Z');
INSERT INTO public.data_source_schedules(id,tenant_id,data_source_id,name,connector_type,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000020','f5600000-0000-4000-8000-000000000001','f5600000-0000-4000-8000-000000000011','Legacy schedule','manual','2020-01-19T03:04:05Z','2020-01-20T03:04:05Z');
INSERT INTO public.rekon_db_connections(id,tenant_id,name,dialect,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000013','f5600000-0000-4000-8000-000000000001','Legacy DB','postgres','2020-01-05T03:04:05Z','2020-01-06T03:04:05Z');
INSERT INTO public.rekon_inline_api_sources(id,tenant_id,name,url,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000014','f5600000-0000-4000-8000-000000000001','Legacy API','https://example.invalid','2020-01-07T03:04:05Z','2020-01-08T03:04:05Z');
INSERT INTO public.erp_connector_configs(id,tenant_id,connector_kind,display_name,auth_method,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000015','f5600000-0000-4000-8000-000000000001','sap','Legacy ERP','api_key','2020-01-09T03:04:05Z','2020-01-10T03:04:05Z');
INSERT INTO public.data_watchers(id,tenant_id,data_source_id,name,watch_type,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000016','f5600000-0000-4000-8000-000000000001','f5600000-0000-4000-8000-000000000011','Legacy watcher','freshness','2020-01-11T03:04:05Z','2020-01-12T03:04:05Z');
INSERT INTO public.aidp_templates(id,tenant_id,name,doc_kind,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000017','f5600000-0000-4000-8000-000000000001','Legacy AIDP template','invoice','2020-01-13T03:04:05Z','2020-01-14T03:04:05Z');
INSERT INTO public.aidp_documents(id,tenant_id,template_id,original_filename,mime,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000018','f5600000-0000-4000-8000-000000000001','f5600000-0000-4000-8000-000000000017','legacy.pdf','application/pdf','2020-01-15T03:04:05Z','2020-01-16T03:04:05Z');
INSERT INTO public.reference_data_tables(id,tenant_id,name,created_at,updated_at)
VALUES ('f5600000-0000-4000-8000-000000000019','f5600000-0000-4000-8000-000000000001','Legacy reference','2020-01-17T03:04:05Z','2020-01-18T03:04:05Z');
