
-- 1. Extend tenant_groups for BU scoping + presets
ALTER TABLE public.tenant_groups
  ADD COLUMN IF NOT EXISTS bu_id uuid REFERENCES public.business_units(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preset_key text;

-- regular UNIQUE (not partial) so ON CONFLICT works; NULLs distinct in PG.
DROP INDEX IF EXISTS public.tenant_groups_tenant_preset_uq;
ALTER TABLE public.tenant_groups DROP CONSTRAINT IF EXISTS tenant_groups_tenant_preset_uq;
ALTER TABLE public.tenant_groups
  ADD CONSTRAINT tenant_groups_tenant_preset_uq UNIQUE (tenant_id, preset_key);
CREATE INDEX IF NOT EXISTS tenant_groups_bu_idx ON public.tenant_groups(bu_id);

-- 2. Replace enum-based tenant_group_roles with FK to rbac_roles
DROP TABLE IF EXISTS public.tenant_group_roles;
CREATE TABLE public.tenant_group_roles (
  group_id    uuid NOT NULL REFERENCES public.tenant_groups(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES public.rbac_roles(id) ON DELETE CASCADE,
  granted_by  uuid REFERENCES auth.users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, role_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_group_roles TO authenticated;
GRANT ALL ON public.tenant_group_roles TO service_role;
ALTER TABLE public.tenant_group_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read tenant_group_roles" ON public.tenant_group_roles FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.tenant_groups g
  WHERE g.id = tenant_group_roles.group_id
    AND (public.is_platform_admin(auth.uid())
         OR public.has_tenant_role(auth.uid(), g.tenant_id, 'tenant_admin'::tenant_role)
         OR public.has_tenant_role(auth.uid(), g.tenant_id, 'tenant_analyst'::tenant_role))));
CREATE POLICY "admins write tenant_group_roles" ON public.tenant_group_roles FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = tenant_group_roles.group_id
  AND (public.is_platform_admin(auth.uid())
       OR public.has_tenant_role(auth.uid(), g.tenant_id, 'tenant_admin'::tenant_role))))
WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = tenant_group_roles.group_id
  AND (public.is_platform_admin(auth.uid())
       OR public.has_tenant_role(auth.uid(), g.tenant_id, 'tenant_admin'::tenant_role))));

-- 3. Preset catalog
CREATE TABLE IF NOT EXISTS public.tenant_group_presets (
  preset_key   text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL,
  role_keys    text[] NOT NULL,
  sort_order   int NOT NULL DEFAULT 100,
  is_default   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tenant_group_presets TO authenticated, anon;
GRANT ALL    ON public.tenant_group_presets TO service_role;
ALTER TABLE public.tenant_group_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "presets public read" ON public.tenant_group_presets;
CREATE POLICY "presets public read" ON public.tenant_group_presets FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.tenant_group_presets(preset_key, name, description, role_keys, sort_order) VALUES
  ('tenant_administrators', 'Tenant Administrators','Full administrative control: users, roles, settings, billing.', ARRAY['tenant_admin','tenant_owner'], 10),
  ('operations',            'Recon Operations','Run reconciliations, action exceptions, manage daily workflow.', ARRAY['recon_operator','recon_manager'], 20),
  ('investigators',         'Break Investigators','Investigate exceptions and propose resolutions.', ARRAY['recon_operator'], 30),
  ('read_only',             'Read Only / Viewers','View dashboards, runs, exceptions — no edits.', ARRAY['recon_viewer'], 40),
  ('compliance',            'Compliance & Audit','Read access to audit, evidence, regulatory packs and sign-offs.', ARRAY['compliance_officer'], 50),
  ('data_engineering',      'Data Engineering','Manage data sources, ingestion, transforms, Data Prep.', ARRAY['data_engineer'], 60),
  ('security_admin',        'Security Administrators','SSO, MFA, IP allowlists, BYOK keys, break-glass.', ARRAY['security_admin'], 70),
  ('support_desk',          'Support Desk','Triage support tickets; assist users (no data writes).', ARRAY['support_agent'], 80),
  ('ai_stewards',           'AI Stewards','Manage AI models, budgets, prompts and feedback loops.', ARRAY['ai_steward'], 90)
ON CONFLICT (preset_key) DO UPDATE SET
  name=EXCLUDED.name, description=EXCLUDED.description, role_keys=EXCLUDED.role_keys;

-- 4. Seed function
CREATE OR REPLACE FUNCTION public.seed_default_tenant_groups(_tenant_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; g_id uuid; rk text; r_id uuid; created int := 0;
BEGIN
  FOR p IN SELECT * FROM public.tenant_group_presets WHERE is_default ORDER BY sort_order LOOP
    INSERT INTO public.tenant_groups (tenant_id, name, description, is_system, preset_key)
    VALUES (_tenant_id, p.name, p.description, true, p.preset_key)
    ON CONFLICT (tenant_id, preset_key) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description
    RETURNING id INTO g_id;
    created := created + 1;
    FOREACH rk IN ARRAY p.role_keys LOOP
      SELECT id INTO r_id FROM public.rbac_roles WHERE key = rk AND is_system LIMIT 1;
      IF r_id IS NOT NULL THEN
        INSERT INTO public.tenant_group_roles(group_id, role_id) VALUES (g_id, r_id) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
  RETURN created;
END $$;

-- 5. Auto-seed on tenant create
CREATE OR REPLACE FUNCTION public.trg_tenants_seed_groups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.seed_default_tenant_groups(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS tenants_seed_groups_aft_ins ON public.tenants;
CREATE TRIGGER tenants_seed_groups_aft_ins
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.trg_tenants_seed_groups();

-- 6. Backfill existing tenants
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP PERFORM public.seed_default_tenant_groups(t.id); END LOOP;
END $$;

-- 7. Effective-permissions resolver
CREATE OR REPLACE FUNCTION public.effective_user_permissions(
  _user_id uuid, _tenant_id uuid, _bu_id uuid DEFAULT NULL
) RETURNS TABLE(permission_id text, source text, role_id uuid, group_id uuid, bu_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rp.permission_id, 'direct'::text, g.role_id, NULL::uuid, g.scope_id
    FROM public.rbac_user_grants g
    JOIN public.rbac_role_permissions rp ON rp.role_id = g.role_id
   WHERE g.user_id = _user_id AND g.tenant_id = _tenant_id
     AND g.revoked_at IS NULL
     AND (g.expires_at IS NULL OR g.expires_at > now())
     AND (_bu_id IS NULL OR g.scope_type <> 'business_unit' OR g.scope_id = _bu_id)
  UNION
  SELECT rp.permission_id, 'group'::text, gr.role_id, tg.id, tg.bu_id
    FROM public.tenant_group_members m
    JOIN public.tenant_groups tg          ON tg.id = m.group_id
    JOIN public.tenant_group_roles gr     ON gr.group_id = tg.id
    JOIN public.rbac_role_permissions rp  ON rp.role_id = gr.role_id
   WHERE m.user_id = _user_id AND tg.tenant_id = _tenant_id
     AND (_bu_id IS NULL OR tg.bu_id IS NULL OR tg.bu_id = _bu_id)
  UNION
  SELECT rp.permission_id, 'bu_group'::text, gr.role_id, m.group_id, bga.bu_id
    FROM public.bu_group_assignments bga
    JOIN public.tenant_group_members m    ON m.group_id = bga.group_id
    JOIN public.tenant_group_roles gr     ON gr.group_id = bga.group_id
    JOIN public.rbac_role_permissions rp  ON rp.role_id = gr.role_id
   WHERE m.user_id = _user_id AND bga.tenant_id = _tenant_id
     AND (_bu_id IS NULL OR bga.bu_id = _bu_id);
$$;
GRANT EXECUTE ON FUNCTION public.effective_user_permissions(uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_has_permission(
  _user_id uuid, _tenant_id uuid, _permission_id text, _bu_id uuid DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.effective_user_permissions(_user_id,_tenant_id,_bu_id) e
                 WHERE e.permission_id = _permission_id);
$$;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid,uuid,text,uuid) TO authenticated;

-- 8. Touch trigger
CREATE OR REPLACE FUNCTION public.trg_tenant_groups_touch()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS tenant_groups_touch ON public.tenant_groups;
CREATE TRIGGER tenant_groups_touch BEFORE UPDATE ON public.tenant_groups
FOR EACH ROW EXECUTE FUNCTION public.trg_tenant_groups_touch();
