\set ON_ERROR_STOP on
BEGIN;

-- Transaction-scoped synthetic actors and a single synthetic marketing record.
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('11111111-1111-4111-8111-111111111111','mkt-pii-super@invalid.test',now(),now()),
  ('22222222-2222-4222-8222-222222222222','mkt-pii-sales@invalid.test',now(),now()),
  ('33333333-3333-4333-8333-333333333333','mkt-pii-marketing@invalid.test',now(),now()),
  ('44444444-4444-4444-8444-444444444444','mkt-pii-ai@invalid.test',now(),now()),
  ('55555555-5555-4555-8555-555555555555','mkt-pii-no-role@invalid.test',now(),now());

INSERT INTO public.mkt_admin_roles(user_id,role) VALUES
  ('11111111-1111-4111-8111-111111111111','super_admin'),
  ('22222222-2222-4222-8222-222222222222','sales_admin'),
  ('33333333-3333-4333-8333-333333333333','marketing_admin'),
  ('44444444-4444-4444-8444-444444444444','ai_admin');

INSERT INTO public.mkt_leads(id,first_name,last_name,email,company,message)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Synthetic','Lead','lead@example.invalid','Synthetic Co','private inquiry text');
INSERT INTO public.mkt_lead_files(lead_id,storage_path,filename,mime,size_bytes,uploaded_by)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','private/synthetic.pdf','synthetic.pdf','application/pdf',12,'22222222-2222-4222-8222-222222222222');
INSERT INTO public.mkt_lead_notes(lead_id,author_id,kind,body)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','note','private sales note');
INSERT INTO public.mkt_lead_tasks(lead_id,assignee_id,title,description,created_by)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','Follow up','private follow-up','22222222-2222-4222-8222-222222222222');
INSERT INTO public.mkt_lead_activity(lead_id,actor_id,action,details)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','created','{"synthetic":true}');

INSERT INTO public.mkt_appointments(id,type_id,start_at,end_at,attendee_email,attendee_name,notes)
SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id, now(), now() + interval '30 minutes',
       'attendee@example.invalid','Synthetic Attendee','private appointment note'
FROM public.mkt_appointment_types
ORDER BY created_at
LIMIT 1;

INSERT INTO public.mkt_chat_sessions(id,visitor_id,lead_id,metadata)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','private-visitor-id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"synthetic":true}');
INSERT INTO public.mkt_chat_messages(session_id,role,content)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','user','private free-form chat text');
INSERT INTO public.mkt_kb_queries(session_id,query,top_k,was_answered)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','private free-form knowledge query','[]',false);
INSERT INTO public.mkt_llm_usage(model,purpose,tokens_in,tokens_out,cost_usd,session_id)
VALUES ('synthetic-model','chatbot',1,1,0.01,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
INSERT INTO public.mkt_cta_events(event_type,cta_id,source,region,session_id,lead_id,utm_campaign,user_agent,ip)
VALUES ('click','due_diligence_cta','security_page_hero','GB','private-session-id',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','private-campaign','private-user-agent','192.0.2.1');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
DO $$
BEGIN
  IF NOT public.has_mkt_pii_read_access() THEN RAISE EXCEPTION 'marketing_admin lost approved PII-read role'; END IF;
  IF (SELECT count(*) FROM public.mkt_leads) <> 1 THEN RAISE EXCEPTION 'marketing_admin lead read denied'; END IF;
  IF (SELECT count(*) FROM public.mkt_lead_notes) <> 1 THEN RAISE EXCEPTION 'marketing_admin note read denied'; END IF;
  IF (SELECT count(*) FROM public.mkt_lead_tasks) <> 1 THEN RAISE EXCEPTION 'marketing_admin task read denied'; END IF;
  IF (SELECT count(*) FROM public.mkt_lead_files) <> 1 THEN RAISE EXCEPTION 'marketing_admin file read denied'; END IF;
  IF (SELECT count(*) FROM public.mkt_lead_activity) <> 1 THEN RAISE EXCEPTION 'marketing_admin activity read denied'; END IF;
  IF (SELECT count(*) FROM public.mkt_appointments WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 THEN RAISE EXCEPTION 'marketing_admin appointment read denied'; END IF;
  IF (SELECT count(*) FROM public.mkt_chat_messages) <> 1 THEN RAISE EXCEPTION 'marketing_admin chat read denied'; END IF;
  IF (SELECT count(*) FROM public.mkt_kb_queries) <> 1 THEN RAISE EXCEPTION 'marketing_admin KB query read denied'; END IF;
  IF (SELECT count(*) FROM public.mkt_cta_events) <> 1 THEN RAISE EXCEPTION 'marketing_admin CTA read denied'; END IF;
  IF (public.mkt_lead_kpis()->>'total')::bigint <> 1 THEN RAISE EXCEPTION 'marketing_admin aggregate KPI incorrect'; END IF;

  UPDATE public.mkt_leads SET stage='won' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  IF (SELECT stage::text FROM public.mkt_leads WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'new'
    THEN RAISE EXCEPTION 'marketing_admin gained lead write authority'; END IF;
  BEGIN
    INSERT INTO public.mkt_lead_notes(lead_id,author_id,body)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),'forbidden note');
    RAISE EXCEPTION 'marketing_admin gained child write authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
DO $$
DECLARE lead_metrics jsonb; chat_metrics jsonb; cta_metrics jsonb; llm_metrics jsonb;
BEGIN
  IF public.has_mkt_pii_read_access() THEN RAISE EXCEPTION 'ai_admin has direct PII access'; END IF;
  IF (SELECT count(*) FROM public.mkt_leads) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw leads'; END IF;
  IF (SELECT count(*) FROM public.mkt_lead_notes) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw notes'; END IF;
  IF (SELECT count(*) FROM public.mkt_lead_tasks) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw tasks'; END IF;
  IF (SELECT count(*) FROM public.mkt_lead_files) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw files'; END IF;
  IF (SELECT count(*) FROM public.mkt_lead_activity) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw activity'; END IF;
  IF (SELECT count(*) FROM public.mkt_appointments) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw appointments'; END IF;
  IF (SELECT count(*) FROM public.mkt_chat_sessions) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw chat sessions'; END IF;
  IF (SELECT count(*) FROM public.mkt_chat_messages) <> 0 THEN RAISE EXCEPTION 'ai_admin read free-form chat text'; END IF;
  IF (SELECT count(*) FROM public.mkt_kb_queries) <> 0 THEN RAISE EXCEPTION 'ai_admin read free-form KB queries'; END IF;
  IF (SELECT count(*) FROM public.mkt_llm_usage) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw LLM usage rows'; END IF;
  IF (SELECT count(*) FROM public.mkt_cta_events) <> 0 THEN RAISE EXCEPTION 'ai_admin read raw CTA events'; END IF;

  lead_metrics := public.mkt_lead_kpis();
  IF lead_metrics->>'restricted' <> 'true' OR lead_metrics->>'suppressed' <> 'true'
     OR lead_metrics->'total' <> 'null'::jsonb THEN RAISE EXCEPTION 'ai lead total was not small-cell suppressed'; END IF;
  IF lead_metrics->'daily' <> '{}'::jsonb OR lead_metrics->'byStage' <> '{}'::jsonb OR lead_metrics->'last7' <> 'null'::jsonb
    THEN RAISE EXCEPTION 'ai lead KPI exposed small-cell/day data'; END IF;
  IF lead_metrics ? 'email' OR lead_metrics ? 'message' THEN RAISE EXCEPTION 'ai lead KPI exposed PII keys'; END IF;

  chat_metrics := public.mkt_chat_kpis();
  IF chat_metrics->>'restricted' <> 'true' OR chat_metrics->'totalSessions' <> 'null'::jsonb
     OR chat_metrics->'csat' <> 'null'::jsonb
     OR chat_metrics->'escalationRate' <> 'null'::jsonb OR chat_metrics->'totalMessages' <> 'null'::jsonb
    THEN RAISE EXCEPTION 'ai chat KPI exposed small cells'; END IF;
  IF chat_metrics ? 'content' OR chat_metrics ? 'visitor_id' THEN RAISE EXCEPTION 'ai chat KPI exposed PII keys'; END IF;

  llm_metrics := public.mkt_llm_usage_stats(30);
  IF llm_metrics->>'restricted' <> 'true' OR llm_metrics->'totals'->'calls' <> 'null'::jsonb
     OR llm_metrics->'byProvider' <> '[]'::jsonb OR llm_metrics->'byDay' <> '[]'::jsonb
    THEN RAISE EXCEPTION 'ai LLM usage KPI exposed small cells'; END IF;

  cta_metrics := public.mkt_cta_analytics(30);
  IF cta_metrics->>'restricted' <> 'true' OR cta_metrics->'byCta' <> '[]'::jsonb
     OR cta_metrics->'bySource' <> '[]'::jsonb OR cta_metrics->'byRegion' <> '[]'::jsonb
     OR cta_metrics->'recent' <> '[]'::jsonb OR cta_metrics->'totals'->'click' <> 'null'::jsonb
    THEN RAISE EXCEPTION 'ai CTA KPI exposed small cells'; END IF;
  IF cta_metrics ? 'ip' OR cta_metrics ? 'user_agent' OR cta_metrics ? 'lead_id' OR cta_metrics ? 'utm_campaign'
    THEN RAISE EXCEPTION 'ai CTA KPI exposed raw fields'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$
BEGIN
  IF NOT public.has_mkt_pii_read_access() THEN RAISE EXCEPTION 'sales_admin lost PII read access'; END IF;
  UPDATE public.mkt_leads SET stage='qualified' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  IF (SELECT stage::text FROM public.mkt_leads WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'qualified'
    THEN RAISE EXCEPTION 'sales_admin lead write path regressed'; END IF;
  INSERT INTO public.mkt_lead_notes(lead_id,author_id,body)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),'permitted sales note');
  IF (SELECT count(*) FROM public.mkt_lead_notes WHERE body='permitted sales note') <> 1
    THEN RAISE EXCEPTION 'sales_admin child write path regressed'; END IF;
END $$;

RESET ROLE;
DO $$
BEGIN
  IF NOT has_table_privilege('service_role','public.mkt_leads','INSERT') THEN RAISE EXCEPTION 'public service_role lead intake privilege changed'; END IF;
  IF NOT has_table_privilege('service_role','public.mkt_lead_activity','INSERT') THEN RAISE EXCEPTION 'public service_role lead activity insert changed'; END IF;
  IF NOT has_table_privilege('service_role','public.mkt_chat_messages','INSERT') THEN RAISE EXCEPTION 'public service_role chat insert changed'; END IF;
  IF NOT has_table_privilege('service_role','public.mkt_appointments','INSERT') THEN RAISE EXCEPTION 'public service_role appointment insert changed'; END IF;
  IF NOT has_table_privilege('service_role','public.mkt_cta_events','INSERT') THEN RAISE EXCEPTION 'public service_role CTA insert changed'; END IF;
END $$;

SELECT 'marketing_pii_boundary_SOURCE_REGRESSION_PASS role_allowlist=super_admin,sales_admin,marketing_admin ai=aggregate_only pii_tables=lead,appointment,chat,kb_query,llm_usage,cta public_service_role=preserved';
ROLLBACK;
