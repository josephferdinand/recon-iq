
CREATE TABLE IF NOT EXISTS public.tenant_retention_overrides (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  retention_days int NOT NULL CHECK (retention_days >= 1 AND retention_days <= 3650),
  reason text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, table_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_retention_overrides TO authenticated;
GRANT ALL ON public.tenant_retention_overrides TO service_role;
ALTER TABLE public.tenant_retention_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tro_read" ON public.tenant_retention_overrides;
CREATE POLICY "tro_read" ON public.tenant_retention_overrides
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
DROP POLICY IF EXISTS "tro_write" ON public.tenant_retention_overrides;
CREATE POLICY "tro_write" ON public.tenant_retention_overrides
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

DROP POLICY IF EXISTS "rp_platform_admin_write" ON public.retention_policies;
CREATE POLICY "rp_platform_admin_write" ON public.retention_policies
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.effective_retention_days(_tenant uuid, _table text)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT retention_days FROM public.tenant_retention_overrides
      WHERE tenant_id = _tenant AND table_name = _table),
    (SELECT retention_days FROM public.retention_policies WHERE table_name = _table),
    365
  )
$$;

CREATE TABLE IF NOT EXISTS public.retention_archive_ledger (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  table_name text NOT NULL,
  archive_uri text,
  row_count int NOT NULL DEFAULT 0,
  earliest_ts timestamptz,
  latest_ts timestamptz,
  sha256_hex text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.retention_archive_ledger TO authenticated;
GRANT ALL ON public.retention_archive_ledger TO service_role;
ALTER TABLE public.retention_archive_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ral_read" ON public.retention_archive_ledger;
CREATE POLICY "ral_read" ON public.retention_archive_ledger
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid())
         OR (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')));
DROP POLICY IF EXISTS "ral_admin_write" ON public.retention_archive_ledger;
CREATE POLICY "ral_admin_write" ON public.retention_archive_ledger
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS TABLE(t_name text, t_tenant uuid, t_deleted bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; d bigint;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    WITH del AS (
      DELETE FROM public.ai_usage_events
       WHERE tenant_id = r.id
         AND created_at < now() - make_interval(days => public.effective_retention_days(r.id,'ai_usage_events'))
      RETURNING 1
    ) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'ai_usage_events'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;

    WITH del AS (
      DELETE FROM public.security_events
       WHERE tenant_id = r.id
         AND occurred_at < now() - make_interval(days => public.effective_retention_days(r.id,'security_events'))
      RETURNING 1
    ) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'security_events'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;

    WITH del AS (
      DELETE FROM public.recon_runs
       WHERE tenant_id = r.id
         AND started_at < now() - make_interval(days => public.effective_retention_days(r.id,'recon_runs'))
      RETURNING 1
    ) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'recon_runs'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;
  END LOOP;

  WITH del AS (
    DELETE FROM public.email_send_log
     WHERE created_at < now() - make_interval(days => COALESCE((
       SELECT retention_days FROM public.retention_policies WHERE table_name='email_send_log'), 365))
    RETURNING 1
  ) SELECT count(*) INTO d FROM del;
  IF d > 0 THEN t_name := 'email_send_log'; t_tenant := NULL; t_deleted := d; RETURN NEXT; END IF;

  RETURN;
END $$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_data() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_data() TO service_role;
REVOKE EXECUTE ON FUNCTION public.effective_retention_days(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.effective_retention_days(uuid,text) TO authenticated, service_role;
