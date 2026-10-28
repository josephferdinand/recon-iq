-- Restrictive policies are ANDed with the existing permissive policies. This
-- closes the inactive-tenant-member path without replacing the shared role
-- helpers or changing the existing analyst/admin permissions.
-- Apply only after 20260923090400 and a PROD policy-catalogue readback.

CREATE FUNCTION private.is_active_exception_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members m
    WHERE _user_id = auth.uid()
      AND m.user_id = _user_id AND m.tenant_id = _tenant_id AND m.active
  )
$$;
REVOKE ALL ON FUNCTION private.is_active_exception_tenant_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_exception_tenant_member(uuid, uuid) TO authenticated, service_role;

CREATE POLICY recon_exc_active_membership_gate
  ON public.recon_exceptions AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    private.is_platform_admin(auth.uid())
    OR private.is_active_exception_tenant_member(auth.uid(), public.recon_exceptions.tenant_id)
  )
  WITH CHECK (
    private.is_platform_admin(auth.uid())
    OR private.is_active_exception_tenant_member(auth.uid(), public.recon_exceptions.tenant_id)
  );

CREATE POLICY break_comments_active_membership_gate
  ON public.break_comments AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (private.is_platform_admin(auth.uid())
      OR private.is_active_exception_tenant_member(auth.uid(), public.break_comments.tenant_id))
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = public.break_comments.exception_id
        AND e.tenant_id = public.break_comments.tenant_id
    )
  )
  WITH CHECK (
    (private.is_platform_admin(auth.uid())
      OR private.is_active_exception_tenant_member(auth.uid(), public.break_comments.tenant_id))
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = public.break_comments.exception_id
        AND e.tenant_id = public.break_comments.tenant_id
    )
  );

CREATE POLICY break_attachments_active_membership_gate
  ON public.break_attachments AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (private.is_platform_admin(auth.uid())
      OR private.is_active_exception_tenant_member(auth.uid(), public.break_attachments.tenant_id))
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = public.break_attachments.exception_id
        AND e.tenant_id = public.break_attachments.tenant_id
    )
  )
  WITH CHECK (
    (private.is_platform_admin(auth.uid())
      OR private.is_active_exception_tenant_member(auth.uid(), public.break_attachments.tenant_id))
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = public.break_attachments.exception_id
        AND e.tenant_id = public.break_attachments.tenant_id
    )
  );

CREATE POLICY recon_exception_transitions_active_membership_gate
  ON public.recon_exception_transitions AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (private.is_platform_admin(auth.uid()) OR private.is_active_exception_tenant_member(auth.uid(), public.recon_exception_transitions.tenant_id))
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = public.recon_exception_transitions.exception_id
        AND e.tenant_id = public.recon_exception_transitions.tenant_id
    )
  )
  WITH CHECK (
    (private.is_platform_admin(auth.uid()) OR private.is_active_exception_tenant_member(auth.uid(), public.recon_exception_transitions.tenant_id))
    AND EXISTS (
      SELECT 1 FROM public.recon_exceptions e
      WHERE e.id = public.recon_exception_transitions.exception_id
        AND e.tenant_id = public.recon_exception_transitions.tenant_id
    )
  );
