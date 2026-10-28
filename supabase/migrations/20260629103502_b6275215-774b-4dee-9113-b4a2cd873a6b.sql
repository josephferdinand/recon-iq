
UPDATE public.roadmap_items
SET status = 'shipped', readiness = 100, audit_ready = true, wave = 'shipped', updated_at = now()
WHERE title IN (
  'DORA/EMIR exporter hardening',
  'Marketplace listings UI',
  'Chat-Ops deep integrations',
  'Next Wave roadmap dashboard',
  'FIX 4.4 ingestion parser',
  'Live Slack two-way thread sync',
  'SOC 2 Type II evidence pipeline'
);
