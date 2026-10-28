-- Restrict sensitive table policies to authenticated role only

-- eod_signoffs
DROP POLICY IF EXISTS eod_select ON public.eod_signoffs;
CREATE POLICY eod_select ON public.eod_signoffs
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));

-- exception_ageing_snapshots
DROP POLICY IF EXISTS age_select ON public.exception_ageing_snapshots;
CREATE POLICY age_select ON public.exception_ageing_snapshots
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));

DROP POLICY IF EXISTS age_insert ON public.exception_ageing_snapshots;
CREATE POLICY age_insert ON public.exception_ageing_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (is_tenant_member(auth.uid(), tenant_id));

-- predictive_labels
DROP POLICY IF EXISTS pl_select ON public.predictive_labels;
CREATE POLICY pl_select ON public.predictive_labels
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));

-- process_wizard_runs
DROP POLICY IF EXISTS pwz_select ON public.process_wizard_runs;
CREATE POLICY pwz_select ON public.process_wizard_runs
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));

-- run_kill_switches
DROP POLICY IF EXISTS kill_select ON public.run_kill_switches;
CREATE POLICY kill_select ON public.run_kill_switches
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));