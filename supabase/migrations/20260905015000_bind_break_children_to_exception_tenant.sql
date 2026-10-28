-- Bind denormalized child tenant IDs to the authoritative parent exception.
-- A caller cannot label a comment/attachment as their tenant while pointing
-- at another tenant's exception.

CREATE OR REPLACE FUNCTION private.tg_bind_break_child_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant
  FROM public.recon_exceptions
  WHERE id = NEW.exception_id;

  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'Parent reconciliation exception not found'
      USING ERRCODE = '23503';
  END IF;

  NEW.tenant_id := parent_tenant;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.tg_bind_break_child_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bind_break_comment_tenant ON public.break_comments;
CREATE TRIGGER trg_bind_break_comment_tenant
  BEFORE INSERT OR UPDATE OF exception_id, tenant_id ON public.break_comments
  FOR EACH ROW EXECUTE FUNCTION private.tg_bind_break_child_tenant();

DROP TRIGGER IF EXISTS trg_bind_break_attachment_tenant ON public.break_attachments;
CREATE TRIGGER trg_bind_break_attachment_tenant
  BEFORE INSERT OR UPDATE OF exception_id, tenant_id ON public.break_attachments
  FOR EACH ROW EXECUTE FUNCTION private.tg_bind_break_child_tenant();

DROP POLICY IF EXISTS bc_select ON public.break_comments;
DROP POLICY IF EXISTS bc_insert ON public.break_comments;
DROP POLICY IF EXISTS bc_delete_own ON public.break_comments;

CREATE POLICY bc_select ON public.break_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = exception_id
        AND e.tenant_id = tenant_id
        AND (private.is_tenant_member(auth.uid(), e.tenant_id) OR private.is_platform_admin(auth.uid()))
    )
  );

CREATE POLICY bc_insert ON public.break_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = exception_id
        AND e.tenant_id = tenant_id
        AND private.is_tenant_member(auth.uid(), e.tenant_id)
    )
  );

CREATE POLICY bc_delete_own ON public.break_comments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = exception_id
        AND e.tenant_id = tenant_id
        AND (
          author_id = auth.uid()
          OR private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_admin'::tenant_role)
        )
    )
  );

DROP POLICY IF EXISTS ba_select ON public.break_attachments;
DROP POLICY IF EXISTS ba_write ON public.break_attachments;

CREATE POLICY ba_select ON public.break_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = exception_id
        AND e.tenant_id = tenant_id
        AND (private.is_tenant_member(auth.uid(), e.tenant_id) OR private.is_platform_admin(auth.uid()))
    )
  );

CREATE POLICY ba_write ON public.break_attachments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = exception_id
        AND e.tenant_id = tenant_id
        AND (
          private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_analyst'::tenant_role)
          OR private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_admin'::tenant_role)
        )
    )
  )
  WITH CHECK (
    uploader_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = exception_id
        AND e.tenant_id = tenant_id
        AND (
          private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_analyst'::tenant_role)
          OR private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_admin'::tenant_role)
        )
    )
  );
