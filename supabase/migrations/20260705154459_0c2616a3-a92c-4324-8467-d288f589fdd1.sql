
-- 1. journal_entries: restrict INSERT to analyst/admin
DROP POLICY IF EXISTS "je insert" ON public.journal_entries;
CREATE POLICY "je insert analyst admin" ON public.journal_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  );

-- 2. recon_match_allocations: restrict ALL to analyst/admin
DROP POLICY IF EXISTS "tenant admins write allocations" ON public.recon_match_allocations;
CREATE POLICY "allocations write analyst admin" ON public.recon_match_allocations
  FOR ALL TO authenticated
  USING (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  )
  WITH CHECK (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  );

-- 3. break_sla_timers: restrict writes to analyst/admin
DROP POLICY IF EXISTS "sla_tim write" ON public.break_sla_timers;
CREATE POLICY "sla_tim write analyst admin" ON public.break_sla_timers
  FOR ALL TO authenticated
  USING (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  )
  WITH CHECK (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  );

-- 4. bulk_resolution_jobs: restrict INSERT to analyst/admin
DROP POLICY IF EXISTS "brj insert" ON public.bulk_resolution_jobs;
CREATE POLICY "brj insert analyst admin" ON public.bulk_resolution_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  );

-- 5. counterparty_threads: restrict writes to analyst/admin
DROP POLICY IF EXISTS "cpt write" ON public.counterparty_threads;
CREATE POLICY "cpt write analyst admin" ON public.counterparty_threads
  FOR ALL TO authenticated
  USING (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  )
  WITH CHECK (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  );
