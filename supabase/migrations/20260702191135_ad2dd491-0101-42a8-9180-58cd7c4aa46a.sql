SET session_replication_role = 'replica';
DELETE FROM public.tenant_members WHERE tenant_id IN (SELECT id FROM public.tenants WHERE environment = 'dev');
DELETE FROM public.tenants WHERE environment = 'dev';
SET session_replication_role = 'origin';