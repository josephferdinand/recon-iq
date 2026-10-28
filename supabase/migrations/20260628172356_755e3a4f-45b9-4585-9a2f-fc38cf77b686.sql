
-- Atomic claim with audit
CREATE OR REPLACE FUNCTION public.claim_regulatory_install(_install_id uuid)
RETURNS TABLE(claimed boolean, install_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb;
  v_old_status text;
  v_tenant uuid;
  v_actor uuid;
BEGIN
  SELECT status, tenant_id, installed_by
    INTO v_old_status, v_tenant, v_actor
    FROM public.regulatory_pack_installs
   WHERE id = _install_id
   FOR UPDATE;

  UPDATE public.regulatory_pack_installs
     SET status = 'materializing'
   WHERE id = _install_id
     AND status IN ('installing','pending','materializing')
  RETURNING to_jsonb(regulatory_pack_installs.*) INTO r;

  IF r IS NOT NULL AND v_old_status IS DISTINCT FROM 'materializing' THEN
    INSERT INTO public.audit_log(
      actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
    ) VALUES (
      v_actor, v_tenant, 'tenant',
      'regulatory.install.transition',
      'regulatory_pack_installs', _install_id::text,
      jsonb_build_object(
        'from', v_old_status, 'to', 'materializing',
        'transitioned_at', now(), 'worker', 'regulatory-install-worker'
      )
    );
  END IF;

  RETURN QUERY SELECT (r IS NOT NULL), r;
END $$;

REVOKE ALL ON FUNCTION public.claim_regulatory_install(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_regulatory_install(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_regulatory_install(uuid) TO service_role;

-- Atomic completion with audit
CREATE OR REPLACE FUNCTION public.complete_regulatory_install(
  _install_id uuid, _recon_id uuid, _pipeline_ids uuid[], _folder_name text, _field_count int
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_status text;
  v_tenant uuid;
  v_actor uuid;
BEGIN
  SELECT status, tenant_id, installed_by
    INTO v_old_status, v_tenant, v_actor
    FROM public.regulatory_pack_installs
   WHERE id = _install_id
   FOR UPDATE;

  UPDATE public.regulatory_pack_installs
     SET status = 'ready', completed_at = now(), materialized_at = now(),
         generated_process_count = COALESCE(array_length(_pipeline_ids, 1), 0) + 1,
         tenant_root_process_id = _recon_id, recon_id = _recon_id,
         materialized_artifacts = jsonb_build_object(
           'folder', _folder_name, 'pipeline_ids', to_jsonb(_pipeline_ids),
           'recon_id', _recon_id, 'field_count', _field_count
         )
   WHERE id = _install_id;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    v_actor, v_tenant, 'tenant',
    'regulatory.install.transition',
    'regulatory_pack_installs', _install_id::text,
    jsonb_build_object(
      'from', v_old_status, 'to', 'ready',
      'transitioned_at', now(), 'worker', 'regulatory-install-worker',
      'recon_id', _recon_id,
      'pipeline_count', COALESCE(array_length(_pipeline_ids, 1), 0),
      'folder', _folder_name, 'field_count', _field_count
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.complete_regulatory_install(uuid, uuid, uuid[], text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_regulatory_install(uuid, uuid, uuid[], text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_regulatory_install(uuid, uuid, uuid[], text, int) TO service_role;

-- Atomic failure with audit
CREATE OR REPLACE FUNCTION public.fail_regulatory_install(
  _install_id uuid, _error text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_status text;
  v_tenant uuid;
  v_actor uuid;
BEGIN
  SELECT status, tenant_id, installed_by
    INTO v_old_status, v_tenant, v_actor
    FROM public.regulatory_pack_installs
   WHERE id = _install_id
   FOR UPDATE;

  UPDATE public.regulatory_pack_installs
     SET status = 'failed',
         error_message = _error,
         materialization_error = _error
   WHERE id = _install_id;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    v_actor, v_tenant, 'tenant',
    'regulatory.install.transition',
    'regulatory_pack_installs', _install_id::text,
    jsonb_build_object(
      'from', v_old_status, 'to', 'failed',
      'transitioned_at', now(), 'worker', 'regulatory-install-worker',
      'error', _error
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.fail_regulatory_install(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_regulatory_install(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_regulatory_install(uuid, text) TO service_role;

-- Backfill: emit a transition audit row for the initial pending → installing
-- step that happens at install request time. This is enforced via a trigger
-- so future status changes outside the RPCs are still captured.
CREATE OR REPLACE FUNCTION public.tg_regulatory_install_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(
      actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
    ) VALUES (
      NEW.installed_by, NEW.tenant_id, 'tenant',
      'regulatory.install.transition',
      'regulatory_pack_installs', NEW.id::text,
      jsonb_build_object(
        'from', NULL, 'to', NEW.status,
        'transitioned_at', now(),
        'pack_id', NEW.pack_id,
        'installed_version', NEW.installed_version
      )
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Skip if the transition came from one of our SECURITY DEFINER RPCs,
    -- which already insert their own (richer) audit row. We detect that via
    -- the action label seen on the most recent audit row for this resource
    -- within the current statement window.
    IF NOT EXISTS (
      SELECT 1 FROM public.audit_log
       WHERE resource_type = 'regulatory_pack_installs'
         AND resource_id = NEW.id::text
         AND action = 'regulatory.install.transition'
         AND occurred_at > now() - interval '2 seconds'
         AND (context->>'to') = NEW.status
    ) THEN
      INSERT INTO public.audit_log(
        actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
      ) VALUES (
        COALESCE(auth.uid(), NEW.installed_by), NEW.tenant_id, 'tenant',
        'regulatory.install.transition',
        'regulatory_pack_installs', NEW.id::text,
        jsonb_build_object(
          'from', OLD.status, 'to', NEW.status,
          'transitioned_at', now(),
          'source', 'trigger'
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS regulatory_install_audit_trg ON public.regulatory_pack_installs;
CREATE TRIGGER regulatory_install_audit_trg
AFTER INSERT OR UPDATE OF status ON public.regulatory_pack_installs
FOR EACH ROW EXECUTE FUNCTION public.tg_regulatory_install_audit();
