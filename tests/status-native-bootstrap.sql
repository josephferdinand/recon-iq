\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE public.status_fixture_admins(id uuid PRIMARY KEY);
INSERT INTO public.status_fixture_admins VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fvi.actor',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('aal',current_setting('fvi.aal',true)) $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('fvi.role',true) $$;
CREATE FUNCTION public.is_platform_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.status_fixture_admins WHERE id=_user_id) $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;
CREATE TABLE public.status_components(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE NOT NULL,name text,state text,description text,group_name text,display_order integer,updated_at timestamptz DEFAULT now());
INSERT INTO public.status_components(key,name,state,display_order)
SELECT key,key,'operational',row_number() OVER() FROM unnest(ARRAY['auth','api','workspace','recon','aidp','connectors','reporting','email']) key;
CREATE TABLE public.status_incidents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),body text);
INSERT INTO public.status_incidents(body) VALUES ('Synthetic preserved historical record');
CREATE TABLE public.status_component_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),day date,uptime_pct numeric);
INSERT INTO public.status_component_history(day,uptime_pct) VALUES ('2025-01-01',100);
CREATE TABLE public.status_fixture_preimages AS SELECT
  (SELECT md5(string_agg(row_to_json(x)::text,'|' ORDER BY id)) FROM status_components x) AS components,
  (SELECT md5(string_agg(row_to_json(x)::text,'|' ORDER BY id)) FROM status_incidents x) AS incidents,
  (SELECT md5(string_agg(row_to_json(x)::text,'|' ORDER BY id)) FROM status_component_history x) AS history;
