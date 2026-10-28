\set ON_ERROR_STOP on
CREATE TABLE public.tenants(id uuid PRIMARY KEY);
INSERT INTO public.tenants VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
CREATE TABLE public.status_fixture_members(actor_id uuid,tenant_id uuid);
INSERT INTO public.status_fixture_members VALUES('33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
CREATE FUNCTION public.is_tenant_member(_user_id uuid,_tenant_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM status_fixture_members WHERE actor_id=_user_id AND tenant_id=_tenant_id) $$;
-- The runner inserts the guarded intake proposal at this boundary.
