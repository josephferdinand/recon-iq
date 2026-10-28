-- ISOLATED FIXTURE ONLY. Runner loads Curie's exact shared principal helper.
-- Dependency shapes/seeded self-bound actors are not hosted identity/MFA proof.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('role')$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
GRANT USAGE ON SCHEMA auth,private TO anon,authenticated,service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.tenants(id uuid PRIMARY KEY,ai_enabled boolean NOT NULL);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,active boolean,deactivated_at timestamptz);
CREATE TABLE public.api_tokens(id uuid PRIMARY KEY,tenant_id uuid,token_hash text,scopes text[],expires_at timestamptz,revoked_at timestamptz,
 created_by uuid,principal_kind text,issuer_user_id uuid,subject_user_id uuid,service_principal_id uuid,last_used_at timestamptz);
CREATE TABLE public.ai_routing_policies(id uuid PRIMARY KEY,name text,scope text,tenant_id uuid,chain jsonb,conditions jsonb,enabled boolean,priority integer);
CREATE TABLE public.ai_model_catalog(id uuid PRIMARY KEY,provider_instance_id uuid,model_key text,approval_status text,availability_status text,max_output_tokens integer,context_window integer DEFAULT 100000,max_input_tokens integer DEFAULT 65536);
CREATE TABLE public.ai_provider_instances(id uuid PRIMARY KEY,tenant_id uuid,provider_code text,display_name text,endpoint text,auth_method text,custom_headers jsonb,api_version text,status text,vault_secret_id uuid);
CREATE TABLE public.app_vault_secrets(id uuid PRIMARY KEY,scope text,tenant_id uuid,ciphertext bytea,iv bytea,auth_tag bytea,wrapped_dek bytea,kek_provider text,kek_ref text);
CREATE TABLE public.ai_governance_kill_switches(tenant_id uuid,engaged boolean,scope text DEFAULT 'global');
CREATE TABLE public.ai_model_pricing(model_key text,provider_code text,active boolean,effective_at timestamptz,input_usd_per_1m numeric,output_usd_per_1m numeric,currency text DEFAULT 'USD',expires_at timestamptz,id uuid DEFAULT gen_random_uuid() PRIMARY KEY);
CREATE TABLE public.ai_usage_events(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,scope text,model text,tokens_in integer NOT NULL,tokens_out integer NOT NULL,cost_usd numeric NOT NULL,meta jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE public.audit_log(actor_user_id uuid,tenant_id uuid,scope text,action text,resource_type text,resource_id text,context jsonb);
CREATE TABLE public.security_events(tenant_id uuid,user_id uuid,event_type text,severity text,context jsonb);
CREATE TABLE private.qa_platform_admins(actor uuid);
CREATE FUNCTION public.is_platform_admin(_actor uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM private.qa_platform_admins WHERE actor=_actor)$$;
CREATE TABLE private.qa_rate_limit(allowed boolean);
INSERT INTO private.qa_rate_limit VALUES(true);
CREATE FUNCTION public.rate_limit_hit(_key text,_window_seconds integer,_limit integer) RETURNS TABLE(allowed boolean,retry_after_seconds integer)
 LANGUAGE sql AS $$SELECT allowed,60 FROM private.qa_rate_limit$$;
CREATE FUNCTION private.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT public.is_platform_admin($1)$$;
CREATE FUNCTION private.is_platform_super_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE TABLE public.platform_ai_settings(id boolean PRIMARY KEY,ai_enabled boolean,allow_copilot_global boolean,default_autonomy_ceiling text,
 global_max_tokens_per_day integer,global_max_cost_usd_per_day numeric,llm_rl_per_user_max integer,llm_rl_per_user_window_seconds integer,llm_rl_per_tenant_max integer,llm_rl_per_tenant_window_seconds integer);
CREATE TABLE public.tenant_ai_settings(tenant_id uuid PRIMARY KEY,ai_enabled boolean,allow_copilot boolean,default_autonomy text,max_tokens_per_day integer,llm_rl_per_user_max integer,llm_rl_per_user_window_seconds integer,llm_rl_per_tenant_max integer,llm_rl_per_tenant_window_seconds integer);
CREATE TABLE public.ai_budgets(tenant_id uuid PRIMARY KEY,daily_max_tokens integer,daily_max_cost_usd numeric,monthly_max_cost_usd numeric,hard_stop_at_pct integer);
CREATE TABLE public.ai_quotas(tenant_id uuid PRIMARY KEY,daily_token_limit bigint,monthly_token_limit bigint,input_token_limit bigint,output_token_limit bigint,cached_token_limit bigint,api_request_limit bigint,budget_limit_usd numeric);
CREATE TABLE public.ai_provider_registry(code text PRIMARY KEY,enabled boolean);
CREATE TABLE public.llm_providers(id uuid PRIMARY KEY,tenant_id uuid,scope text,provider text,base_url text,model text,is_active boolean,key_secret_name text);

INSERT INTO auth.users VALUES('20000000-0000-4000-8000-000000000002'),('20000000-0000-4000-8000-000000000009');
INSERT INTO public.tenants VALUES('10000000-0000-4000-8000-000000000001',true),('10000000-0000-4000-8000-000000000009',true);
INSERT INTO public.tenant_members VALUES('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','tenant_admin',true,NULL);
INSERT INTO public.api_tokens(id,tenant_id,token_hash,scopes,principal_kind,issuer_user_id,subject_user_id,created_by)
 VALUES('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',repeat('a',64),ARRAY['ai.inference'],'user_delegated',
 '20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002');
INSERT INTO public.ai_routing_policies VALUES('50000000-0000-4000-8000-000000000005','Scoped route','tenant','10000000-0000-4000-8000-000000000001',
 '[{"model_catalog_id":"70000000-0000-4000-8000-000000000007"}]','{}',true,100);
INSERT INTO public.ai_model_catalog(id,provider_instance_id,model_key,approval_status,availability_status,max_output_tokens) VALUES('70000000-0000-4000-8000-000000000007','60000000-0000-4000-8000-000000000006','qa-model','approved','available',1024);
INSERT INTO public.ai_provider_instances VALUES('60000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','qa','QA','https://qa.invalid/chat','bearer','{}',NULL,'active','80000000-0000-4000-8000-000000000008');
INSERT INTO public.app_vault_secrets VALUES('80000000-0000-4000-8000-000000000008','tenant','10000000-0000-4000-8000-000000000001',decode('00','hex'),decode('00','hex'),decode('00','hex'),decode('00','hex'),'fixture','fixture');
INSERT INTO public.ai_model_pricing(model_key,provider_code,active,effective_at,input_usd_per_1m,output_usd_per_1m) VALUES('qa-model','qa',true,now(),2,10);
INSERT INTO public.platform_ai_settings VALUES(true,true,true,'suggest',1000000,100,100,60,100,60);
INSERT INTO public.tenant_ai_settings VALUES('10000000-0000-4000-8000-000000000001',true,true,'read_only',1000000,NULL,NULL,NULL,NULL);
INSERT INTO public.ai_budgets VALUES('10000000-0000-4000-8000-000000000001',1000000,100,1000,100);
INSERT INTO public.ai_quotas(tenant_id) VALUES('10000000-0000-4000-8000-000000000001');
INSERT INTO public.ai_provider_registry VALUES('qa',true);
INSERT INTO public.llm_providers VALUES('90000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','tenant','qa','https://qa.invalid/chat','qa-model',true,NULL);
-- The anonymous client has neither table grants nor policies. Purpose RPCs
-- must supply positive actor-bound access without granting these table reads.
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_routing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_vault_secrets ENABLE ROW LEVEL SECURITY;
