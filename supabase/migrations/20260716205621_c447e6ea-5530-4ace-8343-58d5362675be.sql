
CREATE TABLE IF NOT EXISTS public.entitlement_catalog (
  key text PRIMARY KEY,
  parent_key text REFERENCES public.entitlement_catalog(key) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  entry_type text NOT NULL CHECK (entry_type IN ('module','section','subsection','feature','capability','action','ai','integration','report','dashboard','automation','workflow','admin')),
  category text NOT NULL,
  default_enabled boolean NOT NULL DEFAULT false,
  min_plan text,
  requires text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entitlement_catalog_parent ON public.entitlement_catalog(parent_key);
CREATE INDEX IF NOT EXISTS idx_entitlement_catalog_category ON public.entitlement_catalog(category);
GRANT SELECT ON public.entitlement_catalog TO authenticated, anon;
GRANT ALL ON public.entitlement_catalog TO service_role;
ALTER TABLE public.entitlement_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog read all" ON public.entitlement_catalog FOR SELECT USING (true);
CREATE POLICY "catalog admin write" ON public.entitlement_catalog FOR ALL
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.entitlement_scope_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  catalog_key text NOT NULL REFERENCES public.entitlement_catalog(key) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('tenant','workspace','group','user')),
  scope_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  reason text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, catalog_key, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_ent_scope_lookup ON public.entitlement_scope_grants(tenant_id, catalog_key);
CREATE INDEX IF NOT EXISTS idx_ent_scope_target ON public.entitlement_scope_grants(scope_type, scope_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entitlement_scope_grants TO authenticated;
GRANT ALL ON public.entitlement_scope_grants TO service_role;
ALTER TABLE public.entitlement_scope_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scope grants read"
  ON public.entitlement_scope_grants FOR SELECT
  USING (
    public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = entitlement_scope_grants.tenant_id AND tm.user_id = auth.uid())
  );
CREATE POLICY "scope grants write"
  ON public.entitlement_scope_grants FOR ALL
  USING (
    public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = entitlement_scope_grants.tenant_id AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'::tenant_role)
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = entitlement_scope_grants.tenant_id AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'::tenant_role)
  );

CREATE TABLE IF NOT EXISTS public.entitlement_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  catalog_key text NOT NULL,
  scope_type text NOT NULL,
  scope_id uuid,
  action text NOT NULL,
  previous_enabled boolean,
  new_enabled boolean,
  actor_id uuid,
  actor_kind text NOT NULL DEFAULT 'user',
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ent_audit_tenant ON public.entitlement_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ent_audit_key ON public.entitlement_audit_log(catalog_key, created_at DESC);
GRANT SELECT, INSERT ON public.entitlement_audit_log TO authenticated;
GRANT ALL ON public.entitlement_audit_log TO service_role;
ALTER TABLE public.entitlement_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit read"
  ON public.entitlement_audit_log FOR SELECT
  USING (
    public.is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = entitlement_audit_log.tenant_id AND tm.user_id = auth.uid()))
  );
CREATE POLICY "audit insert"
  ON public.entitlement_audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.resolve_entitlement(
  _tenant_id uuid,
  _catalog_key text,
  _user_id uuid DEFAULT NULL,
  _workspace_id uuid DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.entitlement_catalog%ROWTYPE;
  _dep text;
  _platform boolean;
  _tenant boolean;
  _ws boolean;
  _user boolean;
  _group boolean;
BEGIN
  SELECT * INTO _row FROM public.entitlement_catalog WHERE key = _catalog_key AND is_active = true;
  IF NOT FOUND THEN RETURN false; END IF;
  FOREACH _dep IN ARRAY _row.requires LOOP
    IF NOT public.resolve_entitlement(_tenant_id, _dep, _user_id, _workspace_id) THEN RETURN false; END IF;
  END LOOP;
  IF _row.parent_key IS NOT NULL THEN
    IF NOT public.resolve_entitlement(_tenant_id, _row.parent_key, _user_id, _workspace_id) THEN RETURN false; END IF;
  END IF;
  SELECT allowed INTO _platform FROM public.tenant_feature_entitlements
    WHERE tenant_id = _tenant_id AND feature_key = _catalog_key LIMIT 1;
  IF _platform IS NULL THEN _platform := _row.default_enabled; END IF;
  IF NOT _platform THEN RETURN false; END IF;
  SELECT enabled INTO _tenant FROM public.entitlement_scope_grants
    WHERE tenant_id = _tenant_id AND catalog_key = _catalog_key AND scope_type='tenant' LIMIT 1;
  IF _tenant IS NOT NULL AND NOT _tenant THEN RETURN false; END IF;
  IF _workspace_id IS NOT NULL THEN
    SELECT enabled INTO _ws FROM public.entitlement_scope_grants
      WHERE tenant_id = _tenant_id AND catalog_key = _catalog_key AND scope_type='workspace' AND scope_id = _workspace_id LIMIT 1;
    IF _ws IS NOT NULL AND NOT _ws THEN RETURN false; END IF;
  END IF;
  IF _user_id IS NOT NULL THEN
    SELECT enabled INTO _user FROM public.entitlement_scope_grants
      WHERE tenant_id = _tenant_id AND catalog_key = _catalog_key AND scope_type='user' AND scope_id = _user_id LIMIT 1;
    IF _user IS NOT NULL THEN RETURN _user; END IF;
    SELECT bool_and(g.enabled) INTO _group FROM public.entitlement_scope_grants g
      JOIN public.tenant_group_members tgm ON tgm.group_id = g.scope_id
      WHERE g.tenant_id = _tenant_id AND g.catalog_key = _catalog_key AND g.scope_type='group' AND tgm.user_id = _user_id;
    IF _group IS NOT NULL AND NOT _group THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_entitlement(uuid, text, uuid, uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.entitlement_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_ent_catalog_touch ON public.entitlement_catalog;
CREATE TRIGGER trg_ent_catalog_touch BEFORE UPDATE ON public.entitlement_catalog
  FOR EACH ROW EXECUTE FUNCTION public.entitlement_touch_updated_at();
DROP TRIGGER IF EXISTS trg_ent_scope_touch ON public.entitlement_scope_grants;
CREATE TRIGGER trg_ent_scope_touch BEFORE UPDATE ON public.entitlement_scope_grants
  FOR EACH ROW EXECUTE FUNCTION public.entitlement_touch_updated_at();

INSERT INTO public.entitlement_catalog (key, parent_key, name, description, entry_type, category, default_enabled, sort_order) VALUES
  ('module.reconciliation', NULL, 'Reconciliation', 'Core reconciliation engine', 'module', 'core', true, 10),
  ('module.workspace', NULL, 'Workspace', 'Collaboration workspace surface', 'module', 'core', true, 20),
  ('module.ai_copilot', NULL, 'AI Copilot', 'Copilot chat, personas, agents', 'module', 'ai', true, 30),
  ('module.ai_governance', NULL, 'AI Governance', 'Model registry, drift, HITL, kill-switches', 'module', 'ai', true, 40),
  ('module.aidp', NULL, 'Intelligent Document Processing', 'AIDP OCR + extraction', 'module', 'ai', false, 50),
  ('module.reporting', NULL, 'Reporting & Analytics', 'Reports, dashboards, exports', 'module', 'reporting', true, 60),
  ('module.integrations', NULL, 'Integrations', 'ERP, Slack, webhooks, marketplace', 'module', 'integration', true, 70),
  ('module.automations', NULL, 'Automations & Workflows', 'Agent runbooks, schedules, triggers', 'module', 'automation', true, 80),
  ('module.security', NULL, 'Security & Compliance', 'RBAC, MFA, DLP, SOC2, DORA', 'module', 'security', true, 90),
  ('module.admin', NULL, 'Administration', 'Platform & tenant admin surface', 'module', 'admin', true, 100),
  ('module.marketplace', NULL, 'Marketplace', 'Plugins & regulatory packs', 'module', 'integration', false, 110),
  ('recon.one_sided', 'module.reconciliation', 'One-sided reconciliation', NULL, 'section', 'core', true, 1),
  ('recon.two_sided', 'module.reconciliation', 'Two-sided reconciliation', NULL, 'section', 'core', true, 2),
  ('recon.tri_party', 'module.reconciliation', 'Tri-party reconciliation', NULL, 'section', 'core', false, 3),
  ('recon.cascade', 'module.reconciliation', 'Cascade rules', NULL, 'section', 'core', true, 4),
  ('recon.ml_matching', 'module.reconciliation', 'ML-assisted matching', NULL, 'feature', 'ai', false, 5),
  ('recon.bulk_resolution', 'module.reconciliation', 'Bulk resolution', NULL, 'feature', 'core', true, 6),
  ('recon.evidence_packs', 'module.reconciliation', 'Evidence packs', NULL, 'feature', 'security', true, 7),
  ('workspace.tasks', 'module.workspace', 'Tasks', NULL, 'feature', 'workspace', true, 1),
  ('workspace.comments', 'module.workspace', 'Comments & mentions', NULL, 'feature', 'workspace', true, 2),
  ('workspace.announcements', 'module.workspace', 'Announcements', NULL, 'feature', 'workspace', true, 3),
  ('workspace.dashboards', 'module.workspace', 'Dashboards', NULL, 'feature', 'workspace', true, 4),
  ('workspace.templates', 'module.workspace', 'Templates', NULL, 'feature', 'workspace', true, 5),
  ('workspace.data_sources', 'module.workspace', 'Data sources', NULL, 'feature', 'workspace', true, 6),
  ('workspace.chat', 'module.workspace', 'Realtime chat', NULL, 'feature', 'workspace', false, 7),
  ('copilot.chat', 'module.ai_copilot', 'Chat', NULL, 'capability', 'ai', true, 1),
  ('copilot.personas', 'module.ai_copilot', 'Custom personas', NULL, 'capability', 'ai', true, 2),
  ('copilot.plugins', 'module.ai_copilot', 'Plugins', NULL, 'capability', 'ai', false, 3),
  ('copilot.agents', 'module.ai_copilot', 'Agentic workflows', NULL, 'capability', 'ai', false, 4),
  ('copilot.voice', 'module.ai_copilot', 'Voice interface', NULL, 'capability', 'ai', false, 5),
  ('ai_gov.model_registry', 'module.ai_governance', 'Model registry', NULL, 'feature', 'ai', true, 1),
  ('ai_gov.drift_detection', 'module.ai_governance', 'Drift detection', NULL, 'feature', 'ai', true, 2),
  ('ai_gov.hitl_queue', 'module.ai_governance', 'HITL queue', NULL, 'feature', 'ai', true, 3),
  ('ai_gov.kill_switch', 'module.ai_governance', 'Kill switches', NULL, 'feature', 'ai', true, 4),
  ('ai_gov.hallucination_metrics', 'module.ai_governance', 'Hallucination metrics', NULL, 'feature', 'ai', false, 5),
  ('ai_gov.byok', 'module.ai_governance', 'Bring-your-own LLM keys', NULL, 'feature', 'ai', false, 6),
  ('integ.erp', 'module.integrations', 'ERP connectors', NULL, 'integration', 'integration', true, 1),
  ('integ.slack', 'module.integrations', 'Slack', NULL, 'integration', 'integration', true, 2),
  ('integ.webhooks', 'module.integrations', 'Webhooks', NULL, 'integration', 'integration', true, 3),
  ('integ.email', 'module.integrations', 'Email digest', NULL, 'integration', 'integration', true, 4),
  ('integ.marketplace', 'module.integrations', 'Marketplace plugins', NULL, 'integration', 'integration', false, 5),
  ('integ.scim', 'module.integrations', 'SCIM provisioning', NULL, 'integration', 'security', false, 6),
  ('integ.sso_saml', 'module.integrations', 'SAML SSO', NULL, 'integration', 'security', true, 7),
  ('integ.sso_oidc', 'module.integrations', 'OIDC SSO', NULL, 'integration', 'security', true, 8),
  ('auto.runbooks', 'module.automations', 'Agent runbooks', NULL, 'automation', 'automation', true, 1),
  ('auto.workflows', 'module.automations', 'Agent workflows', NULL, 'automation', 'automation', true, 2),
  ('auto.schedules', 'module.automations', 'Schedules', NULL, 'automation', 'automation', true, 3),
  ('auto.event_triggers', 'module.automations', 'Event triggers', NULL, 'automation', 'automation', true, 4),
  ('auto.chatops', 'module.automations', 'ChatOps commands', NULL, 'automation', 'automation', false, 5),
  ('report.standard', 'module.reporting', 'Standard reports', NULL, 'report', 'reporting', true, 1),
  ('report.custom_builder', 'module.reporting', 'Custom report builder', NULL, 'report', 'reporting', true, 2),
  ('report.exports_csv', 'module.reporting', 'CSV/Excel export', NULL, 'capability', 'reporting', true, 3),
  ('report.exports_pdf', 'module.reporting', 'PDF export', NULL, 'capability', 'reporting', true, 4),
  ('report.scheduled', 'module.reporting', 'Scheduled reports', NULL, 'report', 'reporting', false, 5),
  ('report.reporting_db', 'module.reporting', 'Reporting DB exports', NULL, 'report', 'reporting', false, 6),
  ('sec.mfa_totp', 'module.security', 'TOTP MFA', NULL, 'feature', 'security', true, 1),
  ('sec.mfa_sms', 'module.security', 'SMS MFA', NULL, 'feature', 'security', false, 2),
  ('sec.webauthn', 'module.security', 'WebAuthn / passkeys', NULL, 'feature', 'security', true, 3),
  ('sec.trusted_devices', 'module.security', 'Trusted devices', NULL, 'feature', 'security', true, 4),
  ('sec.dlp', 'module.security', 'Data-loss prevention', NULL, 'feature', 'security', false, 5),
  ('sec.ip_allowlist', 'module.security', 'IP allowlist', NULL, 'feature', 'security', false, 6),
  ('sec.conditional_access', 'module.security', 'Conditional access', NULL, 'feature', 'security', false, 7),
  ('sec.break_glass', 'module.security', 'Break-glass access', NULL, 'feature', 'security', true, 8),
  ('sec.soc2_evidence', 'module.security', 'SOC2 evidence bundles', NULL, 'feature', 'security', true, 9),
  ('sec.dora', 'module.security', 'DORA register', NULL, 'feature', 'security', false, 10),
  ('admin.platform_console', 'module.admin', 'Platform admin console', NULL, 'admin', 'admin', true, 1),
  ('admin.tenant_console', 'module.admin', 'Tenant admin console', NULL, 'admin', 'admin', true, 2),
  ('admin.workspace_admin', 'module.admin', 'Workspace admin', NULL, 'admin', 'admin', true, 3),
  ('admin.audit_log', 'module.admin', 'Audit log viewer', NULL, 'admin', 'admin', true, 4),
  ('admin.billing', 'module.admin', 'Billing & invoices', NULL, 'admin', 'admin', true, 5),
  ('admin.rbac', 'module.admin', 'RBAC / roles', NULL, 'admin', 'admin', true, 6),
  ('mkt.install', 'module.marketplace', 'Install listings', NULL, 'action', 'integration', false, 1),
  ('mkt.publish', 'module.marketplace', 'Publish listings', NULL, 'action', 'integration', false, 2),
  ('aidp.ocr', 'module.aidp', 'OCR extraction', NULL, 'feature', 'ai', false, 1),
  ('aidp.entity_recognition', 'module.aidp', 'Entity recognition', NULL, 'feature', 'ai', false, 2),
  ('aidp.annotations', 'module.aidp', 'Annotations', NULL, 'feature', 'ai', false, 3)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  entry_type = EXCLUDED.entry_type,
  category = EXCLUDED.category,
  updated_at = now();
