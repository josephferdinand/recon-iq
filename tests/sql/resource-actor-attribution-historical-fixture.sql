-- Inserted immediately before the attribution migration in a disposable replay.
-- This row proves legacy created_by is not silently promoted to trusted lineage.
INSERT INTO public.tenants(id,slug,name) VALUES
  ('a3400000-0000-4000-8000-000000000001','actor-historical','Actor Historical');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('a3400000-0000-4000-8000-000000000002','actor-historical@example.invalid',now(),now());
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,created_by)
VALUES ('a3400000-0000-4000-8000-000000000003','a3400000-0000-4000-8000-000000000001',
        'Historical actor row','csv','a3400000-0000-4000-8000-000000000002');
