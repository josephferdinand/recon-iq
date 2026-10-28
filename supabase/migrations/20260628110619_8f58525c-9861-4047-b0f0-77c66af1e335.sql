
CREATE TABLE IF NOT EXISTS public.roadmap_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT,
  wave TEXT NOT NULL DEFAULT 'next' CHECK (wave IN ('current','next','future','shipped')),
  priority TEXT NOT NULL DEFAULT 'P1' CHECK (priority IN ('P0','P1','P2','P3')),
  scope TEXT NOT NULL DEFAULT 'platform' CHECK (scope IN ('platform','tenant','workspace','ai','security','compliance','integration')),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_label TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','blocked','review','shipped','deferred')),
  readiness INTEGER NOT NULL DEFAULT 0 CHECK (readiness BETWEEN 0 AND 100),
  audit_ready BOOLEAN NOT NULL DEFAULT FALSE,
  target_date DATE,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roadmap_items TO authenticated;
GRANT ALL ON public.roadmap_items TO service_role;

ALTER TABLE public.roadmap_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_read_authenticated" ON public.roadmap_items
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "roadmap_write_platform_admin" ON public.roadmap_items
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TRIGGER trg_roadmap_items_updated_at
  BEFORE UPDATE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_roadmap_items_wave ON public.roadmap_items(wave, priority);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_status ON public.roadmap_items(status);

INSERT INTO public.roadmap_items (title, summary, wave, priority, scope, owner_label, status, readiness, audit_ready, tags) VALUES
  ('DORA/EMIR exporter hardening','Validation + mapping controls for ESMA/EBA submission packs','current','P0','compliance','Compliance Eng','in_progress', 75, TRUE, ARRAY['dora','emir','audit']),
  ('Marketplace listings UI','Tenant-facing browse / install / manage for published process blueprints','current','P0','tenant','Platform UX','in_progress', 70, TRUE, ARRAY['marketplace','process-library']),
  ('Chat-Ops deep integrations','Slack slash commands + inbound email triggers for break ops','current','P1','integration','Integrations','in_progress', 60, FALSE, ARRAY['slack','email','chat-ops']),
  ('Next Wave roadmap dashboard','Scope, owners, readiness and audit-ready tracking for upcoming features','current','P1','platform','Program Office','in_progress', 80, TRUE, ARRAY['governance']),
  ('FIX 4.4 ingestion parser','Native parser for FIX execution reports for securities recon','next','P1','workspace','Markets Eng','planned', 0, FALSE, ARRAY['fix','securities']),
  ('Live Slack two-way thread sync','Reply-in-thread reflects break comments and assignments','next','P2','integration','Integrations','planned', 0, FALSE, ARRAY['slack']),
  ('SOC 2 Type II evidence pipeline','Automated control evidence harvesting into a Drata-style exporter','next','P0','compliance','Security','planned', 0, TRUE, ARRAY['soc2','audit'])
ON CONFLICT DO NOTHING;
