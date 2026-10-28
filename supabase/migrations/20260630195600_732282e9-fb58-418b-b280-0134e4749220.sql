-- Phase 6 P1 QA hardening: drop dead DELETE grants + redundant policy

REVOKE DELETE ON public.master_securities FROM authenticated;
REVOKE DELETE ON public.master_counterparties FROM authenticated;
REVOKE DELETE ON public.master_accounts FROM authenticated;
REVOKE DELETE ON public.recon_rule_simulations FROM authenticated;

-- Redundant SELECT policy superseded by rrs_write FOR ALL
DROP POLICY IF EXISTS rrs_select ON public.recon_rule_simulations;
