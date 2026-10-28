
CREATE POLICY aidp_objects_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'aidp' AND (
      public.is_platform_admin(auth.uid())
      OR public.is_tenant_member(auth.uid(), ((string_to_array(name, '/'))[1])::uuid)
    )
  );
CREATE POLICY aidp_objects_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'aidp' AND (
      public.is_platform_admin(auth.uid())
      OR public.is_tenant_member(auth.uid(), ((string_to_array(name, '/'))[1])::uuid)
    )
  );
CREATE POLICY aidp_objects_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'aidp' AND (
      public.is_platform_admin(auth.uid())
      OR public.is_tenant_member(auth.uid(), ((string_to_array(name, '/'))[1])::uuid)
    )
  )
  WITH CHECK (
    bucket_id = 'aidp' AND (
      public.is_platform_admin(auth.uid())
      OR public.is_tenant_member(auth.uid(), ((string_to_array(name, '/'))[1])::uuid)
    )
  );
CREATE POLICY aidp_objects_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'aidp' AND (
      public.is_platform_admin(auth.uid())
      OR public.is_tenant_member(auth.uid(), ((string_to_array(name, '/'))[1])::uuid)
    )
  );
