
-- Exception Management v2 — Step 1

DO $$ BEGIN CREATE TYPE public.sla_breach_action AS ENUM ('notify','escalate','reassign','page_oncall'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.cp_msg_channel AS ENUM ('email','swift_mt','swift_mx','portal'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.cp_msg_direction AS ENUM ('outbound','inbound'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.bulk_job_status AS ENUM ('draft','queued','running','completed','failed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.break_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  severity text,
  product text,
  counterparty text,
  recon_id uuid REFERENCES public.recon_definitions(id) ON DELETE SET NULL,
  first_response_mins int NOT NULL DEFAULT 60 CHECK (first_response_mins > 0),
  resolution_mins int NOT NULL DEFAULT 480 CHECK (resolution_mins > 0),
  breach_action public.sla_breach_action NOT NULL DEFAULT 'escalate',
  escalation_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_hours jsonb NOT NULL DEFAULT '{"tz":"UTC","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 100,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_sla_policies TO authenticated;
GRANT ALL ON public.break_sla_policies TO service_role;
ALTER TABLE public.break_sla_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla_pol read" ON public.break_sla_policies FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "sla_pol write" ON public.break_sla_policies FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE TRIGGER trg_sla_pol_upd BEFORE UPDATE ON public.break_sla_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_sla_pol_tenant ON public.break_sla_policies(tenant_id, enabled, priority);

CREATE TABLE IF NOT EXISTS public.break_sla_timers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.break_sla_policies(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  due_first_response_at timestamptz NOT NULL,
  due_resolution_at timestamptz NOT NULL,
  first_response_at timestamptz,
  resolved_at timestamptz,
  paused_at timestamptz,
  pause_reason text,
  paused_total_seconds int NOT NULL DEFAULT 0,
  breached boolean NOT NULL DEFAULT false,
  breached_at timestamptz,
  escalation_level int NOT NULL DEFAULT 0,
  last_escalated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exception_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_sla_timers TO authenticated;
GRANT ALL ON public.break_sla_timers TO service_role;
ALTER TABLE public.break_sla_timers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla_tim read" ON public.break_sla_timers FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "sla_tim write" ON public.break_sla_timers FOR ALL TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE TRIGGER trg_sla_tim_upd BEFORE UPDATE ON public.break_sla_timers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_sla_tim_due ON public.break_sla_timers(tenant_id, breached, due_resolution_at);

CREATE TABLE IF NOT EXISTS public.break_sla_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  exception_id uuid NOT NULL,
  timer_id uuid,
  event_type text NOT NULL,
  level int,
  actor_user_id uuid,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.break_sla_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.break_sla_events_id_seq TO authenticated;
GRANT ALL ON public.break_sla_events TO service_role;
ALTER TABLE public.break_sla_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla_ev read" ON public.break_sla_events FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "sla_ev insert" ON public.break_sla_events FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX IF NOT EXISTS idx_sla_ev_ex ON public.break_sla_events(exception_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.break_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  parent_code text,
  description text,
  default_resolver_role text,
  journal_template jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_categories TO authenticated;
GRANT ALL ON public.break_categories TO service_role;
ALTER TABLE public.break_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cat read" ON public.break_categories FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "cat write" ON public.break_categories FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE TRIGGER trg_cat_upd BEFORE UPDATE ON public.break_categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.break_categories (tenant_id, code, label, description, journal_template) VALUES
  (NULL,'fx','FX Difference','Currency conversion / FX revaluation difference','{"entries":[{"debit":"7100-FX-REVAL","credit":"1000-NOSTRO","narrative":"FX revaluation adjustment"}],"reason_codes":["FX_RATE_DRIFT","FX_TIMING"]}'),
  (NULL,'timing','Timing','Cut-off / value-date timing difference','{"entries":[],"reason_codes":["VALUE_DATE_DIFF","CUTOFF"]}'),
  (NULL,'fee','Fee / Charge','Unrecorded bank fee or charge','{"entries":[{"debit":"6300-BANK-FEES","credit":"1000-NOSTRO","narrative":"Bank fee write-off"}],"reason_codes":["BANK_FEE","WIRE_FEE"]}'),
  (NULL,'missing','Missing Item','One side absent from reconciliation feed','{"entries":[],"reason_codes":["MISSING_LEDGER","MISSING_BANK"]}'),
  (NULL,'duplicate','Duplicate','Same transaction reported twice','{"entries":[],"reason_codes":["DUPLICATE_LEDGER","DUPLICATE_BANK"]}'),
  (NULL,'principal','Principal Difference','Material principal value mismatch','{"entries":[{"debit":"7900-RECON-LOSS","credit":"1000-NOSTRO","narrative":"Principal write-off"}],"reason_codes":["PRINCIPAL_MISMATCH"]}'),
  (NULL,'settlement','Settlement','Settlement / clearing related break','{"entries":[],"reason_codes":["UNSETTLED","FAILED_TRADE"]}'),
  (NULL,'static','Static Data','Reference data / SSI mismatch','{"entries":[],"reason_codes":["SSI_MISMATCH","ACCOUNT_MISMATCH"]}')
ON CONFLICT (tenant_id, code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.break_category_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  category_code text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  model text NOT NULL DEFAULT 'heuristic-v1',
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted boolean,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.break_category_predictions TO authenticated;
GRANT ALL ON public.break_category_predictions TO service_role;
ALTER TABLE public.break_category_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catpred read" ON public.break_category_predictions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "catpred insert" ON public.break_category_predictions FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "catpred update" ON public.break_category_predictions FOR UPDATE TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX IF NOT EXISTS idx_catpred_ex ON public.break_category_predictions(exception_id);

CREATE TABLE IF NOT EXISTS public.break_resolution_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  predicted_resolver_id uuid,
  predicted_minutes int,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  model_version text NOT NULL DEFAULT 'history-v1',
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.break_resolution_predictions TO authenticated;
GRANT ALL ON public.break_resolution_predictions TO service_role;
ALTER TABLE public.break_resolution_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "respred read" ON public.break_resolution_predictions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "respred insert" ON public.break_resolution_predictions FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX IF NOT EXISTS idx_respred_ex ON public.break_resolution_predictions(exception_id);

CREATE TABLE IF NOT EXISTS public.counterparty_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  channel public.cp_msg_channel NOT NULL DEFAULT 'email',
  subject text,
  counterparty_id text,
  counterparty_name text,
  external_message_id text,
  status text NOT NULL DEFAULT 'open',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.counterparty_threads TO authenticated;
GRANT ALL ON public.counterparty_threads TO service_role;
ALTER TABLE public.counterparty_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cpt read" ON public.counterparty_threads FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "cpt write" ON public.counterparty_threads FOR ALL TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE TRIGGER trg_cpt_upd BEFORE UPDATE ON public.counterparty_threads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_cpt_msgid ON public.counterparty_threads(tenant_id, external_message_id);

CREATE TABLE IF NOT EXISTS public.counterparty_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.counterparty_threads(id) ON DELETE CASCADE,
  direction public.cp_msg_direction NOT NULL,
  channel public.cp_msg_channel NOT NULL,
  from_addr text,
  to_addr text,
  cc_addr text,
  body_text text,
  body_html text,
  swift_block text,
  raw_headers jsonb,
  parsed_intent text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_by uuid,
  sent_at timestamptz NOT NULL DEFAULT now(),
  external_message_id text
);
GRANT SELECT, INSERT ON public.counterparty_messages TO authenticated;
GRANT ALL ON public.counterparty_messages TO service_role;
ALTER TABLE public.counterparty_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cpm read" ON public.counterparty_messages FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "cpm insert" ON public.counterparty_messages FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX IF NOT EXISTS idx_cpm_thread ON public.counterparty_messages(thread_id, sent_at);

CREATE TABLE IF NOT EXISTS public.bulk_resolution_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recon_id uuid REFERENCES public.recon_definitions(id) ON DELETE SET NULL,
  filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_code text NOT NULL,
  category_code text,
  target_status text NOT NULL DEFAULT 'resolved',
  notes text,
  dry_run boolean NOT NULL DEFAULT true,
  status public.bulk_job_status NOT NULL DEFAULT 'draft',
  total int NOT NULL DEFAULT 0,
  processed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  journal_preview jsonb,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.bulk_resolution_jobs TO authenticated;
GRANT ALL ON public.bulk_resolution_jobs TO service_role;
ALTER TABLE public.bulk_resolution_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brj read" ON public.bulk_resolution_jobs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "brj insert" ON public.bulk_resolution_jobs FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "brj update" ON public.bulk_resolution_jobs FOR UPDATE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE TRIGGER trg_brj_upd BEFORE UPDATE ON public.bulk_resolution_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_id uuid REFERENCES public.recon_exceptions(id) ON DELETE SET NULL,
  bulk_job_id uuid REFERENCES public.bulk_resolution_jobs(id) ON DELETE SET NULL,
  debit_account text NOT NULL,
  credit_account text NOT NULL,
  amount numeric(20,4) NOT NULL,
  currency text NOT NULL,
  narrative text,
  reason_code text,
  category_code text,
  posted_at timestamptz,
  posted_by uuid,
  reversal_of uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.journal_entries TO authenticated;
GRANT ALL ON public.journal_entries TO service_role;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "je read" ON public.journal_entries FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "je insert" ON public.journal_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "je post" ON public.journal_entries FOR UPDATE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE INDEX IF NOT EXISTS idx_je_ex ON public.journal_entries(tenant_id, exception_id);

ALTER TABLE public.exception_assignment_rules
  ADD COLUMN IF NOT EXISTS queue_type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS skill_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS counterparty_match text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS product_match text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS max_wip_per_assignee int,
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '{"tz":"UTC","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb;

CREATE OR REPLACE FUNCTION public.sla_evaluate_breaches()
RETURNS TABLE(exception_id uuid, action text, level int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; v_policy public.break_sla_policies%ROWTYPE; v_step jsonb; v_next_level int; v_after_mins int;
BEGIN
  FOR r IN
    SELECT t.* FROM public.break_sla_timers t
    JOIN public.recon_exceptions e ON e.id = t.exception_id
    WHERE t.resolved_at IS NULL AND t.paused_at IS NULL
      AND e.status NOT IN ('resolved','closed','written_off')
  LOOP
    SELECT * INTO v_policy FROM public.break_sla_policies WHERE id = r.policy_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF NOT r.breached AND now() > r.due_resolution_at THEN
      UPDATE public.break_sla_timers SET breached = true, breached_at = now() WHERE id = r.id;
      INSERT INTO public.break_sla_events(tenant_id, exception_id, timer_id, event_type, context)
        VALUES (r.tenant_id, r.exception_id, r.id, 'breached',
                jsonb_build_object('due_resolution_at', r.due_resolution_at));
      exception_id := r.exception_id; action := 'breached'; level := r.escalation_level; RETURN NEXT;
    END IF;

    v_next_level := r.escalation_level + 1;
    v_step := (SELECT s FROM jsonb_array_elements(v_policy.escalation_chain) s
                WHERE (s->>'level')::int = v_next_level LIMIT 1);
    IF v_step IS NOT NULL THEN
      v_after_mins := COALESCE((v_step->>'after_mins')::int, 0);
      IF now() >= r.started_at + make_interval(mins => v_after_mins) THEN
        UPDATE public.break_sla_timers
           SET escalation_level = v_next_level, last_escalated_at = now()
         WHERE id = r.id;
        INSERT INTO public.break_sla_events(tenant_id, exception_id, timer_id, event_type, level, context)
          VALUES (r.tenant_id, r.exception_id, r.id, 'escalated', v_next_level, v_step);

        IF (v_step ? 'notify_user_id') THEN
          INSERT INTO public.notifications(user_id, tenant_id, kind, title, body, link_to, severity, context)
          VALUES ((v_step->>'notify_user_id')::uuid, r.tenant_id, 'sla_escalated',
                  'SLA escalation L' || v_next_level,
                  'Exception ' || r.exception_id::text || ' escalated to level ' || v_next_level,
                  '/exceptions/' || r.exception_id::text, 'high',
                  jsonb_build_object('exception_id', r.exception_id, 'level', v_next_level));
        END IF;

        exception_id := r.exception_id; action := 'escalated'; level := v_next_level; RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
  RETURN;
END $$;
REVOKE EXECUTE ON FUNCTION public.sla_evaluate_breaches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sla_evaluate_breaches() TO service_role;

CREATE OR REPLACE FUNCTION public.predict_break_category(_exception uuid)
RETURNS TABLE(category_code text, confidence numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE e record; v_delta numeric; v_fx boolean;
BEGIN
  SELECT * INTO e FROM public.recon_exceptions WHERE id = _exception;
  IF NOT FOUND THEN RETURN; END IF;
  v_fx := COALESCE((e.left_data->>'currency') <> (e.right_data->>'currency'), false);
  v_delta := COALESCE(ABS(COALESCE((e.left_data->>'amount')::numeric,0)
                        - COALESCE((e.right_data->>'amount')::numeric,0)), 0);
  IF v_fx THEN category_code := 'fx'; confidence := 0.86; RETURN NEXT; RETURN; END IF;
  IF e.left_data IS NULL OR e.right_data IS NULL THEN
    category_code := 'missing'; confidence := 0.93; RETURN NEXT; RETURN;
  END IF;
  IF v_delta > 0 AND v_delta < 5 THEN category_code := 'fee'; confidence := 0.71; RETURN NEXT; RETURN; END IF;
  IF e.left_data->>'value_date' IS DISTINCT FROM e.right_data->>'value_date' THEN
    category_code := 'timing'; confidence := 0.78; RETURN NEXT; RETURN;
  END IF;
  IF v_delta >= 5 THEN category_code := 'principal'; confidence := 0.66; RETURN NEXT; RETURN; END IF;
  category_code := 'static'; confidence := 0.40; RETURN NEXT;
END $$;
REVOKE EXECUTE ON FUNCTION public.predict_break_category(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.predict_break_category(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.seed_default_sla_policy(_tenant uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_tenant_role(auth.uid(), _tenant, 'tenant_admin'::tenant_role)
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  SELECT id INTO v_id FROM public.break_sla_policies
    WHERE tenant_id = _tenant AND name = 'Default — Falcon Bank' LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.break_sla_policies(
    tenant_id, name, description, first_response_mins, resolution_mins, breach_action,
    escalation_chain, priority
  ) VALUES (
    _tenant, 'Default — Falcon Bank', 'Baseline SLA: 1h first response, 8h resolution, 2-tier escalation',
    60, 480, 'escalate',
    '[{"level":1,"after_mins":30,"notify_role":"tenant_admin"},{"level":2,"after_mins":120,"notify_role":"tenant_admin"}]'::jsonb,
    100
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.seed_default_sla_policy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_sla_policy(uuid) TO authenticated, service_role;
