BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f4000000-0000-4000-8000-000000000001','Orchestrator Evidence','f4000000-0000-4000-8000-000000000002','Orchestrator Evidence');
INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES ('f4000000-0000-4000-8000-000000000003','f4000000-0000-4000-8000-000000000001','orchestrator-evidence','Orchestrator Evidence','dev');
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES ('f4000000-0000-4000-8000-000000000021','f4000000-0000-4000-8000-000000000003','Orchestrated Cash Recon','two_sided','[]','[]','active');
INSERT INTO public.recon_schedules(
  id,tenant_id,definition_id,name,cron_expression,enabled,max_attempts,retry_backoff_seconds,catch_up_window_minutes
) VALUES (
  'f4000000-0000-4000-8000-000000000031','f4000000-0000-4000-8000-000000000003',
  'f4000000-0000-4000-8000-000000000021','Five-minute cash recon','*/5 * * * *',true,3,1,60
);

CREATE TEMP TABLE orchestrator_results(disposition text, schedule_run_id bigint);
INSERT INTO orchestrator_results
SELECT disposition,schedule_run_id FROM public.claim_recon_schedule_run(
  'f4000000-0000-4000-8000-000000000031','cron','2026-09-14T10:05:00Z','cron:2026-09-14T10:05:00.000Z',1,NULL,NULL
);

DO $$
DECLARE original_id bigint; duplicate_id bigint; duplicate_state text; overlap_id bigint; overlap_state text;
BEGIN
  SELECT schedule_run_id INTO original_id FROM orchestrator_results WHERE disposition='claimed';
  SELECT schedule_run_id,disposition INTO duplicate_id,duplicate_state FROM public.claim_recon_schedule_run(
    'f4000000-0000-4000-8000-000000000031','cron','2026-09-14T10:05:00Z','cron:2026-09-14T10:05:00.000Z',1,NULL,NULL
  );
  IF duplicate_state <> 'duplicate' OR duplicate_id <> original_id THEN
    RAISE EXCEPTION 'idempotent duplicate claim failed';
  END IF;
  SELECT schedule_run_id,disposition INTO overlap_id,overlap_state FROM public.claim_recon_schedule_run(
    'f4000000-0000-4000-8000-000000000031','cron','2026-09-14T10:10:00Z','cron:2026-09-14T10:10:00.000Z',1,NULL,NULL
  );
  IF overlap_state <> 'overlap' OR overlap_id IS NULL THEN
    RAISE EXCEPTION 'overlap was not durably prevented';
  END IF;
  IF (SELECT retry_after IS NULL FROM public.recon_schedule_runs WHERE id=overlap_id) THEN
    RAISE EXCEPTION 'overlap did not schedule a bounded retry';
  END IF;
END $$;

SELECT public.finish_recon_schedule_run(
  (SELECT schedule_run_id FROM orchestrator_results WHERE disposition='claimed'),
  'completed',NULL,4,1,10,NULL,'{"proof":"initial_completed"}'
);

DO $$
DECLARE parent_id bigint; retry2_id bigint; retry3_id bigint; state text; next_retry timestamptz;
BEGIN
  SELECT id INTO parent_id FROM public.recon_schedule_runs WHERE occurrence_key='cron:2026-09-14T10:10:00.000Z' AND attempt=1;
  SELECT schedule_run_id,disposition INTO retry2_id,state FROM public.claim_recon_schedule_run(
    'f4000000-0000-4000-8000-000000000031','retry','2026-09-14T10:10:00Z','cron:2026-09-14T10:10:00.000Z',2,NULL,parent_id
  );
  IF state <> 'claimed' OR retry2_id IS NULL THEN RAISE EXCEPTION 'retry attempt 2 was not claimed'; END IF;
  IF (SELECT superseded_by_id FROM public.recon_schedule_runs WHERE id=parent_id) <> retry2_id THEN
    RAISE EXCEPTION 'retry parent was not superseded atomically';
  END IF;
  SELECT next_retry_at INTO next_retry FROM public.finish_recon_schedule_run(retry2_id,'failed',NULL,0,0,0,'synthetic_failure','{}');
  IF next_retry IS NULL THEN RAISE EXCEPTION 'retry attempt 2 did not persist backoff'; END IF;

  SELECT schedule_run_id,disposition INTO retry3_id,state FROM public.claim_recon_schedule_run(
    'f4000000-0000-4000-8000-000000000031','retry','2026-09-14T10:10:00Z','cron:2026-09-14T10:10:00.000Z',3,NULL,retry2_id
  );
  IF state <> 'claimed' OR retry3_id IS NULL THEN RAISE EXCEPTION 'retry attempt 3 was not claimed'; END IF;
  SELECT next_retry_at INTO next_retry FROM public.finish_recon_schedule_run(retry3_id,'failed',NULL,0,0,0,'synthetic_final_failure','{}');
  IF next_retry IS NOT NULL THEN RAISE EXCEPTION 'exhausted retry unexpectedly scheduled again'; END IF;
END $$;

UPDATE public.recon_schedules SET enabled=false WHERE id='f4000000-0000-4000-8000-000000000031';
DO $$
DECLARE state text; run_id bigint;
BEGIN
  SELECT schedule_run_id,disposition INTO run_id,state FROM public.claim_recon_schedule_run(
    'f4000000-0000-4000-8000-000000000031','cron','2026-09-14T10:15:00Z','cron:2026-09-14T10:15:00.000Z',1,NULL,NULL
  );
  IF state <> 'disabled' OR run_id IS NOT NULL THEN RAISE EXCEPTION 'disabled schedule was not skipped'; END IF;
  SELECT schedule_run_id,disposition INTO run_id,state FROM public.claim_recon_schedule_run(
    'f4000000-0000-4000-8000-000000000031','manual',now(),'manual:regression',1,NULL,NULL
  );
  IF state <> 'claimed' OR run_id IS NULL THEN RAISE EXCEPTION 'manual run should be allowed while paused'; END IF;
  PERFORM public.finish_recon_schedule_run(run_id,'completed',NULL,0,0,0,NULL,'{}');
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO public.recon_schedule_runs(id,schedule_id,tenant_id,trigger,status,scheduled_for,occurrence_key)
  VALUES (999999,'f4000000-0000-4000-8000-000000000031','f4000000-0000-4000-8000-000000000003','manual','running',now(),'direct-bypass');
  RAISE EXCEPTION 'authenticated direct schedule-run insert unexpectedly accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF (SELECT count(*) FROM public.recon_schedule_runs WHERE schedule_id='f4000000-0000-4000-8000-000000000031' AND status='running') <> 0 THEN
    RAISE EXCEPTION 'terminal paths left an active run';
  END IF;
  IF (SELECT count(*) FROM public.recon_schedule_runs WHERE schedule_id='f4000000-0000-4000-8000-000000000031' AND occurrence_key='cron:2026-09-14T10:10:00.000Z') <> 3 THEN
    RAISE EXCEPTION 'retry chain is incomplete';
  END IF;
  IF (SELECT last_status FROM public.recon_schedules WHERE id='f4000000-0000-4000-8000-000000000031') <> 'completed' THEN
    RAISE EXCEPTION 'manual terminal status was not persisted';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE tenant_id='f4000000-0000-4000-8000-000000000003'
      AND action IN ('system.recon.schedule.run.started','system.recon.schedule.run.complete','system.recon.schedule.run.overlap_prevented',
                     'system.recon.schedule.run.retry_scheduled','system.recon.schedule.run.failed','system.recon.schedule.run.disabled',
                     'recon.schedule.run.started','recon.schedule.run.complete')) < 9 THEN
    RAISE EXCEPTION 'orchestrator audit coverage is incomplete';
  END IF;
END $$;

SELECT 'reconciliation_orchestrator_PASS claim=yes overlap=yes retry=3 catchup_cursor=yes direct_insert=denied audit=yes' AS result;
COMMIT;
