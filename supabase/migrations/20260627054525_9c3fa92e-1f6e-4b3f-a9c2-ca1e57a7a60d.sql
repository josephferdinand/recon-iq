
-- Workspace data sources (Phase C)
CREATE TABLE public.workspace_data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  source_type text NOT NULL CHECK (source_type IN ('csv','xlsx','json','api','database','manual')),
  connection_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  inferred_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','error','archived')),
  last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX workspace_data_sources_tenant_idx ON public.workspace_data_sources(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_data_sources TO authenticated;
GRANT ALL ON public.workspace_data_sources TO service_role;

ALTER TABLE public.workspace_data_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "data_sources_select_member" ON public.workspace_data_sources
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE POLICY "data_sources_write_analyst" ON public.workspace_data_sources
  FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
  );

CREATE TRIGGER trg_workspace_data_sources_updated_at
  BEFORE UPDATE ON public.workspace_data_sources
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Uploads (file ingestion metadata, blob held client-side for now)
CREATE TABLE public.workspace_data_source_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  row_count integer NOT NULL DEFAULT 0,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_sha256 text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_uploads_ds_idx ON public.workspace_data_source_uploads(data_source_id);
CREATE INDEX workspace_uploads_tenant_idx ON public.workspace_data_source_uploads(tenant_id);

GRANT SELECT, INSERT, DELETE ON public.workspace_data_source_uploads TO authenticated;
GRANT ALL ON public.workspace_data_source_uploads TO service_role;

ALTER TABLE public.workspace_data_source_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uploads_select_member" ON public.workspace_data_source_uploads
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE POLICY "uploads_write_analyst" ON public.workspace_data_source_uploads
  FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
  );
