CREATE OR REPLACE FUNCTION public.webhook_outbox_replay(p_outbox_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.webhook_outbox WHERE id = p_outbox_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.has_tenant_role(auth.uid(), v_tenant, 'tenant_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.webhook_outbox
     SET status = 'pending',
         attempts = 0,
         next_attempt_at = now(),
         last_error = NULL
   WHERE id = p_outbox_id;

  INSERT INTO public.audit_log(tenant_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_tenant, auth.uid(), 'webhook.replay', 'webhook_outbox', p_outbox_id::text, jsonb_build_object('source','manual'));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.webhook_health_stats(p_tenant_id uuid)
RETURNS TABLE (
  delivered bigint, failed bigint, dead bigint, pending bigint, subscriptions bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_tenant_role(auth.uid(), p_tenant_id, 'tenant_admin')
     AND NOT public.has_tenant_role(auth.uid(), p_tenant_id, 'tenant_analyst') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.webhook_deliveries d
       JOIN public.webhook_subscriptions s ON s.id = d.subscription_id
      WHERE s.tenant_id = p_tenant_id
        AND d.response_status BETWEEN 200 AND 299
        AND d.created_at > now() - interval '24 hours') AS delivered,
    (SELECT COUNT(*) FROM public.webhook_deliveries d
       JOIN public.webhook_subscriptions s ON s.id = d.subscription_id
      WHERE s.tenant_id = p_tenant_id
        AND d.response_status IS NOT NULL
        AND (d.response_status < 200 OR d.response_status >= 300)
        AND d.created_at > now() - interval '24 hours') AS failed,
    (SELECT COUNT(*) FROM public.webhook_outbox
      WHERE tenant_id = p_tenant_id AND status = 'dead'
        AND created_at > now() - interval '24 hours') AS dead,
    (SELECT COUNT(*) FROM public.webhook_outbox
      WHERE tenant_id = p_tenant_id AND status = 'pending') AS pending,
    (SELECT COUNT(*) FROM public.webhook_subscriptions
      WHERE tenant_id = p_tenant_id AND enabled = true) AS subscriptions;
END $$;