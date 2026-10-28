-- Own isolated fixture only: full catalog reservation cap and attribution.
CREATE FUNCTION private.qa_budget_denied(_mutation text,_expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  EXECUTE _mutation;
  SET LOCAL ROLE service_role;
  BEGIN PERFORM public.prepare_public_ai_inference(repeat('a',64),NULL,'chat',NULL,4096);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM=_expected THEN denied:=true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT denied THEN RAISE EXCEPTION 'Missing required budget denial %',_expected; END IF;
  RAISE SQLSTATE 'Q0001';
 EXCEPTION WHEN SQLSTATE 'Q0001' THEN NULL; END;
END$$;
SELECT private.qa_budget_denied('UPDATE public.platform_ai_settings SET global_max_tokens_per_day=1','copilot.budget_reached');
SELECT private.qa_budget_denied('UPDATE public.ai_budgets SET daily_max_cost_usd=0','copilot.budget_reached');
SELECT private.qa_budget_denied('UPDATE public.platform_ai_settings SET ai_enabled=false','copilot.policy_unavailable');
SELECT private.qa_budget_denied('UPDATE public.tenant_ai_settings SET ai_enabled=false','copilot.policy_unavailable');
SELECT private.qa_budget_denied('UPDATE public.tenant_ai_settings SET allow_copilot=false','copilot.policy_unavailable');
SELECT private.qa_budget_denied('UPDATE public.platform_ai_settings SET llm_rl_per_user_max=1','copilot.rate_limit');
SELECT private.qa_budget_denied('UPDATE public.ai_quotas SET api_request_limit=10','copilot.quota_dimension_unavailable');
SELECT private.qa_budget_denied('UPDATE public.ai_model_catalog SET context_window=NULL','copilot.bounds_unavailable');
SELECT private.qa_budget_denied('UPDATE public.ai_model_pricing SET active=false','copilot.pricing_unavailable');
SELECT private.qa_budget_denied('UPDATE public.ai_model_pricing SET effective_at=now()+interval ''1 day''','copilot.pricing_unavailable');
SELECT private.qa_budget_denied('UPDATE public.ai_model_pricing SET expires_at=now()-interval ''1 day''','copilot.pricing_unavailable');
SELECT private.qa_budget_denied('UPDATE public.ai_model_pricing SET input_usd_per_1m=0','copilot.pricing_unavailable');
SELECT private.qa_budget_denied('UPDATE public.ai_model_pricing SET input_usd_per_1m=''NaN''','copilot.pricing_unavailable');
-- Exactly one usage row exists; unknown holds were never released, and a small
-- provider report retains the original catalog floor in every budget sum.
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.copilot_spend_reservations WHERE state='dispatched' AND actual_tokens IS NULL) THEN RAISE EXCEPTION 'unknown reservation released'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.copilot_spend_reservations WHERE state='settled' AND accounted_tokens=bound_tokens AND accounted_micro_usd=bound_micro_usd) THEN RAISE EXCEPTION 'bound floor reclaimed'; END IF;
 IF (SELECT count(*) FROM public.ai_usage_events)<>1 THEN RAISE EXCEPTION 'duplicate usage'; END IF;
END$$;
-- The extended fence must not admit an arbitrary service event, even when it
-- references a real reservation: the exact private AI request link is required.
DO $$DECLARE r public.copilot_spend_reservations%ROWTYPE; denied boolean:=false; BEGIN
 SELECT * INTO r FROM public.copilot_spend_reservations WHERE state='settled' LIMIT 1;
 BEGIN
  INSERT INTO public.ai_usage_events(tenant_id,user_id,scope,model,tokens_in,tokens_out,cost_usd,meta)
   VALUES(r.tenant_id,r.actor_id,'copilot',r.model_key,r.tokens_in,r.tokens_out,r.actual_micro_usd/1000000,jsonb_build_object('copilot_reservation_id',r.id));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='copilot.reservation_required' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'forged attribution admitted'; END IF;
END$$;
SELECT 'AI existing-budget native regression PASS' AS result;
