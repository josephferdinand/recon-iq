-- Minimal, isolated fixture for the PG16 actor attribution smoke only.
-- This is not the FVI Supabase bootstrap or an ordered migration replay.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;

CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz,updated_at timestamptz);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text,full_name text);
CREATE TABLE public.tenant_members(tenant_id uuid NOT NULL,user_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,user_id));

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT nullif(current_setting('request.jwt.claim.role',true),'')
$$;

-- All 12 roots share only the columns the two migrations require. Their full
-- Supabase schemas, grants, policies, constraints, and business triggers are
-- intentionally outside this isolated smoke fixture.
CREATE TABLE public.workspace_data_sources(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.workspace_data_source_uploads(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now());
CREATE TABLE public.data_source_schedules(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.rekon_db_connections(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.rekon_inline_api_sources(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.erp_connector_configs(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.data_watchers(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.aidp_templates(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.aidp_documents(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.reference_data_tables(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.data_prep_pipelines(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.recon_definitions(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());

CREATE FUNCTION public.smoke_set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN NEW.updated_at:=transaction_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER smoke_set_updated_at BEFORE UPDATE ON public.workspace_data_sources
FOR EACH ROW EXECUTE FUNCTION public.smoke_set_updated_at();

-- Minimal visibility-gate stub for one root only. The 235000 wrapper is still
-- tested for its delegation behavior; this does not validate 233000 BU/RLS.
CREATE FUNCTION public.get_data_resource_access_summary(_resource_type text,_resource_ids uuid[])
RETURNS TABLE(resource_type text,resource_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth AS $$
  SELECT 'data_source'::text,s.id
  FROM public.workspace_data_sources s
  WHERE _resource_type='data_source' AND s.id=ANY(_resource_ids)
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id=s.tenant_id AND tm.user_id=auth.uid() AND tm.active)
$$;
GRANT EXECUTE ON FUNCTION public.get_data_resource_access_summary(text,uuid[]) TO authenticated;

-- Historical row inserted before 234000 has no actor columns to backfill.
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('c1600000-0000-4000-8000-000000000001','pg16-historical@example.invalid',now(),now());
INSERT INTO public.workspace_data_sources(id,tenant_id,created_by)
VALUES ('c1600000-0000-4000-8000-000000000101','c1600000-0000-4000-8000-000000000201',
        'c1600000-0000-4000-8000-000000000001');
