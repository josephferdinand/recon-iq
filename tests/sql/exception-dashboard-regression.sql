BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES
  ('d4000000-0000-4000-8000-000000000001','Exception Dashboard A','d4000000-0000-4000-8000-000000000002','Exception Dashboard A'),
  ('d4000000-0000-4000-8000-000000000003','Exception Dashboard B','d4000000-0000-4000-8000-000000000004','Exception Dashboard B');

INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES
  ('d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000001','exception-dashboard-a','Exception Dashboard A','dev'),
  ('d4000000-0000-4000-8000-000000000012','d4000000-0000-4000-8000-000000000003','exception-dashboard-b','Exception Dashboard B','dev');

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES
  ('d4000000-0000-4000-8000-000000000021','reader@example.invalid',now(),now()),
  ('d4000000-0000-4000-8000-000000000022','no-permission@example.invalid',now(),now()),
  ('d4000000-0000-4000-8000-000000000023','inactive@example.invalid',now(),now()),
  ('d4000000-0000-4000-8000-000000000024','other-tenant@example.invalid',now(),now());

INSERT INTO public.tenant_members(tenant_id,user_id,role,active)
VALUES
  ('d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000021','tenant_viewer',true),
  ('d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000022','tenant_viewer',true),
  ('d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000023','tenant_viewer',false),
  ('d4000000-0000-4000-8000-000000000012','d4000000-0000-4000-8000-000000000024','tenant_viewer',true);

-- recon_viewer is the existing system role that contains break.read.
INSERT INTO public.rbac_user_grants(tenant_id,user_id,role_id,scope_type,reason)
VALUES
  ('d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000021','11111111-0000-0000-0000-000000000007','tenant','dashboard regression'),
  ('d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000023','11111111-0000-0000-0000-000000000007','tenant','inactive denial regression'),
  ('d4000000-0000-4000-8000-000000000012','d4000000-0000-4000-8000-000000000024','11111111-0000-0000-0000-000000000007','tenant','tenant B regression');

INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES
  ('d4000000-0000-4000-8000-000000000031','d4000000-0000-4000-8000-000000000011','Cash Exceptions','two_sided','[]','[]','active'),
  ('d4000000-0000-4000-8000-000000000032','d4000000-0000-4000-8000-000000000011','Securities Exceptions','two_sided','[]','[]','active'),
  ('d4000000-0000-4000-8000-000000000033','d4000000-0000-4000-8000-000000000012','Tenant B Confidential Recon','two_sided','[]','[]','active');

INSERT INTO public.recon_runs(id,tenant_id,definition_id,status,total_rows)
VALUES
  ('a4100000-0000-4000-8000-000000000041','d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000031','completed',10),
  ('a4200000-0000-4000-8000-000000000042','d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000032','completed',10),
  ('b4300000-0000-4000-8000-000000000043','d4000000-0000-4000-8000-000000000012','d4000000-0000-4000-8000-000000000033','completed',10);

INSERT INTO public.recon_exceptions(
  id,run_id,tenant_id,reason,severity,status,lifecycle_state,priority,assignee,created_at
)
VALUES
  ('d4000000-0000-4000-8000-000000000101','a4100000-0000-4000-8000-000000000041','d4000000-0000-4000-8000-000000000011','New low','low','open','new','P3','d4000000-0000-4000-8000-000000000021',now()-interval '1 day'),
  ('d4000000-0000-4000-8000-000000000102','a4100000-0000-4000-8000-000000000041','d4000000-0000-4000-8000-000000000011','Assigned medium','medium','investigating','assigned','P2',NULL,now()-interval '4 days'),
  ('d4000000-0000-4000-8000-000000000103','a4200000-0000-4000-8000-000000000042','d4000000-0000-4000-8000-000000000011','Investigating high','high','investigating','investigating','P1','d4000000-0000-4000-8000-000000000021',now()-interval '10 days'),
  ('d4000000-0000-4000-8000-000000000104','a4200000-0000-4000-8000-000000000042','d4000000-0000-4000-8000-000000000011','Pending critical','critical','investigating','pending_counterparty','P1',NULL,now()-interval '35 days'),
  ('d4000000-0000-4000-8000-000000000105','a4100000-0000-4000-8000-000000000041','d4000000-0000-4000-8000-000000000011','Resolved high','high','resolved','resolved','P1',NULL,now()-interval '5 days'),
  ('d4000000-0000-4000-8000-000000000106','a4100000-0000-4000-8000-000000000041','d4000000-0000-4000-8000-000000000011','Written off low','low','wont_fix','written_off','P4',NULL,now()-interval '120 days'),
  ('d4000000-0000-4000-8000-000000000107','a4100000-0000-4000-8000-000000000041','d4000000-0000-4000-8000-000000000011','Legacy resolved','medium','resolved','new','P3',NULL,now()-interval '20 days'),
  ('d4000000-0000-4000-8000-000000000108','a4200000-0000-4000-8000-000000000042','d4000000-0000-4000-8000-000000000011','Old open medium','medium','open','new','P3',NULL,now()-interval '120 days'),
  ('d4000000-0000-4000-8000-000000000109','b4300000-0000-4000-8000-000000000043','d4000000-0000-4000-8000-000000000012','Other tenant critical','critical','open','new','P1',NULL,now()-interval '2 days');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d4000000-0000-4000-8000-000000000021',true);

DO $$
DECLARE
  dashboard jsonb := public.get_exception_dashboard('d4000000-0000-4000-8000-000000000011', 7);
  created_in_trend integer;
  open_in_trend integer;
  top_recon jsonb;
BEGIN
  IF (dashboard->>'window_days')::integer <> 7 OR jsonb_array_length(dashboard->'trend') <> 7 THEN
    RAISE EXCEPTION 'trend window is not exactly seven UTC cohorts: %', dashboard->'trend';
  END IF;
  IF (dashboard#>>'{totals,total}')::integer <> 8
     OR (dashboard#>>'{totals,open}')::integer <> 5
     OR (dashboard#>>'{totals,resolved}')::integer <> 3
     OR (dashboard#>>'{totals,high_priority}')::integer <> 3
     OR (dashboard#>>'{totals,unassigned}')::integer <> 3
     OR (dashboard#>>'{totals,older_than_30_days}')::integer <> 2
     OR (dashboard#>>'{totals,oldest_open_days}')::integer <> 120 THEN
    RAISE EXCEPTION 'totals are incorrect: %', dashboard->'totals';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(dashboard->'ageing') bucket WHERE (bucket->>'count')::integer <> 1) <> 0 THEN
    RAISE EXCEPTION 'ageing buckets are incorrect: %', dashboard->'ageing';
  END IF;
  IF (SELECT (bucket->>'count')::integer FROM jsonb_array_elements(dashboard->'by_severity') bucket WHERE bucket->>'name'='medium') <> 3 THEN
    RAISE EXCEPTION 'severity distribution is incorrect: %', dashboard->'by_severity';
  END IF;
  IF (SELECT (bucket->>'count')::integer FROM jsonb_array_elements(dashboard->'by_status') bucket WHERE bucket->>'name'='resolved') <> 2 THEN
    RAISE EXCEPTION 'canonical resolved status is incorrect: %', dashboard->'by_status';
  END IF;
  SELECT sum((cohort->>'created')::integer), sum((cohort->>'still_open')::integer)
  INTO created_in_trend, open_in_trend
  FROM jsonb_array_elements(dashboard->'trend') cohort;
  IF created_in_trend <> 3 OR open_in_trend <> 2 THEN
    RAISE EXCEPTION 'creation cohort semantics are incorrect: %', dashboard->'trend';
  END IF;
  top_recon := dashboard->'by_reconciliation'->0;
  IF top_recon->>'id' <> 'd4000000-0000-4000-8000-000000000032'
     OR (top_recon->>'open')::integer <> 3
     OR (top_recon->>'high_priority')::integer <> 2
     OR (top_recon->>'oldest_open_days')::integer <> 120 THEN
    RAISE EXCEPTION 'top reconciliation is incorrect: %', top_recon;
  END IF;
  IF dashboard::text LIKE '%Tenant B Confidential Recon%' THEN
    RAISE EXCEPTION 'cross-tenant reconciliation label leaked';
  END IF;
  IF (public.get_exception_dashboard('d4000000-0000-4000-8000-000000000011')->>'window_days')::integer <> 30 THEN
    RAISE EXCEPTION 'default window is not 30 days';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub','d4000000-0000-4000-8000-000000000022',true);
DO $$ BEGIN
  PERFORM public.get_exception_dashboard('d4000000-0000-4000-8000-000000000011', 30);
  RAISE EXCEPTION 'member without break.read unexpectedly received the dashboard';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

SELECT set_config('request.jwt.claim.sub','d4000000-0000-4000-8000-000000000023',true);
DO $$ BEGIN
  PERFORM public.get_exception_dashboard('d4000000-0000-4000-8000-000000000011', 30);
  RAISE EXCEPTION 'inactive member unexpectedly received the dashboard';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

SELECT set_config('request.jwt.claim.sub','d4000000-0000-4000-8000-000000000021',true);
DO $$ BEGIN
  PERFORM public.get_exception_dashboard('d4000000-0000-4000-8000-000000000012', 30);
  RAISE EXCEPTION 'cross-tenant dashboard request unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM public.get_exception_dashboard('d4000000-0000-4000-8000-000000000011', 14);
  RAISE EXCEPTION 'invalid dashboard window unexpectedly succeeded';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.rate_limit_buckets
    WHERE bucket_key LIKE 'exception.dashboard.db:%'
      AND (
        bucket_key LIKE '%d4000000-0000-4000-8000-000000000022'
        OR bucket_key LIKE '%d4000000-0000-4000-8000-000000000023'
      )
  ) THEN
    RAISE EXCEPTION 'denied callers consumed dashboard rate-limit capacity';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d4000000-0000-4000-8000-000000000024',true);

DO $$
DECLARE
  attempt integer;
  rate_message text;
  rate_detail text;
BEGIN
  FOR attempt IN 1..60 LOOP
    PERFORM public.get_exception_dashboard('d4000000-0000-4000-8000-000000000012', 7);
  END LOOP;

  BEGIN
    PERFORM public.get_exception_dashboard('d4000000-0000-4000-8000-000000000012', 7);
    RAISE EXCEPTION '61st direct RPC unexpectedly bypassed the database rate limit';
  EXCEPTION WHEN SQLSTATE 'PGRST' THEN
    GET STACKED DIAGNOSTICS rate_message = MESSAGE_TEXT, rate_detail = PG_EXCEPTION_DETAIL;
    IF rate_message::jsonb->>'code' <> 'exception_dashboard_rate_limited'
       OR rate_detail::jsonb->>'status' <> '429'
       OR rate_detail::jsonb->'headers'->>'Retry-After' IS NULL THEN
      RAISE EXCEPTION 'direct RPC rate error is malformed: message=% detail=%', rate_message, rate_detail;
    END IF;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT count
    FROM public.rate_limit_buckets
    WHERE bucket_key =
      'exception.dashboard.db:d4000000-0000-4000-8000-000000000012:d4000000-0000-4000-8000-000000000024'
    ORDER BY window_start DESC
    LIMIT 1
  ) <> 60 THEN
    -- The rejected 61st statement rolls back its increment. The stored count
    -- therefore remains at 60 and every subsequent call again reaches 61 and
    -- is rejected inside its own statement.
    RAISE EXCEPTION 'direct RPC rate bucket did not retain exactly 60 accepted attempts';
  END IF;
END;
$$;

SELECT 'exception_dashboard_PASS totals=8 open=5 resolved=3 trend=7 tenant_isolation=yes permissions=yes direct_rpc_rate_60_per_min=yes' AS result;

ROLLBACK;
