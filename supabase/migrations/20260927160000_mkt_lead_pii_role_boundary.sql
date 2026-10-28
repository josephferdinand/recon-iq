-- Marketing records containing PII are visible only to super_admin,
-- sales_admin and the owner-approved marketing_admin queue operator. AI admins
-- receive aggregate metrics only, never lead, appointment, chat or CTA rows.
BEGIN;

CREATE OR REPLACE FUNCTION public.has_mkt_pii_read_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'marketing_admin'::public.mkt_admin_role)
  );
$$;

REVOKE ALL ON FUNCTION public.has_mkt_pii_read_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_mkt_pii_read_access() TO authenticated;

-- Remove the existing permissive read policy. The existing write policy stays
-- unchanged: only super_admin and sales_admin may mutate lead records.
DROP POLICY IF EXISTS mkt_leads_admin_read ON public.mkt_leads;
CREATE POLICY mkt_leads_pii_read ON public.mkt_leads
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());

-- Child records can contain free-form notes, attachment paths and activity
-- metadata, so their read boundary matches the parent lead PII boundary.
DROP POLICY IF EXISTS mkt_lead_files_admin ON public.mkt_lead_files;
CREATE POLICY mkt_lead_files_pii_read ON public.mkt_lead_files
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());
CREATE POLICY mkt_lead_files_sales_write ON public.mkt_lead_files
  FOR ALL TO authenticated
  USING (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  )
  WITH CHECK (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  );

DROP POLICY IF EXISTS mkt_lead_notes_admin ON public.mkt_lead_notes;
CREATE POLICY mkt_lead_notes_pii_read ON public.mkt_lead_notes
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());
CREATE POLICY mkt_lead_notes_sales_write ON public.mkt_lead_notes
  FOR ALL TO authenticated
  USING (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  )
  WITH CHECK (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  );

DROP POLICY IF EXISTS mkt_lead_tasks_admin ON public.mkt_lead_tasks;
CREATE POLICY mkt_lead_tasks_pii_read ON public.mkt_lead_tasks
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());
CREATE POLICY mkt_lead_tasks_sales_write ON public.mkt_lead_tasks
  FOR ALL TO authenticated
  USING (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  )
  WITH CHECK (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  );

DROP POLICY IF EXISTS mkt_lead_activity_read ON public.mkt_lead_activity;
DROP POLICY IF EXISTS mkt_lead_activity_insert ON public.mkt_lead_activity;
CREATE POLICY mkt_lead_activity_pii_read ON public.mkt_lead_activity
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());
CREATE POLICY mkt_lead_activity_sales_insert ON public.mkt_lead_activity
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  );

-- Booking rows contain attendee names, email addresses and notes. Preserve
-- human queue access while keeping mutations within existing sales roles.
DROP POLICY IF EXISTS mkt_appointments_admin ON public.mkt_appointments;
CREATE POLICY mkt_appointments_pii_read ON public.mkt_appointments
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());
CREATE POLICY mkt_appointments_sales_write ON public.mkt_appointments
  FOR ALL TO authenticated
  USING (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  )
  WITH CHECK (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  );

-- Chat session metadata, free-text messages, knowledge queries and per-call
-- usage rows are restricted to the same human PII roles. Public chat writes
-- continue through the existing service_role API handlers.
DROP POLICY IF EXISTS mkt_chat_sessions_admin ON public.mkt_chat_sessions;
CREATE POLICY mkt_chat_sessions_pii_read ON public.mkt_chat_sessions
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());

DROP POLICY IF EXISTS mkt_chat_messages_admin_read ON public.mkt_chat_messages;
CREATE POLICY mkt_chat_messages_pii_read ON public.mkt_chat_messages
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());

DROP POLICY IF EXISTS mkt_kb_queries_admin_read ON public.mkt_kb_queries;
CREATE POLICY mkt_kb_queries_pii_read ON public.mkt_kb_queries
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());

DROP POLICY IF EXISTS mkt_llm_usage_admin_read ON public.mkt_llm_usage;
CREATE POLICY mkt_llm_usage_pii_read ON public.mkt_llm_usage
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());

-- CTA rows include raw IP, user-agent, session, lead and campaign fields. The
-- authenticated page uses aggregate RPCs; direct row reads remain human-only.
DROP POLICY IF EXISTS mkt_cta_events_admin_read ON public.mkt_cta_events;
DROP POLICY IF EXISTS mkt_cta_events_admin_write ON public.mkt_cta_events;
CREATE POLICY mkt_cta_events_pii_read ON public.mkt_cta_events
  FOR SELECT TO authenticated
  USING (public.has_mkt_pii_read_access());
CREATE POLICY mkt_cta_events_sales_write ON public.mkt_cta_events
  FOR ALL TO authenticated
  USING (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  )
  WITH CHECK (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
  );

-- An AI admin can view dashboard counts without selecting lead rows. This
-- fixed, no-argument SECURITY DEFINER function returns counts only.
CREATE OR REPLACE FUNCTION public.mkt_lead_kpis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
  pii_reader boolean := public.has_mkt_pii_read_access();
  last_7_count bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'marketing_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'ai_admin'::public.mkt_admin_role)
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO last_7_count
  FROM public.mkt_leads
  WHERE created_at >= now() - interval '7 days';

  SELECT jsonb_build_object(
    'total', CASE WHEN pii_reader OR (SELECT count(*) FROM public.mkt_leads) >= 5
      THEN (SELECT count(*) FROM public.mkt_leads) ELSE NULL END,
    'restricted', NOT pii_reader,
    'suppressed', NOT pii_reader,
    'byStage', (
      SELECT COALESCE(jsonb_object_agg(stage::text, total), '{}'::jsonb)
      FROM (
        SELECT stage, count(*) AS total
        FROM public.mkt_leads
        GROUP BY stage
      ) AS counts_by_stage
      WHERE pii_reader OR total >= 5
    ),
    'byTemp', jsonb_build_object(
      'hot', CASE WHEN pii_reader OR (SELECT count(*) FROM public.mkt_leads WHERE temperature = 'hot') >= 5
        THEN (SELECT count(*) FROM public.mkt_leads WHERE temperature = 'hot') ELSE NULL END,
      'warm', CASE WHEN pii_reader OR (SELECT count(*) FROM public.mkt_leads WHERE temperature = 'warm') >= 5
        THEN (SELECT count(*) FROM public.mkt_leads WHERE temperature = 'warm') ELSE NULL END,
      'cold', CASE WHEN pii_reader OR (SELECT count(*) FROM public.mkt_leads WHERE temperature = 'cold') >= 5
        THEN (SELECT count(*) FROM public.mkt_leads WHERE temperature = 'cold') ELSE NULL END
    ),
    'daily', (
      SELECT CASE WHEN pii_reader THEN COALESCE(jsonb_object_agg(day, total), '{}'::jsonb) ELSE '{}'::jsonb END
      FROM (
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               count(*) AS total
        FROM public.mkt_leads
        GROUP BY 1
      ) AS counts_by_day
    ),
    'last7', CASE WHEN pii_reader OR last_7_count >= 5 THEN last_7_count ELSE NULL END
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.mkt_lead_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_lead_kpis() TO authenticated;

-- AI admins may retain aggregate chat and usage metrics, but never per-session,
-- per-message, prompt, query, IP, or user-agent rows. Small cells and daily
-- slices are suppressed for aggregate-only roles.
CREATE OR REPLACE FUNCTION public.mkt_chat_kpis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pii_reader boolean := public.has_mkt_pii_read_access();
  sessions_count bigint;
  escalated_count bigint;
  rated_count bigint;
  average_csat numeric;
  messages_count bigint;
  usage_count bigint;
  total_cost numeric;
  total_tokens bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'marketing_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'ai_admin'::public.mkt_admin_role)
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE escalated_to IS NOT NULL),
         count(*) FILTER (WHERE satisfaction IS NOT NULL), avg(satisfaction)
  INTO sessions_count, escalated_count, rated_count, average_csat
  FROM public.mkt_chat_sessions;

  SELECT count(*) INTO messages_count FROM public.mkt_chat_messages;
  SELECT count(*), coalesce(sum(cost_usd), 0), coalesce(sum(tokens_in + tokens_out), 0)
  INTO usage_count, total_cost, total_tokens
  FROM public.mkt_llm_usage;

  RETURN jsonb_build_object(
    'restricted', NOT pii_reader,
    'totalSessions', CASE WHEN pii_reader OR sessions_count >= 5 THEN sessions_count ELSE NULL END,
    'escalated', CASE WHEN pii_reader OR escalated_count >= 5 THEN escalated_count ELSE NULL END,
    'escalationRate', CASE
      WHEN pii_reader THEN CASE WHEN sessions_count = 0 THEN 0 ELSE escalated_count::numeric / sessions_count END
      WHEN sessions_count >= 10 AND escalated_count >= 5 AND sessions_count - escalated_count >= 5
        THEN escalated_count::numeric / sessions_count
      ELSE NULL
    END,
    'csat', CASE WHEN pii_reader OR rated_count >= 5 THEN average_csat ELSE NULL END,
    'totalCost', CASE WHEN pii_reader OR usage_count >= 5 THEN total_cost ELSE NULL END,
    'totalTokens', CASE WHEN pii_reader OR usage_count >= 5 THEN total_tokens ELSE NULL END,
    'totalMessages', CASE WHEN pii_reader OR messages_count >= 5 THEN messages_count ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mkt_chat_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_chat_kpis() TO authenticated;

-- CTA analytics returns only allowlisted category labels and time-bucketed
-- counts. Untrusted campaign/source strings, lead/session ids, IPs, user agents,
-- paths, referrers and exact event rows never leave this aggregate boundary.
CREATE OR REPLACE FUNCTION public.mkt_cta_analytics(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pii_reader boolean := public.has_mkt_pii_read_access();
  since_at timestamptz;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'marketing_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'ai_admin'::public.mkt_admin_role)
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF _days IS NULL OR _days NOT IN (1, 7, 30, 90) THEN
    RAISE EXCEPTION 'unsupported range' USING ERRCODE = '22023';
  END IF;
  since_at := now() - make_interval(days => _days);

  WITH totals_by_type AS (
    SELECT event_type, count(*) AS total
    FROM public.mkt_cta_events
    WHERE created_at >= since_at
    GROUP BY event_type
  )
  SELECT jsonb_build_object(
    'restricted', NOT pii_reader,
    'totals', jsonb_build_object(
      'view', CASE WHEN pii_reader OR coalesce((SELECT total FROM totals_by_type WHERE event_type = 'view'), 0) >= 5
        THEN coalesce((SELECT total FROM totals_by_type WHERE event_type = 'view'), 0) ELSE NULL END,
      'click', CASE WHEN pii_reader OR coalesce((SELECT total FROM totals_by_type WHERE event_type = 'click'), 0) >= 5
        THEN coalesce((SELECT total FROM totals_by_type WHERE event_type = 'click'), 0) ELSE NULL END,
      'form_submit', CASE WHEN pii_reader OR coalesce((SELECT total FROM totals_by_type WHERE event_type = 'form_submit'), 0) >= 5
        THEN coalesce((SELECT total FROM totals_by_type WHERE event_type = 'form_submit'), 0) ELSE NULL END,
      'pack_download', CASE WHEN pii_reader OR coalesce((SELECT total FROM totals_by_type WHERE event_type = 'pack_download'), 0) >= 5
        THEN coalesce((SELECT total FROM totals_by_type WHERE event_type = 'pack_download'), 0) ELSE NULL END
    ),
    'byCta', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'cta_id', cta_id,
        'view', CASE WHEN pii_reader OR view_count >= 5 THEN view_count ELSE NULL END,
        'click', CASE WHEN pii_reader OR click_count >= 5 THEN click_count ELSE NULL END,
        'form_submit', CASE WHEN pii_reader OR form_count >= 5 THEN form_count ELSE NULL END,
        'pack_download', CASE WHEN pii_reader OR download_count >= 5 THEN download_count ELSE NULL END
      ) ORDER BY click_count + form_count + download_count DESC), '[]'::jsonb)
      FROM (
        SELECT CASE WHEN e.cta_id IN ('due_diligence_cta','buyers_guide_form','due_diligence_page','due_diligence_form','due_diligence_pack')
          THEN e.cta_id ELSE '(other)' END AS cta_id,
          count(*) FILTER (WHERE e.event_type = 'view') AS view_count,
          count(*) FILTER (WHERE e.event_type = 'click') AS click_count,
          count(*) FILTER (WHERE e.event_type = 'form_submit') AS form_count,
          count(*) FILTER (WHERE e.event_type = 'pack_download') AS download_count
        FROM public.mkt_cta_events e
        WHERE e.created_at >= since_at
        GROUP BY 1
      ) AS grouped_ctas
      WHERE pii_reader OR view_count + click_count + form_count + download_count >= 5
    ),
    'bySource', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total) ORDER BY total DESC), '[]'::jsonb)
      FROM (
        SELECT CASE WHEN e.source IN ('book_demo','contact_form','due_diligence_page','home_popup','buyers_guide_teaser','home_inline','home_procurement_pathway','security_page_hero','security_aligned_vs_certified','roi_estimator','other','chatbot','talk_to_falcon')
          THEN e.source ELSE '(other)' END AS source,
          count(*) AS total
        FROM public.mkt_cta_events e
        WHERE e.created_at >= since_at
        GROUP BY 1
      ) AS grouped_sources
      WHERE pii_reader OR total >= 5
    ),
    'byRegion', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('region', region, 'total', total) ORDER BY total DESC), '[]'::jsonb)
      FROM (
        SELECT CASE WHEN e.region ~ '^[A-Z]{2}$' THEN e.region ELSE '(other)' END AS region,
          count(*) AS total
        FROM public.mkt_cta_events e
        WHERE e.created_at >= since_at
        GROUP BY 1
      ) AS grouped_regions
      WHERE pii_reader OR total >= 5
    ),
    'recent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'event_type', event_type, 'total', total) ORDER BY day DESC, event_type), '[]'::jsonb)
      FROM (
        SELECT to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               e.event_type,
               count(*) AS total
        FROM public.mkt_cta_events e
        WHERE e.created_at >= since_at
        GROUP BY 1, 2
      ) AS grouped_recent
      WHERE pii_reader OR total >= 5
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.mkt_cta_analytics(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_cta_analytics(integer) TO authenticated;

-- AI admins need provider-level usage trends, not the per-call usage rows that
-- carry session links. Return grouped provider/day totals and suppress cells
-- with fewer than five calls for aggregate-only readers.
CREATE OR REPLACE FUNCTION public.mkt_llm_usage_stats(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pii_reader boolean := public.has_mkt_pii_read_access();
  since_at timestamptz;
  calls_count bigint;
  ok_count bigint;
  token_count bigint;
  cost_total numeric;
  latency_total bigint;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'ai_admin'::public.mkt_admin_role)
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF _days IS NULL OR _days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'unsupported range' USING ERRCODE = '22023';
  END IF;
  since_at := now() - make_interval(days => _days);

  SELECT count(*), count(*) FILTER (WHERE ok),
         coalesce(sum(tokens_in + tokens_out), 0), coalesce(sum(cost_usd), 0),
         coalesce(sum(latency_ms), 0)
  INTO calls_count, ok_count, token_count, cost_total, latency_total
  FROM public.mkt_llm_usage
  WHERE created_at >= since_at;

  SELECT jsonb_build_object(
    'restricted', NOT pii_reader,
    'totals', jsonb_build_object(
      'calls', CASE WHEN pii_reader OR calls_count >= 5 THEN calls_count ELSE NULL END,
      'ok_rate', CASE WHEN pii_reader OR calls_count >= 5
        THEN CASE WHEN calls_count = 0 THEN 1 ELSE ok_count::numeric / calls_count END ELSE NULL END,
      'tokens', CASE WHEN pii_reader OR calls_count >= 5 THEN token_count ELSE NULL END,
      'cost_usd', CASE WHEN pii_reader OR calls_count >= 5 THEN cost_total ELSE NULL END,
      'avg_latency_ms', CASE WHEN pii_reader OR calls_count >= 5
        THEN CASE WHEN calls_count = 0 THEN 0 ELSE round(latency_total::numeric / calls_count)::bigint END ELSE NULL END
    ),
    'byProvider', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', coalesce(provider_id::text, 'unknown'),
        'name', coalesce(display_name, 'Unknown'),
        'provider', coalesce(provider, 'unknown'),
        'calls', calls,
        'ok', ok_calls,
        'tokens_in', tokens_in,
        'tokens_out', tokens_out,
        'cost_usd', cost_usd,
        'latency_sum', latency_sum
      ) ORDER BY cost_usd DESC), '[]'::jsonb)
      FROM (
        SELECT u.provider_id, p.display_name, p.provider,
               count(*) AS calls,
               count(*) FILTER (WHERE u.ok) AS ok_calls,
               coalesce(sum(u.tokens_in), 0) AS tokens_in,
               coalesce(sum(u.tokens_out), 0) AS tokens_out,
               coalesce(sum(u.cost_usd), 0) AS cost_usd,
               coalesce(sum(u.latency_ms), 0) AS latency_sum
        FROM public.mkt_llm_usage u
        LEFT JOIN public.mkt_llm_providers p ON p.id = u.provider_id
        WHERE u.created_at >= since_at
        GROUP BY u.provider_id, p.display_name, p.provider
      ) AS provider_totals
      WHERE pii_reader OR calls >= 5
    ),
    'byDay', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day', day, 'cost_usd', cost_usd, 'tokens', tokens, 'calls', calls
      ) ORDER BY day), '[]'::jsonb)
      FROM (
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               coalesce(sum(cost_usd), 0) AS cost_usd,
               coalesce(sum(tokens_in + tokens_out), 0) AS tokens,
               count(*) AS calls
        FROM public.mkt_llm_usage
        WHERE created_at >= since_at
        GROUP BY 1
      ) AS day_totals
      WHERE pii_reader OR calls >= 5
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.mkt_llm_usage_stats(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_llm_usage_stats(integer) TO authenticated;

COMMIT;
