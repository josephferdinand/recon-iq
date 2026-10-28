
-- Sandbox is the 4th environment (lowest tier). Off by default; only
-- platform admins can enable it per tenant, with optional expiry.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS sandbox_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sandbox_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS sandbox_enabled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS sandbox_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sandbox_notes text;

CREATE INDEX IF NOT EXISTS idx_tenants_sandbox_enabled
  ON public.tenants(sandbox_enabled) WHERE sandbox_enabled = true;

-- Toggle helper: platform-admin only. Writes tenants row, upserts a
-- sandbox row in tenant_environments, and appends to audit_log.
CREATE OR REPLACE FUNCTION public.set_tenant_sandbox(
  _tenant_id uuid,
  _enabled boolean,
  _expires_at timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _slug text;
BEGIN
  IF NOT public.is_platform_admin(_uid) THEN
    RAISE EXCEPTION 'forbidden: platform admin required';
  END IF;

  SELECT slug INTO _slug FROM public.tenants WHERE id = _tenant_id;
  IF _slug IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;

  UPDATE public.tenants
     SET sandbox_enabled = _enabled,
         sandbox_enabled_at = CASE WHEN _enabled THEN now() ELSE sandbox_enabled_at END,
         sandbox_enabled_by = CASE WHEN _enabled THEN _uid ELSE sandbox_enabled_by END,
         sandbox_expires_at = CASE WHEN _enabled THEN _expires_at ELSE NULL END,
         sandbox_notes = _notes,
         updated_at = now()
   WHERE id = _tenant_id;

  IF _enabled THEN
    INSERT INTO public.tenant_environments (tenant_id, env, host, is_active)
    VALUES (_tenant_id, 'sandbox'::public.tenant_env,
            _slug || '-sandbox.recon-spark.example', true)
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.tenant_environments
       SET is_active = false, updated_at = now()
     WHERE tenant_id = _tenant_id AND env = 'sandbox'::public.tenant_env;
  END IF;

  INSERT INTO public.audit_log (actor_id, tenant_id, action, resource_type, resource_id, details)
  VALUES (_uid, _tenant_id,
          CASE WHEN _enabled THEN 'tenant.sandbox_enabled' ELSE 'tenant.sandbox_disabled' END,
          'tenant', _tenant_id,
          jsonb_build_object('expires_at', _expires_at, 'notes', _notes));
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_sandbox(uuid, boolean, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_sandbox(uuid, boolean, timestamptz, text) TO authenticated;
