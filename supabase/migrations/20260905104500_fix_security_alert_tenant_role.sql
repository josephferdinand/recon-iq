-- `tenant_owner` is not a value of public.tenant_role. Security alert
-- notifications are an administrative action, so target tenant_admin only.

DO $repair$
DECLARE
  original text;
  fixed text;
BEGIN
  original := pg_get_functiondef('public.evaluate_security_alerts()'::regprocedure);
  fixed := replace(
    original,
    'AND tm.role IN (''tenant_admin'',''tenant_owner'')',
    'AND tm.role = ''tenant_admin''::public.tenant_role'
  );
  IF fixed = original THEN
    RAISE EXCEPTION 'evaluate_security_alerts tenant-role repair anchor missing';
  END IF;
  EXECUTE fixed;
END
$repair$;
