
-- bulk_resolution_jobs — require created_by = auth.uid() on INSERT
DROP POLICY IF EXISTS "brj insert analyst admin" ON public.bulk_resolution_jobs;
CREATE POLICY "brj insert analyst admin"
  ON public.bulk_resolution_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = bulk_resolution_jobs.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active
        AND tm.role::text IN ('tenant_admin','analyst','operator')
    )
  );

-- schema_per_tenant_requests — require requested_by = auth.uid() on INSERT
DROP POLICY IF EXISTS "sptr_write" ON public.schema_per_tenant_requests;
CREATE POLICY "sptr_write"
  ON public.schema_per_tenant_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = schema_per_tenant_requests.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active
    )
  );

-- journal_entries — enforce created_by = auth.uid() on INSERT
DROP POLICY IF EXISTS "je insert analyst admin" ON public.journal_entries;
CREATE POLICY "je insert analyst admin"
  ON public.journal_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = journal_entries.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active
        AND tm.role::text IN ('tenant_admin','analyst','operator')
    )
  );
