-- D4: retention policy extensions (additive — no breaking changes)

ALTER TABLE public.retention_policies
  ADD COLUMN IF NOT EXISTS floor_days int,
  ADD COLUMN IF NOT EXISTS archive_to text,
  ADD COLUMN IF NOT EXISTS configurable boolean NOT NULL DEFAULT true;

-- Back-fill floors / configurability for existing seeded rows.
UPDATE public.retention_policies SET configurable = false, floor_days = NULL
  WHERE table_name = 'audit_log';
UPDATE public.retention_policies SET floor_days = 90  WHERE table_name = 'recon_runs'        AND floor_days IS NULL;
UPDATE public.retention_policies SET floor_days = 30  WHERE table_name = 'email_send_log'    AND floor_days IS NULL;
UPDATE public.retention_policies SET floor_days = 180 WHERE table_name = 'ai_usage_events'   AND floor_days IS NULL;
UPDATE public.retention_policies SET floor_days = 180 WHERE table_name = 'security_events'   AND floor_days IS NULL;

-- Seed the new data classes.
INSERT INTO public.retention_policies(table_name, retention_days, regulatory_basis, floor_days, configurable) VALUES
  ('recon_exceptions',                 395, 'Break management evidence (13 months)',                90, true),
  ('recon_matches',                    395, 'Match audit trail (13 months)',                        90, true),
  ('aidp_pages',                        90, 'AIDP page binaries — short-lived working set',         30, true),
  ('aidp_output_recon_invalidations',   90, 'AIDP→Recon invalidation index — short-lived',          30, true)
ON CONFLICT (table_name) DO NOTHING;

-- Floor / configurability guard on tenant overrides.
CREATE OR REPLACE FUNCTION public.tg_retention_override_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pol record;
BEGIN
  SELECT retention_days, floor_days, configurable
    INTO pol
    FROM public.retention_policies
   WHERE table_name = NEW.table_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention_policies has no row for %', NEW.table_name USING ERRCODE = '23514';
  END IF;
  IF pol.configurable = false THEN
    RAISE EXCEPTION 'retention for % is not tenant-configurable', NEW.table_name USING ERRCODE = '42501';
  END IF;
  IF pol.floor_days IS NOT NULL AND NEW.retention_days < pol.floor_days THEN
    RAISE EXCEPTION 'retention_days % is below floor of % for %', NEW.retention_days, pol.floor_days, NEW.table_name USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_retention_override_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tro_floor_guard ON public.tenant_retention_overrides;
CREATE TRIGGER tro_floor_guard
  BEFORE INSERT OR UPDATE ON public.tenant_retention_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_retention_override_guard();

-- Expand purge_expired_data() to cover the new classes.
CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS TABLE(t_name text, t_tenant uuid, t_deleted bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; d bigint;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    WITH del AS (DELETE FROM public.ai_usage_events
       WHERE tenant_id = r.id AND created_at < now() - make_interval(days => public.effective_retention_days(r.id,'ai_usage_events'))
      RETURNING 1) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'ai_usage_events'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;

    WITH del AS (DELETE FROM public.security_events
       WHERE tenant_id = r.id AND occurred_at < now() - make_interval(days => public.effective_retention_days(r.id,'security_events'))
      RETURNING 1) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'security_events'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;

    WITH del AS (DELETE FROM public.recon_runs
       WHERE tenant_id = r.id AND started_at < now() - make_interval(days => public.effective_retention_days(r.id,'recon_runs'))
      RETURNING 1) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'recon_runs'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;

    WITH del AS (DELETE FROM public.recon_exceptions
       WHERE tenant_id = r.id AND created_at < now() - make_interval(days => public.effective_retention_days(r.id,'recon_exceptions'))
      RETURNING 1) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'recon_exceptions'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;

    WITH del AS (DELETE FROM public.recon_matches
       WHERE tenant_id = r.id AND created_at < now() - make_interval(days => public.effective_retention_days(r.id,'recon_matches'))
      RETURNING 1) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'recon_matches'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;

    WITH del AS (DELETE FROM public.aidp_pages p USING public.aidp_documents dd
       WHERE p.document_id = dd.id AND dd.tenant_id = r.id
         AND p.created_at < now() - make_interval(days => public.effective_retention_days(r.id,'aidp_pages'))
      RETURNING 1) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'aidp_pages'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;

    WITH del AS (DELETE FROM public.aidp_output_recon_invalidations
       WHERE tenant_id = r.id AND created_at < now() - make_interval(days => public.effective_retention_days(r.id,'aidp_output_recon_invalidations'))
      RETURNING 1) SELECT count(*) INTO d FROM del;
    IF d > 0 THEN t_name := 'aidp_output_recon_invalidations'; t_tenant := r.id; t_deleted := d; RETURN NEXT; END IF;
  END LOOP;

  WITH del AS (DELETE FROM public.email_send_log
     WHERE created_at < now() - make_interval(days => COALESCE((SELECT retention_days FROM public.retention_policies WHERE table_name='email_send_log'), 365))
    RETURNING 1) SELECT count(*) INTO d FROM del;
  IF d > 0 THEN t_name := 'email_send_log'; t_tenant := NULL; t_deleted := d; RETURN NEXT; END IF;

  RETURN;
END $$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_data() FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_expired_data() TO service_role;