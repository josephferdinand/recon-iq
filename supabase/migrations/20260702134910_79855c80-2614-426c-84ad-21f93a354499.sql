
-- Fix 1: Restrict webhook_subscriptions SELECT to tenant admins (protects secret_hash)
DROP POLICY IF EXISTS wh_read ON public.webhook_subscriptions;
CREATE POLICY wh_read_admin ON public.webhook_subscriptions
  FOR SELECT TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

-- Fix 2: Set immutable search_path on tg_app_vault_touch
CREATE OR REPLACE FUNCTION public.tg_app_vault_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$function$;
