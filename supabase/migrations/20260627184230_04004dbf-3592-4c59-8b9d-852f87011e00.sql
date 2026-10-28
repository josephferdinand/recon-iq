
CREATE EXTENSION IF NOT EXISTS ltree;

DO $$ BEGIN
  CREATE TYPE public.bu_role AS ENUM ('bu_admin','bu_member','bu_viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.business_units(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text,
  description text,
  path ltree,
  depth int NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, parent_id, name)
);
CREATE INDEX IF NOT EXISTS idx_bu_tenant ON public.business_units(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bu_parent ON public.business_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_bu_path ON public.business_units USING gist(path);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_units TO authenticated;
GRANT ALL ON public.business_units TO service_role;
ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bu_user_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bu_id uuid NOT NULL REFERENCES public.business_units(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.bu_role NOT NULL DEFAULT 'bu_member',
  inherit_descendants boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bu_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_buua_user ON public.bu_user_assignments(user_id, tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bu_user_assignments TO authenticated;
GRANT ALL ON public.bu_user_assignments TO service_role;
ALTER TABLE public.bu_user_assignments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bu_group_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bu_id uuid NOT NULL REFERENCES public.business_units(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.tenant_groups(id) ON DELETE CASCADE,
  role public.bu_role NOT NULL DEFAULT 'bu_member',
  inherit_descendants boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bu_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_buga_group ON public.bu_group_assignments(group_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bu_group_assignments TO authenticated;
GRANT ALL ON public.bu_group_assignments TO service_role;
ALTER TABLE public.bu_group_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tg_bu_set_path()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_parent_path ltree; v_parent_depth int; v_label text;
BEGIN
  v_label := replace(replace(NEW.id::text,'-','_'),'.','_');
  IF NEW.parent_id IS NULL THEN
    NEW.path := text2ltree(v_label);
    NEW.depth := 0;
  ELSE
    SELECT path, depth INTO v_parent_path, v_parent_depth FROM public.business_units WHERE id = NEW.parent_id;
    IF v_parent_path IS NULL THEN RAISE EXCEPTION 'Parent BU not found'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.path IS NOT NULL AND v_parent_path <@ OLD.path THEN
      RAISE EXCEPTION 'BU reparent would create cycle';
    END IF;
    NEW.path := v_parent_path || v_label;
    NEW.depth := v_parent_depth + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bu_set_path ON public.business_units;
CREATE TRIGGER bu_set_path BEFORE INSERT OR UPDATE OF parent_id ON public.business_units
  FOR EACH ROW EXECUTE FUNCTION public.tg_bu_set_path();

DROP TRIGGER IF EXISTS bu_updated_at ON public.business_units;
CREATE TRIGGER bu_updated_at BEFORE UPDATE ON public.business_units
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.user_bu_scope(_user uuid, _tenant uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH direct_user AS (
    SELECT bu_id, inherit_descendants FROM public.bu_user_assignments
    WHERE user_id = _user AND tenant_id = _tenant
  ),
  direct_group AS (
    SELECT bga.bu_id, bga.inherit_descendants FROM public.bu_group_assignments bga
    JOIN public.tenant_group_members tgm ON tgm.group_id = bga.group_id
    WHERE tgm.user_id = _user AND bga.tenant_id = _tenant
  ),
  all_direct AS (
    SELECT * FROM direct_user UNION SELECT * FROM direct_group
  )
  SELECT bu.id
  FROM public.business_units bu
  WHERE bu.tenant_id = _tenant
    AND EXISTS (
      SELECT 1 FROM all_direct ad
      JOIN public.business_units src ON src.id = ad.bu_id
      WHERE bu.id = src.id
         OR (ad.inherit_descendants AND bu.path <@ src.path)
    )
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_bu(_user uuid, _tenant uuid, _bu uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user)
      OR public.has_tenant_role(_user, _tenant, 'tenant_admin')
      OR EXISTS (SELECT 1 FROM public.user_bu_scope(_user, _tenant) s WHERE s = _bu)
$$;

CREATE POLICY bu_select ON public.business_units FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR EXISTS (SELECT 1 FROM public.user_bu_scope(auth.uid(), tenant_id) s WHERE s = id)
  );

CREATE POLICY bu_write ON public.business_units FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  );

CREATE POLICY buua_select ON public.bu_user_assignments FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR user_id = auth.uid()
  );
CREATE POLICY buua_write ON public.bu_user_assignments FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  );

CREATE POLICY buga_select ON public.bu_group_assignments FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR EXISTS (SELECT 1 FROM public.tenant_group_members tgm WHERE tgm.group_id = bu_group_assignments.group_id AND tgm.user_id = auth.uid())
  );
CREATE POLICY buga_write ON public.bu_group_assignments FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  );

ALTER TABLE public.recon_definitions ADD COLUMN IF NOT EXISTS bu_id uuid REFERENCES public.business_units(id) ON DELETE SET NULL;
ALTER TABLE public.workspace_data_sources ADD COLUMN IF NOT EXISTS bu_id uuid REFERENCES public.business_units(id) ON DELETE SET NULL;
ALTER TABLE public.data_prep_pipelines ADD COLUMN IF NOT EXISTS bu_id uuid REFERENCES public.business_units(id) ON DELETE SET NULL;
ALTER TABLE public.saved_views ADD COLUMN IF NOT EXISTS bu_id uuid REFERENCES public.business_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recon_def_bu ON public.recon_definitions(bu_id);
CREATE INDEX IF NOT EXISTS idx_wds_bu ON public.workspace_data_sources(bu_id);
CREATE INDEX IF NOT EXISTS idx_dpp_bu ON public.data_prep_pipelines(bu_id);
