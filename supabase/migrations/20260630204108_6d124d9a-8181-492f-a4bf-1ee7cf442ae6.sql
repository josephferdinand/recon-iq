
CREATE OR REPLACE FUNCTION public.assert_tenant_access(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'tenant_isolation: unauthenticated caller' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_isolation: tenant_id is required' USING ERRCODE = '22023';
  END IF;

  IF public.is_platform_admin(_uid) THEN
    RETURN;
  END IF;

  IF NOT public.is_tenant_member(_uid, _tenant_id) THEN
    BEGIN
      INSERT INTO public.security_events (event_type, severity, actor_id, tenant_id, payload)
      VALUES ('tenant_isolation.assert_denied', 'high', _uid, _tenant_id,
              jsonb_build_object('reason', 'not_a_member'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RAISE EXCEPTION 'tenant_isolation: caller % is not a member of tenant %', _uid, _tenant_id
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_tenant_access(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assert_tenant_access(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.tenant_scoped_tables_audit
WITH (security_invoker = on) AS
SELECT
  c.relname              AS table_name,
  c.relrowsecurity       AS rls_enabled,
  c.relforcerowsecurity  AS rls_forced,
  (SELECT count(*) FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attname = 'tenant_id'
  AND NOT a.attisdropped;

REVOKE ALL ON public.tenant_scoped_tables_audit FROM public, anon, authenticated;
GRANT SELECT ON public.tenant_scoped_tables_audit TO service_role;

CREATE TABLE IF NOT EXISTS public.tenant_isolation_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  violation_type text NOT NULL,
  tenant_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes text
);

GRANT SELECT, UPDATE ON public.tenant_isolation_violations TO authenticated;
GRANT ALL ON public.tenant_isolation_violations TO service_role;

ALTER TABLE public.tenant_isolation_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins view violations"
  ON public.tenant_isolation_violations FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "Platform admins resolve violations"
  ON public.tenant_isolation_violations FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS tenant_isolation_violations_open_idx
  ON public.tenant_isolation_violations (detected_at DESC)
  WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.scan_tenant_isolation_violations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
  null_count bigint;
  total_violations integer := 0;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND a.attname = 'tenant_id' AND NOT a.attisdropped
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t.table_name)
        INTO null_count;
      IF null_count > 0 THEN
        INSERT INTO public.tenant_isolation_violations (table_name, violation_type, details)
        VALUES (t.table_name, 'null_tenant_id',
                jsonb_build_object('row_count', null_count, 'scanned_at', now()));
        total_violations := total_violations + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.tenant_isolation_violations (table_name, violation_type, details)
      VALUES (t.table_name, 'scan_error',
              jsonb_build_object('error', SQLERRM, 'scanned_at', now()));
    END;
  END LOOP;
  RETURN total_violations;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scan_tenant_isolation_violations() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_tenant_isolation_violations() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tenant-isolation-scan';
    PERFORM cron.schedule(
      'tenant-isolation-scan',
      '17 */6 * * *',
      $cron$SELECT public.scan_tenant_isolation_violations();$cron$
    );
  END IF;
END $$;
