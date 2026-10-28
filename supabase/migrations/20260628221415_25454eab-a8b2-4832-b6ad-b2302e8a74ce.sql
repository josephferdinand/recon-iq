
ALTER TABLE public.platform_groups
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preset_key text;
DROP INDEX IF EXISTS public.platform_groups_preset_uq;
ALTER TABLE public.platform_groups DROP CONSTRAINT IF EXISTS platform_groups_preset_uq;
ALTER TABLE public.platform_groups ADD CONSTRAINT platform_groups_preset_uq UNIQUE (preset_key);

CREATE TABLE IF NOT EXISTS public.platform_group_presets (
  preset_key   text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL,
  roles        public.platform_role[] NOT NULL,
  sort_order   int NOT NULL DEFAULT 100,
  is_default   boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.platform_group_presets TO authenticated;
GRANT ALL    ON public.platform_group_presets TO service_role;
ALTER TABLE public.platform_group_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pg_presets read auth" ON public.platform_group_presets;
CREATE POLICY "pg_presets read auth" ON public.platform_group_presets FOR SELECT TO authenticated USING (true);

INSERT INTO public.platform_group_presets(preset_key, name, description, roles, sort_order) VALUES
  ('platform_administrators', 'Platform Administrators',
   'Super-admin group: full control over every tenant, billing, AI, security and infra.',
   ARRAY['platform_admin']::public.platform_role[], 10),
  ('platform_operations', 'Platform Operations',
   'Day-to-day platform operations and tenant assistance (read + limited writes).',
   ARRAY['platform_member']::public.platform_role[], 20),
  ('platform_support',   'Platform Support Desk',
   'L1/L2 support staff: read access across tenants for triage.',
   ARRAY['platform_member']::public.platform_role[], 30),
  ('platform_readonly',  'Platform Read Only',
   'Auditors and observers — read-only across the platform.',
   ARRAY['platform_member']::public.platform_role[], 40),
  ('platform_billing',   'Billing & Finance',
   'Finance team — billing, subscriptions, invoices and revenue reports.',
   ARRAY['platform_member']::public.platform_role[], 50)
ON CONFLICT (preset_key) DO UPDATE SET
  name=EXCLUDED.name, description=EXCLUDED.description, roles=EXCLUDED.roles;

CREATE OR REPLACE FUNCTION public.seed_default_platform_groups()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; g_id uuid; r public.platform_role; created int := 0;
BEGIN
  FOR p IN SELECT * FROM public.platform_group_presets WHERE is_default ORDER BY sort_order LOOP
    INSERT INTO public.platform_groups (name, description, is_system, preset_key)
    VALUES (p.name, p.description, true, p.preset_key)
    ON CONFLICT (preset_key) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description
    RETURNING id INTO g_id;
    created := created + 1;
    FOREACH r IN ARRAY p.roles LOOP
      INSERT INTO public.platform_group_roles(group_id, role) VALUES (g_id, r) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN created;
END $$;

GRANT EXECUTE ON FUNCTION public.seed_default_platform_groups() TO authenticated;

SELECT public.seed_default_platform_groups();
