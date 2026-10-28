
-- 1) recon_definitions: require analyst/admin on writes
ALTER POLICY recon_defs_write ON public.recon_definitions
  USING (
    private.user_can_access_recon(auth.uid(), id, 'edit'::text)
    AND (
      private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    )
  )
  WITH CHECK (
    private.user_can_access_recon(auth.uid(), id, 'edit'::text)
    AND (
      private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    )
  );

-- 2) storage aidp bucket: writes require analyst/admin
DROP POLICY IF EXISTS aidp_objects_insert ON storage.objects;
DROP POLICY IF EXISTS aidp_objects_update ON storage.objects;
DROP POLICY IF EXISTS aidp_objects_delete ON storage.objects;

CREATE POLICY aidp_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'aidp'
    AND (
      public.is_platform_admin(auth.uid())
      OR public.has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_admin'::tenant_role)
      OR public.has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_analyst'::tenant_role)
    )
  );

CREATE POLICY aidp_objects_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'aidp'
    AND (
      public.is_platform_admin(auth.uid())
      OR public.has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_admin'::tenant_role)
      OR public.has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_analyst'::tenant_role)
    )
  )
  WITH CHECK (
    bucket_id = 'aidp'
    AND (
      public.is_platform_admin(auth.uid())
      OR public.has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_admin'::tenant_role)
      OR public.has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_analyst'::tenant_role)
    )
  );

CREATE POLICY aidp_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'aidp'
    AND (
      public.is_platform_admin(auth.uid())
      OR public.has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_admin'::tenant_role)
      OR public.has_tenant_role(auth.uid(), ((string_to_array(name,'/'))[1])::uuid, 'tenant_analyst'::tenant_role)
    )
  );

-- 3) profiles: hard deny anonymous access (defense-in-depth on top of existing policies)
DROP POLICY IF EXISTS profiles_deny_anon ON public.profiles;
CREATE POLICY profiles_deny_anon ON public.profiles
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);
