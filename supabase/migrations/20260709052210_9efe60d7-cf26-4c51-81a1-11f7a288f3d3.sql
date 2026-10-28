
CREATE TABLE IF NOT EXISTS public.tenant_workspace_page_visibility (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, page_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_workspace_page_visibility TO authenticated;
GRANT ALL ON public.tenant_workspace_page_visibility TO service_role;

ALTER TABLE public.tenant_workspace_page_visibility ENABLE ROW LEVEL SECURITY;

-- Any tenant member (or platform admin) can read
CREATE POLICY "read: tenant members"
  ON public.tenant_workspace_page_visibility FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = tenant_workspace_page_visibility.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

-- Only tenant_admin / platform_admin can write
CREATE POLICY "write: tenant admins"
  ON public.tenant_workspace_page_visibility FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_workspace_page_visibility.tenant_id, 'tenant_admin')
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_workspace_page_visibility.tenant_id, 'tenant_admin')
  );

CREATE INDEX IF NOT EXISTS idx_twpv_tenant ON public.tenant_workspace_page_visibility(tenant_id);
