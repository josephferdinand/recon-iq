-- Synthetic mapped-only fixtures. Session selectors live ONLY in qa; no JWT
-- sub/role fabrication, business tokens, hosted auth or production mutation.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA private;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA qa;
CREATE EXTENSION ltree;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE qa.session(actor uuid,aal text);
INSERT INTO qa.session VALUES('22222222-2222-2222-2222-222222222221','aal2');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT actor FROM qa.session $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('role',true) $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT jsonb_build_object('aal',aal) FROM qa.session $$;
GRANT USAGE ON SCHEMA public,private,auth,qa TO authenticated;
CREATE TABLE qa.results(name text PRIMARY KEY,passed boolean NOT NULL,detail text);
GRANT INSERT,SELECT ON qa.results TO authenticated;
CREATE FUNCTION qa.assert(_name text,_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(_ok,false) THEN RAISE EXCEPTION 'FAILED: %',_name; END IF; INSERT INTO qa.results VALUES(_name,true,NULL); RAISE NOTICE 'PASS: %',_name; END $$;
CREATE FUNCTION qa.expect_error(_name text,_sql text,_state text,_message text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE state_now text; message_now text;
BEGIN
 BEGIN EXECUTE _sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_now=RETURNED_SQLSTATE,message_now=MESSAGE_TEXT; END;
 IF state_now IS DISTINCT FROM _state OR (_message IS NOT NULL AND message_now IS DISTINCT FROM _message) THEN
  RAISE EXCEPTION 'FAILED: %, wanted %/%, got %/%',_name,_state,_message,state_now,message_now;
 END IF;
 INSERT INTO qa.results VALUES(_name,true,state_now||':'||coalesce(message_now,''));
 RAISE NOTICE 'PASS: %',_name;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users SELECT ('22222222-2222-2222-2222-'||lpad(n::text,12,'2'))::uuid FROM generate_series(1,4) n;
CREATE TABLE public.tenants(id uuid PRIMARY KEY);
INSERT INTO public.tenants VALUES('11111111-1111-1111-1111-111111111111'),('11111111-1111-1111-1111-111111111112');
CREATE TABLE public.tenant_members(tenant_id uuid REFERENCES public.tenants,user_id uuid,role text,active boolean DEFAULT true,PRIMARY KEY(tenant_id,user_id));
INSERT INTO public.tenant_members VALUES
 ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','tenant_admin',true),
 ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','tenant_admin',true),
 ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222223','tenant_analyst',true),
 ('11111111-1111-1111-1111-111111111112','22222222-2222-2222-2222-222222222224','tenant_admin',true);
CREATE TABLE public.tenant_security_settings(tenant_id uuid PRIMARY KEY,mfa_required boolean NOT NULL DEFAULT true);
INSERT INTO public.tenant_security_settings VALUES('11111111-1111-1111-1111-111111111111',true);
CREATE TABLE public.business_units(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.tenants,path ltree NOT NULL,is_archived boolean NOT NULL DEFAULT false,UNIQUE(tenant_id,id));
INSERT INTO public.business_units VALUES
 ('33333333-3333-3333-3333-333333333331','11111111-1111-1111-1111-111111111111','root',false),
 ('33333333-3333-3333-3333-333333333332','11111111-1111-1111-1111-111111111111','root.child',false);
CREATE TABLE public.tenant_groups(id uuid PRIMARY KEY,tenant_id uuid,bu_id uuid,UNIQUE(tenant_id,id));
CREATE TABLE public.bu_user_assignments(tenant_id uuid,bu_id uuid REFERENCES public.business_units,user_id uuid,inherit_descendants boolean NOT NULL DEFAULT false,PRIMARY KEY(tenant_id,bu_id,user_id));
CREATE TABLE public.bu_group_assignments(tenant_id uuid,bu_id uuid REFERENCES public.business_units,group_id uuid REFERENCES public.tenant_groups,inherit_descendants boolean NOT NULL DEFAULT false,PRIMARY KEY(tenant_id,bu_id,group_id));
CREATE TABLE public.tenant_group_members(group_id uuid REFERENCES public.tenant_groups,user_id uuid,PRIMARY KEY(group_id,user_id));
INSERT INTO public.bu_user_assignments VALUES('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333331','22222222-2222-2222-2222-222222222223',true);
CREATE TABLE public.recon_definitions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES public.tenants,name text,description text,recon_type text,sides jsonb DEFAULT '[]',rules jsonb DEFAULT '[]',extension jsonb DEFAULT '{}',
 status text DEFAULT 'draft',environment text DEFAULT 'development',created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
 governance_state text DEFAULT 'development_draft',access_mode text DEFAULT 'mapped_exact',multi_bu_governed boolean DEFAULT true,
 bu_id uuid,visibility text DEFAULT 'scoped',governance_parent_id uuid,staging_original_name text,staging_generated_name text,
 retired_at timestamptz,retirement_request_id uuid,starter_template_id uuid,starter_template_code text,starter_template_snapshot jsonb,tenant_template_id uuid,recon_code text,UNIQUE(tenant_id,id));
CREATE TABLE public.recon_definition_business_units(tenant_id uuid,recon_id uuid,bu_id uuid,created_at timestamptz DEFAULT now(),created_by uuid,PRIMARY KEY(tenant_id,recon_id,bu_id),FOREIGN KEY(tenant_id,recon_id) REFERENCES public.recon_definitions(tenant_id,id),FOREIGN KEY(tenant_id,bu_id) REFERENCES public.business_units(tenant_id,id));
CREATE TABLE public.recon_definition_bu_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,recon_id uuid,bu_id uuid,principal_type text CHECK(principal_type IN ('user','group')),principal_id uuid,action text CHECK(action IN ('view','read','edit','approve','run')),granted_at timestamptz DEFAULT now(),granted_by uuid,FOREIGN KEY(tenant_id,recon_id,bu_id) REFERENCES public.recon_definition_business_units,UNIQUE(tenant_id,recon_id,bu_id,principal_type,principal_id,action));
CREATE TABLE public.recon_definition_business_unit_audit(id bigint GENERATED ALWAYS AS IDENTITY,tenant_id uuid,recon_id uuid,bu_id uuid,operation text,changed_by uuid);
CREATE TABLE public.recon_retirement_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,recon_id uuid,status text,decided_by uuid,requested_by uuid,decided_at timestamptz);
CREATE TABLE public.audit_log(actor_user_id uuid,tenant_id uuid,scope text,action text,resource_type text,resource_id text,context jsonb);
CREATE TABLE public.recon_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),definition_id uuid,tenant_id uuid,run_by uuid);
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,created_by) VALUES('44444444-4444-4444-4444-444444444441','11111111-1111-1111-1111-111111111111','mapped fixture','two_sided','22222222-2222-2222-2222-222222222221');
INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by) SELECT '11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444441',id,'22222222-2222-2222-2222-222222222221' FROM public.business_units;
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by) SELECT '11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444441',id,'user','22222222-2222-2222-2222-222222222223',action,'22222222-2222-2222-2222-222222222221' FROM public.business_units CROSS JOIN unnest(ARRAY['view','edit','run']) action;
GRANT SELECT,UPDATE ON public.recon_definitions TO authenticated;
GRANT INSERT,SELECT ON public.recon_runs TO authenticated;
