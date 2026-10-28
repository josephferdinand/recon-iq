
-- ============================================================
-- Marketing / CRM foundation for Recon Spark public website
-- Fully isolated from tenant reconciliation schema.
-- ============================================================

-- Enable pgvector for RAG (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------- Admin roles (independent of tenant RBAC) ----------
DO $$ BEGIN
  CREATE TYPE public.mkt_admin_role AS ENUM ('super_admin','sales_admin','marketing_admin','ai_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mkt_admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mkt_admin_users TO authenticated;
GRANT ALL ON public.mkt_admin_users TO service_role;
ALTER TABLE public.mkt_admin_users ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mkt_admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.mkt_admin_role NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.mkt_admin_roles TO authenticated;
GRANT ALL ON public.mkt_admin_roles TO service_role;
ALTER TABLE public.mkt_admin_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_mkt_role(_user_id uuid, _role public.mkt_admin_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.mkt_admin_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_mkt_role(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.mkt_admin_roles WHERE user_id = _user_id);
$$;

CREATE POLICY mkt_admin_users_read ON public.mkt_admin_users
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));
CREATE POLICY mkt_admin_users_super_write ON public.mkt_admin_users
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin'));

CREATE POLICY mkt_admin_roles_read ON public.mkt_admin_roles
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));
CREATE POLICY mkt_admin_roles_super_write ON public.mkt_admin_roles
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin'));

-- ---------- Enums for CRM ----------
DO $$ BEGIN
  CREATE TYPE public.mkt_lead_category AS ENUM ('sales','support','product','partnership','careers','general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_lead_temperature AS ENUM ('hot','warm','cold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_lead_stage AS ENUM (
    'new','qualified','meeting_scheduled','proposal','negotiation','won','lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_source AS ENUM ('contact_form','chatbot','book_demo','api','import','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Leads ----------
CREATE TABLE IF NOT EXISTS public.mkt_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  mobile text,
  company text NOT NULL,
  job_title text,
  country text,
  industry text,
  company_size text,
  current_recon_tool text,
  erp_platform text,
  monthly_txn_volume text,
  areas_of_interest text[] NOT NULL DEFAULT '{}',
  message text,
  consent_at timestamptz,
  source public.mkt_source NOT NULL DEFAULT 'contact_form',
  category public.mkt_lead_category NOT NULL DEFAULT 'general',
  stage public.mkt_lead_stage NOT NULL DEFAULT 'new',
  temperature public.mkt_lead_temperature NOT NULL DEFAULT 'cold',
  score int NOT NULL DEFAULT 0,
  owner_id uuid REFERENCES auth.users(id),
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  ip inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_leads_stage_idx ON public.mkt_leads(stage);
CREATE INDEX IF NOT EXISTS mkt_leads_owner_idx ON public.mkt_leads(owner_id);
CREATE INDEX IF NOT EXISTS mkt_leads_created_idx ON public.mkt_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS mkt_leads_email_idx ON public.mkt_leads(email);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_leads TO authenticated;
GRANT ALL ON public.mkt_leads TO service_role;
ALTER TABLE public.mkt_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_leads_admin_read ON public.mkt_leads
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));
CREATE POLICY mkt_leads_admin_write ON public.mkt_leads
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'sales_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'sales_admin'));

-- ---------- Lead files, notes, tasks, activity ----------
CREATE TABLE IF NOT EXISTS public.mkt_lead_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.mkt_leads(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_lead_files TO authenticated;
GRANT ALL ON public.mkt_lead_files TO service_role;
ALTER TABLE public.mkt_lead_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_lead_files_admin ON public.mkt_lead_files
  FOR ALL TO authenticated
  USING (public.has_any_mkt_role(auth.uid()))
  WITH CHECK (public.has_any_mkt_role(auth.uid()));

CREATE TABLE IF NOT EXISTS public.mkt_lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.mkt_leads(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id),
  kind text NOT NULL DEFAULT 'note',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_lead_notes TO authenticated;
GRANT ALL ON public.mkt_lead_notes TO service_role;
ALTER TABLE public.mkt_lead_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_lead_notes_admin ON public.mkt_lead_notes
  FOR ALL TO authenticated
  USING (public.has_any_mkt_role(auth.uid()))
  WITH CHECK (public.has_any_mkt_role(auth.uid()));

CREATE TABLE IF NOT EXISTS public.mkt_lead_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.mkt_leads(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES auth.users(id),
  title text NOT NULL,
  description text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_lead_tasks TO authenticated;
GRANT ALL ON public.mkt_lead_tasks TO service_role;
ALTER TABLE public.mkt_lead_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_lead_tasks_admin ON public.mkt_lead_tasks
  FOR ALL TO authenticated
  USING (public.has_any_mkt_role(auth.uid()))
  WITH CHECK (public.has_any_mkt_role(auth.uid()));

CREATE TABLE IF NOT EXISTS public.mkt_lead_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.mkt_leads(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_lead_activity_lead_idx ON public.mkt_lead_activity(lead_id, created_at DESC);
GRANT SELECT, INSERT ON public.mkt_lead_activity TO authenticated;
GRANT ALL ON public.mkt_lead_activity TO service_role;
ALTER TABLE public.mkt_lead_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_lead_activity_read ON public.mkt_lead_activity
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));
CREATE POLICY mkt_lead_activity_insert ON public.mkt_lead_activity
  FOR INSERT TO authenticated WITH CHECK (public.has_any_mkt_role(auth.uid()));

-- ---------- Appointments ----------
CREATE TABLE IF NOT EXISTS public.mkt_appointment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  duration_min int NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mkt_appointment_types TO anon, authenticated;
GRANT ALL ON public.mkt_appointment_types TO service_role;
ALTER TABLE public.mkt_appointment_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_appt_types_public_read ON public.mkt_appointment_types
  FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY mkt_appt_types_admin_write ON public.mkt_appointment_types
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'sales_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'sales_admin'));

INSERT INTO public.mkt_appointment_types (slug, name, description, duration_min) VALUES
  ('product_demo','Product Demo','Live walkthrough of the Recon Spark platform',45),
  ('discovery','Discovery Call','Understand your reconciliation landscape and needs',30),
  ('technical','Technical Consultation','Deep-dive with a solutions architect',60),
  ('executive','Executive Discussion','Strategic alignment for enterprise adoption',45)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mkt_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.mkt_leads(id) ON DELETE SET NULL,
  type_id uuid NOT NULL REFERENCES public.mkt_appointment_types(id),
  host_id uuid REFERENCES auth.users(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  external_provider text,
  external_event_id text,
  attendee_email text,
  attendee_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_appointments_start_idx ON public.mkt_appointments(start_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_appointments TO authenticated;
GRANT ALL ON public.mkt_appointments TO service_role;
ALTER TABLE public.mkt_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_appointments_admin ON public.mkt_appointments
  FOR ALL TO authenticated
  USING (public.has_any_mkt_role(auth.uid()))
  WITH CHECK (public.has_any_mkt_role(auth.uid()));

CREATE TABLE IF NOT EXISTS public.mkt_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  timezone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_calendar_connections TO authenticated;
GRANT ALL ON public.mkt_calendar_connections TO service_role;
ALTER TABLE public.mkt_calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_cal_conn_self ON public.mkt_calendar_connections
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_mkt_role(auth.uid(),'super_admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_mkt_role(auth.uid(),'super_admin'));

-- ---------- Chatbot ----------
CREATE TABLE IF NOT EXISTS public.mkt_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text,
  lead_id uuid REFERENCES public.mkt_leads(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  satisfaction int,
  escalated_to text,
  metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS mkt_chat_sessions_started_idx ON public.mkt_chat_sessions(started_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.mkt_chat_sessions TO authenticated;
GRANT ALL ON public.mkt_chat_sessions TO service_role;
ALTER TABLE public.mkt_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_chat_sessions_admin ON public.mkt_chat_sessions
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));

CREATE TABLE IF NOT EXISTS public.mkt_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.mkt_chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  model text,
  tokens_in int,
  tokens_out int,
  cost_usd numeric(12,6),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_chat_messages_session_idx ON public.mkt_chat_messages(session_id, created_at);
GRANT SELECT ON public.mkt_chat_messages TO authenticated;
GRANT ALL ON public.mkt_chat_messages TO service_role;
ALTER TABLE public.mkt_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_chat_messages_admin_read ON public.mkt_chat_messages
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));

-- ---------- Knowledge base ----------
CREATE TABLE IF NOT EXISTS public.mkt_kb_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  type text NOT NULL,
  version int NOT NULL DEFAULT 1,
  storage_path text,
  source_url text,
  status text NOT NULL DEFAULT 'active',
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_kb_sources TO authenticated;
GRANT ALL ON public.mkt_kb_sources TO service_role;
ALTER TABLE public.mkt_kb_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_kb_sources_admin ON public.mkt_kb_sources
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin') OR public.has_mkt_role(auth.uid(),'marketing_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin') OR public.has_mkt_role(auth.uid(),'marketing_admin'));

CREATE TABLE IF NOT EXISTS public.mkt_kb_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.mkt_kb_sources(id) ON DELETE CASCADE,
  chunk_ix int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_kb_chunks_source_idx ON public.mkt_kb_chunks(source_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_kb_chunks TO authenticated;
GRANT ALL ON public.mkt_kb_chunks TO service_role;
ALTER TABLE public.mkt_kb_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_kb_chunks_admin ON public.mkt_kb_chunks
  FOR ALL TO authenticated
  USING (public.has_any_mkt_role(auth.uid()))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'));

CREATE TABLE IF NOT EXISTS public.mkt_kb_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.mkt_chat_sessions(id) ON DELETE SET NULL,
  query text NOT NULL,
  top_k jsonb NOT NULL DEFAULT '[]',
  was_answered boolean,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mkt_kb_queries TO authenticated;
GRANT ALL ON public.mkt_kb_queries TO service_role;
ALTER TABLE public.mkt_kb_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_kb_queries_admin_read ON public.mkt_kb_queries
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));

-- ---------- Multi-LLM ops ----------
CREATE TABLE IF NOT EXISTS public.mkt_llm_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  display_name text NOT NULL,
  base_url text,
  default_model text,
  api_key_ref text,
  enabled boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 100,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_llm_providers TO authenticated;
GRANT ALL ON public.mkt_llm_providers TO service_role;
ALTER TABLE public.mkt_llm_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_llm_providers_admin ON public.mkt_llm_providers
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'));

CREATE TABLE IF NOT EXISTS public.mkt_llm_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL UNIQUE,
  primary_id uuid REFERENCES public.mkt_llm_providers(id),
  fallback_ids uuid[] NOT NULL DEFAULT '{}',
  max_cost_per_call numeric(12,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_llm_routes TO authenticated;
GRANT ALL ON public.mkt_llm_routes TO service_role;
ALTER TABLE public.mkt_llm_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_llm_routes_admin ON public.mkt_llm_routes
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'));

CREATE TABLE IF NOT EXISTS public.mkt_llm_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES public.mkt_llm_providers(id) ON DELETE SET NULL,
  model text,
  purpose text,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  latency_ms int,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  ok boolean NOT NULL DEFAULT true,
  error_code text,
  session_id uuid REFERENCES public.mkt_chat_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_llm_usage_created_idx ON public.mkt_llm_usage(created_at DESC);
GRANT SELECT ON public.mkt_llm_usage TO authenticated;
GRANT ALL ON public.mkt_llm_usage TO service_role;
ALTER TABLE public.mkt_llm_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_llm_usage_admin_read ON public.mkt_llm_usage
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));

-- ---------- Notification prefs ----------
CREATE TABLE IF NOT EXISTS public.mkt_notification_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event, channel)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_notification_prefs TO authenticated;
GRANT ALL ON public.mkt_notification_prefs TO service_role;
ALTER TABLE public.mkt_notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_notif_prefs_self ON public.mkt_notification_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_mkt_role(auth.uid(),'super_admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_mkt_role(auth.uid(),'super_admin'));

-- ---------- updated_at trigger (shared, idempotent) ----------
CREATE OR REPLACE FUNCTION public.mkt_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'mkt_admin_users','mkt_leads','mkt_lead_tasks','mkt_appointments',
    'mkt_calendar_connections','mkt_kb_sources','mkt_llm_providers','mkt_llm_routes'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at()', t, t);
  END LOOP;
END $$;
