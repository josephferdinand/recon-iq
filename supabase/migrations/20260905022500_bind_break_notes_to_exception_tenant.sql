-- Structured break notes must belong to an existing exception and inherit its
-- tenant. The original table had neither a parent FK nor tenant equality.

ALTER TABLE public.break_notes
  ADD CONSTRAINT break_notes_break_id_fkey
  FOREIGN KEY (break_id) REFERENCES public.recon_exceptions(id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.break_notes VALIDATE CONSTRAINT break_notes_break_id_fkey;

CREATE OR REPLACE FUNCTION private.tg_bind_break_note_tenant()
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
  WHERE id = NEW.break_id;

  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'Parent reconciliation exception not found'
      USING ERRCODE = '23503';
  END IF;

  NEW.tenant_id := parent_tenant;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.tg_bind_break_note_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bind_break_note_tenant ON public.break_notes;
CREATE TRIGGER trg_bind_break_note_tenant
  BEFORE INSERT OR UPDATE OF break_id, tenant_id ON public.break_notes
  FOR EACH ROW EXECUTE FUNCTION private.tg_bind_break_note_tenant();

DROP POLICY IF EXISTS bn_read ON public.break_notes;
DROP POLICY IF EXISTS bn_insert ON public.break_notes;
DROP POLICY IF EXISTS bn_update_own_or_admin ON public.break_notes;
DROP POLICY IF EXISTS bn_delete_own_or_admin ON public.break_notes;

CREATE POLICY bn_read ON public.break_notes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = break_id
        AND e.tenant_id = tenant_id
        AND (private.is_tenant_member(auth.uid(), e.tenant_id) OR private.is_platform_admin(auth.uid()))
    )
  );

CREATE POLICY bn_insert ON public.break_notes FOR INSERT TO authenticated
  WITH CHECK (
    author = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = break_id
        AND e.tenant_id = tenant_id
        AND (
          private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_analyst'::tenant_role)
          OR private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_admin'::tenant_role)
        )
    )
  );

CREATE POLICY bn_update_own_or_admin ON public.break_notes FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = break_id
        AND e.tenant_id = tenant_id
        AND (
          author = auth.uid()
          OR private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_admin'::tenant_role)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = break_id
        AND e.tenant_id = tenant_id
        AND (
          author = auth.uid()
          OR private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_admin'::tenant_role)
        )
    )
  );

CREATE POLICY bn_delete_own_or_admin ON public.break_notes FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = break_id
        AND e.tenant_id = tenant_id
        AND (
          author = auth.uid()
          OR private.has_tenant_role(auth.uid(), e.tenant_id, 'tenant_admin'::tenant_role)
        )
    )
  );
