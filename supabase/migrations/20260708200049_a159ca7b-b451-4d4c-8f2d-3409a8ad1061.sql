INSERT INTO public.platform_slo_catalog (service, signal, objective_pct, window_days, latency_ms_target, error_budget_pct, description)
VALUES
  ('signoff.eod_open',    'latency_p95', 95.00, 7,  900, 5.00, 'p95 latency for Controller opening EOD signoff period'),
  ('audit.verify_chain',  'latency_p95', 95.00, 7, 2000, 5.00, 'p95 latency for Auditor running dual-region chain verify'),
  ('attestations.open',   'latency_p95', 95.00, 7, 1000, 5.00, 'p95 latency for CISO opening Attestations panel')
ON CONFLICT (service, signal) DO NOTHING;

INSERT INTO public.platform_chaos_calendar (drill_code, title, scheduled_for, duration_minutes, cadence, blast_radius, tenant_impact, runbook_url, status)
VALUES
  ('worker.restart.weekly', 'Weekly worker restart drill',
   date_trunc('week', now()) + interval '7 days' + interval '3 hours',
   15, 'weekly', 'single-component', 'none',
   '/docs/runbooks/chaos-worker-restart.md', 'scheduled')
ON CONFLICT (drill_code, scheduled_for) DO NOTHING;