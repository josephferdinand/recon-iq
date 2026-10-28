-- Defense-in-depth: revoke unused EXECUTE grants on internal-only SECURITY DEFINER functions.
-- These are used only by cron jobs / service-role workers and have no live callers from
-- the `authenticated` or `anon` roles. The function bodies and ownership are unchanged;
-- only the unused public-facing RPC surface is removed.

REVOKE EXECUTE ON FUNCTION public.sla_evaluate_breaches()              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_roadmap_audit_ready(uuid)   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_recon_risk(uuid)             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.predict_break_category(uuid)         FROM anon, authenticated;