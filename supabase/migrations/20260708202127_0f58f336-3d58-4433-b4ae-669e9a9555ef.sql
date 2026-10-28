
CREATE TABLE IF NOT EXISTS public.platform_evidence_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  framework TEXT NOT NULL,
  control_ref TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  bundle_uri TEXT NULL,
  bundle_sha256 TEXT NULL,
  worm_anchor_id BIGINT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by UUID NULL,
  generated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_packs_tenant ON public.platform_evidence_packs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evidence_packs_framework ON public.platform_evidence_packs(framework, control_ref);
GRANT SELECT ON public.platform_evidence_packs TO authenticated;
GRANT ALL ON public.platform_evidence_packs TO service_role;
ALTER TABLE public.platform_evidence_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evpk platform admin all" ON public.platform_evidence_packs FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "evpk tenant read" ON public.platform_evidence_packs FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=platform_evidence_packs.tenant_id AND tm.user_id=auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_persona_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface TEXT NOT NULL,
  persona TEXT NOT NULL,
  expected TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'gap',
  priority TEXT NOT NULL DEFAULT 'P2',
  gap_notes TEXT NULL,
  linked_backlog TEXT NULL,
  reviewed_by UUID NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(surface, persona, expected)
);
CREATE INDEX IF NOT EXISTS idx_pj_surface ON public.platform_persona_journeys(surface, priority);
GRANT SELECT ON public.platform_persona_journeys TO authenticated;
GRANT ALL ON public.platform_persona_journeys TO service_role;
ALTER TABLE public.platform_persona_journeys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pj auth read" ON public.platform_persona_journeys FOR SELECT TO authenticated USING (true);
CREATE POLICY "pj platform admin write" ON public.platform_persona_journeys FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  transports TEXT[] NOT NULL DEFAULT '{}',
  aaguid TEXT NULL,
  device_label TEXT NULL,
  sign_count BIGINT NOT NULL DEFAULT 0,
  backup_eligible BOOLEAN NOT NULL DEFAULT false,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_user ON public.webauthn_credentials(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webauthn_credentials TO authenticated;
GRANT ALL ON public.webauthn_credentials TO service_role;
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa own" ON public.webauthn_credentials FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.tenant_idp_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  metadata_url TEXT NULL,
  issuer TEXT NULL,
  client_id TEXT NULL,
  domains TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT false,
  scim_enabled BOOLEAN NOT NULL DEFAULT false,
  step_up_required BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider_kind, display_name)
);
CREATE INDEX IF NOT EXISTS idx_tidp_tenant ON public.tenant_idp_configs(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_idp_configs TO authenticated;
GRANT ALL ON public.tenant_idp_configs TO service_role;
ALTER TABLE public.tenant_idp_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tidp read" ON public.tenant_idp_configs FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=tenant_idp_configs.tenant_id AND tm.user_id=auth.uid()));
CREATE POLICY "tidp write" ON public.tenant_idp_configs FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=tenant_idp_configs.tenant_id AND tm.user_id=auth.uid() AND tm.role = 'tenant_admin'))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=tenant_idp_configs.tenant_id AND tm.user_id=auth.uid() AND tm.role = 'tenant_admin'));

INSERT INTO public.platform_persona_journeys (surface, persona, expected, status, priority, gap_notes) VALUES
  ('home','executive','Exec KPI band (open $, SLA burn, aged $, evidence ready)','gap','P0','No exec band today'),
  ('home','auditor','Evidence pack quick-link','gap','P0','No quick link'),
  ('home','end_user','Resume last work card','gap','P0','No resume affordance'),
  ('recon-workspace','power_user','Shared column presets','gap','P0','Presets are per-user only'),
  ('recon-workspace','compliance','SoD self-approval banner','gap','P0','Banner missing'),
  ('recon-workspace','auditor','Per-row why-matched trail','gap','P0','Trail exists in DB, no UI'),
  ('loans-exposure','executive','Portfolio concentration heatmap','gap','P0','Not present'),
  ('loans-exposure','auditor','Point-in-time snapshot export','gap','P0','Not present'),
  ('digital-twin','platform_admin','Node drill to shard metrics','gap','P0','Not present'),
  ('digital-twin','security_admin','CMEK overlay','gap','P0','Not present'),
  ('attestations','compliance','Auto-register to evidence pack','gap','P0','Not present'),
  ('platform-admin','ciso','Step-up on destructive admin fns','gap','P0','Decorator not applied everywhere'),
  ('platform-admin','support','Impersonation with WORM audit','gap','P0','No impersonation surface')
ON CONFLICT (surface, persona, expected) DO NOTHING;
