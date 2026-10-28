
-- ============================================================
-- Fix 1: certification_quizzes — hide correct_index from authenticated users
-- ============================================================
-- Ensure table grants: authenticated may read non-answer columns only.
REVOKE ALL ON public.certification_quizzes FROM authenticated, anon, PUBLIC;
GRANT SELECT (id, track_id, ordering, question, options, explanation, created_at)
  ON public.certification_quizzes TO authenticated;
GRANT ALL ON public.certification_quizzes TO service_role;

-- Policy stays (USING true) so authenticated can read allowed columns; column
-- grants above make correct_index unreadable to authenticated. service_role
-- bypasses RLS and column grants for server-side grading.

-- ============================================================
-- Fix 2: dq_rules, digital_twin_*, outreach_messages, upstream_drift_alerts
-- Split ALL policy into member-read + admin/analyst-write
-- ============================================================

-- dq_rules
DROP POLICY IF EXISTS dq_rules_rw ON public.dq_rules;
CREATE POLICY dq_rules_select ON public.dq_rules FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY dq_rules_write ON public.dq_rules FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- digital_twin_nodes
DROP POLICY IF EXISTS dtn_rw ON public.digital_twin_nodes;
CREATE POLICY dtn_select ON public.digital_twin_nodes FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY dtn_write ON public.digital_twin_nodes FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- digital_twin_edges
DROP POLICY IF EXISTS dte_rw ON public.digital_twin_edges;
CREATE POLICY dte_select ON public.digital_twin_edges FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY dte_write ON public.digital_twin_edges FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- outreach_messages
DROP POLICY IF EXISTS outreach_rw ON public.outreach_messages;
CREATE POLICY outreach_select ON public.outreach_messages FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY outreach_write ON public.outreach_messages FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- upstream_drift_alerts
DROP POLICY IF EXISTS drift_alerts_rw ON public.upstream_drift_alerts;
CREATE POLICY drift_alerts_select ON public.upstream_drift_alerts FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY drift_alerts_write ON public.upstream_drift_alerts FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- ============================================================
-- Fix 3: financial master data — restrict writes to admin/analyst
-- ============================================================

-- master_accounts (already has ma_select for members)
DROP POLICY IF EXISTS ma_write ON public.master_accounts;
CREATE POLICY ma_write ON public.master_accounts FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- master_counterparties (already has mc_select)
DROP POLICY IF EXISTS mc_write ON public.master_counterparties;
CREATE POLICY mc_write ON public.master_counterparties FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- master_securities (already has ms_select)
DROP POLICY IF EXISTS ms_write ON public.master_securities;
CREATE POLICY ms_write ON public.master_securities FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- loan_facilities (ALL policy only — split)
DROP POLICY IF EXISTS lf_rw ON public.loan_facilities;
CREATE POLICY lf_select ON public.loan_facilities FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY lf_write ON public.loan_facilities FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- corporate_actions (has ca_tenant_read + ca_tenant_write)
DROP POLICY IF EXISTS ca_tenant_write ON public.corporate_actions;
CREATE POLICY ca_tenant_write ON public.corporate_actions FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- collateral_pledges (ALL only — split)
DROP POLICY IF EXISTS cp_rw ON public.collateral_pledges;
CREATE POLICY cp_select ON public.collateral_pledges FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY cp_write ON public.collateral_pledges FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- sec_lending_loans (ALL only — split)
DROP POLICY IF EXISTS sll_rw ON public.sec_lending_loans;
CREATE POLICY sll_select ON public.sec_lending_loans FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY sll_write ON public.sec_lending_loans FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- fund_nav_runs (ALL only — split)
DROP POLICY IF EXISTS nav_tenant_rw ON public.fund_nav_runs;
CREATE POLICY nav_tenant_select ON public.fund_nav_runs FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY nav_tenant_write ON public.fund_nav_runs FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

-- fund_nav_components (ALL only — split)
DROP POLICY IF EXISTS navc_tenant_rw ON public.fund_nav_components;
CREATE POLICY navc_tenant_select ON public.fund_nav_components FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY navc_tenant_write ON public.fund_nav_components FOR ALL
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );
