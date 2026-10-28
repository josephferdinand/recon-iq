
CREATE TABLE IF NOT EXISTS public.kb_article_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  scope text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('workspace','tenant','platform')),
  body_md text NOT NULL,
  default_soc2_controls text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.kb_article_templates TO authenticated;
GRANT ALL ON public.kb_article_templates TO service_role;
ALTER TABLE public.kb_article_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb_templates read" ON public.kb_article_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "kb_templates write" ON public.kb_article_templates FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.kb_article_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.kb_articles(id) ON DELETE CASCADE,
  step_number int NOT NULL,
  title text NOT NULL,
  body_md text,
  screenshot_url text,
  callouts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, step_number)
);
CREATE INDEX IF NOT EXISTS idx_kb_article_steps_article ON public.kb_article_steps(article_id, step_number);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_article_steps TO authenticated;
GRANT ALL ON public.kb_article_steps TO service_role;
ALTER TABLE public.kb_article_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb_steps read" ON public.kb_article_steps FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.kb_articles a WHERE a.id = article_id)
);
CREATE POLICY "kb_steps write" ON public.kb_article_steps FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.kb_article_soc2_controls (
  article_id uuid NOT NULL REFERENCES public.kb_articles(id) ON DELETE CASCADE,
  control_code text NOT NULL,
  rationale text,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, control_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_article_soc2_controls TO authenticated;
GRANT ALL ON public.kb_article_soc2_controls TO service_role;
ALTER TABLE public.kb_article_soc2_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb_soc2 read" ON public.kb_article_soc2_controls FOR SELECT TO authenticated USING (true);
CREATE POLICY "kb_soc2 write" ON public.kb_article_soc2_controls FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

INSERT INTO public.kb_article_templates (key, name, description, scope, body_md, default_soc2_controls) VALUES
  ('how_to', 'How-To Walkthrough', 'Step-by-step procedure with screenshots and callouts.', 'tenant',
   E'# {{title}}\n\n## Overview\n{{summary}}\n\n## Prerequisites\n- Role: {{required_role}}\n- Required permissions: {{required_perms}}\n\n## Steps\n_Managed as structured blocks with screenshots and callouts below._\n\n## Verification\n## Troubleshooting\n## SOC 2 Controls\n_Wired automatically._',
   ARRAY['CC6.1','CC7.2']),
  ('admin_runbook', 'Admin Runbook', 'Tenant / Platform admin operational runbook.', 'platform',
   E'# {{title}}\n\n## When to use\n## Pre-checks\n## Steps\n## Rollback\n## Audit Evidence\n## SOC 2 Controls',
   ARRAY['CC8.1','CC6.3','CC7.3']),
  ('security_incident', 'Security Incident Response', 'Incident handling SOP.', 'platform',
   E'# {{title}}\n\n## Severity & SLA\n## Detection\n## Containment\n## Eradication\n## Recovery\n## Post-mortem\n## SOC 2 Controls',
   ARRAY['CC7.3','CC7.4','CC7.5']),
  ('feature_intro', 'Feature Introduction', 'Quick-start for end users.', 'workspace',
   E'# {{title}}\n\n## What it does\n## When to use it\n## How it works\n## Tips\n## Related articles\n## SOC 2 Controls',
   ARRAY['CC6.1'])
ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, body_md=EXCLUDED.body_md,
  default_soc2_controls=EXCLUDED.default_soc2_controls, updated_at=now();

CREATE TABLE IF NOT EXISTS public.platform_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_groups TO authenticated;
GRANT ALL ON public.platform_groups TO service_role;
ALTER TABLE public.platform_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pg read" ON public.platform_groups FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pg write" ON public.platform_groups FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_group_roles (
  group_id uuid NOT NULL REFERENCES public.platform_groups(id) ON DELETE CASCADE,
  role public.platform_role NOT NULL,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_group_roles TO authenticated;
GRANT ALL ON public.platform_group_roles TO service_role;
ALTER TABLE public.platform_group_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pgr read" ON public.platform_group_roles FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pgr write" ON public.platform_group_roles FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_group_members (
  group_id uuid NOT NULL REFERENCES public.platform_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_group_members TO authenticated;
GRANT ALL ON public.platform_group_members TO service_role;
ALTER TABLE public.platform_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pgm read" ON public.platform_group_members FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pgm write" ON public.platform_group_members FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.user_has_platform_role(_user_id uuid, _role public.platform_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id=_user_id AND role=_role)
      OR EXISTS (
        SELECT 1 FROM public.platform_group_members m
        JOIN public.platform_group_roles r ON r.group_id=m.group_id
        WHERE m.user_id=_user_id AND r.role=_role
      );
$$;
REVOKE EXECUTE ON FUNCTION public.user_has_platform_role(uuid, public.platform_role) FROM public;
GRANT EXECUTE ON FUNCTION public.user_has_platform_role(uuid, public.platform_role) TO authenticated, service_role;

ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS added_by_platform boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tenants_seed_platform_admin_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid;
BEGIN
  FOR _uid IN
    SELECT user_id FROM public.platform_roles WHERE role='platform_admin'::public.platform_role
    UNION
    SELECT m.user_id
      FROM public.platform_group_members m
      JOIN public.platform_group_roles r ON r.group_id=m.group_id
      WHERE r.role='platform_admin'::public.platform_role
  LOOP
    INSERT INTO public.tenant_members (tenant_id, user_id, role, active, added_by_platform)
    VALUES (NEW.id, _uid, 'tenant_admin', true, true)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_seed_platform_admins ON public.tenants;
CREATE TRIGGER trg_tenants_seed_platform_admins
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_seed_platform_admin_members();
