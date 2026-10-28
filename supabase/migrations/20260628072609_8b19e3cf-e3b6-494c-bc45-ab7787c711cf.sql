
-- 1) EOD signoffs: writers only
DROP POLICY IF EXISTS "eod_write" ON public.eod_signoffs;
DROP POLICY IF EXISTS "eod_update" ON public.eod_signoffs;
CREATE POLICY "eod_write" ON public.eod_signoffs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );
CREATE POLICY "eod_update" ON public.eod_signoffs FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 2) Predictive labels: writers only
DROP POLICY IF EXISTS "pl_write" ON public.predictive_labels;
DROP POLICY IF EXISTS "pl_update" ON public.predictive_labels;
CREATE POLICY "pl_write" ON public.predictive_labels FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );
CREATE POLICY "pl_update" ON public.predictive_labels FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 3) Process wizard runs: writers only
DROP POLICY IF EXISTS "pwz_write" ON public.process_wizard_runs;
DROP POLICY IF EXISTS "pwz_update" ON public.process_wizard_runs;
CREATE POLICY "pwz_write" ON public.process_wizard_runs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );
CREATE POLICY "pwz_update" ON public.process_wizard_runs FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 4) Run kill switches: writers only
DROP POLICY IF EXISTS "kill_write" ON public.run_kill_switches;
DROP POLICY IF EXISTS "kill_update" ON public.run_kill_switches;
CREATE POLICY "kill_write" ON public.run_kill_switches FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );
CREATE POLICY "kill_update" ON public.run_kill_switches FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 5) AIDP write tables: writers only
DROP POLICY IF EXISTS "aidp_d_write" ON public.aidp_documents;
CREATE POLICY "aidp_d_write" ON public.aidp_documents FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "aidp_annotations_write" ON public.aidp_annotations;
CREATE POLICY "aidp_annotations_write" ON public.aidp_annotations FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "aidp_predictions_write" ON public.aidp_predictions;
CREATE POLICY "aidp_predictions_write" ON public.aidp_predictions FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "aidp_pred_fields_write" ON public.aidp_prediction_fields;
CREATE POLICY "aidp_pred_fields_write" ON public.aidp_prediction_fields FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "aidp_pages_write" ON public.aidp_pages;
CREATE POLICY "aidp_pages_write" ON public.aidp_pages FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "tenant_members_insert_aidp_outputs" ON public.aidp_outputs;
CREATE POLICY "tenant_members_insert_aidp_outputs" ON public.aidp_outputs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "tenant_members_rw_aidp_invalidations" ON public.aidp_output_recon_invalidations;
CREATE POLICY "tenant_members_rw_aidp_invalidations" ON public.aidp_output_recon_invalidations FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 6) Data lineage edges: writers only
DROP POLICY IF EXISTS "lineage tenant write" ON public.data_lineage_edges;
CREATE POLICY "lineage tenant write" ON public.data_lineage_edges FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 7) Recon exception transitions: writers only
DROP POLICY IF EXISTS "rxt_insert_member" ON public.recon_exception_transitions;
CREATE POLICY "rxt_insert_writer" ON public.recon_exception_transitions FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid() AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
      public.is_platform_admin(auth.uid())
    )
  );

-- 8) Audit log: tenant-scoped rows must be inserted by a member of that tenant
DROP POLICY IF EXISTS "Authenticated insert audit" ON public.audit_log;
CREATE POLICY "Authenticated insert audit" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (
    (actor_user_id IS NULL OR actor_user_id = auth.uid())
    AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()))
  );

-- 9) Security events: tenant-scoped rows must be from a member of that tenant
DROP POLICY IF EXISTS "auth insert events" ON public.security_events;
CREATE POLICY "auth insert events" ON public.security_events FOR INSERT TO authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()))
  );

-- 10) Agent action policies: platform-level defaults only readable by platform admins
DROP POLICY IF EXISTS "agent_action_policies tenant read" ON public.agent_action_policies;
CREATE POLICY "agent_action_policies tenant read" ON public.agent_action_policies FOR SELECT TO authenticated
  USING (
    (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id))
    OR public.is_platform_admin(auth.uid())
  );

-- 11) Step-up grants: revoke direct INSERT, keep owner SELECT/UPDATE/DELETE
DROP POLICY IF EXISTS "step_up_grants owner only" ON public.step_up_grants;
CREATE POLICY "step_up_grants owner select" ON public.step_up_grants FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "step_up_grants owner update" ON public.step_up_grants FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "step_up_grants owner delete" ON public.step_up_grants FOR DELETE TO authenticated
  USING (user_id = auth.uid());
-- (no INSERT policy: only service_role / SECURITY DEFINER paths may mint grants)
