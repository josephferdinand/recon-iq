
DO $$ BEGIN
  CREATE TYPE public.app_vault_secret_class AS ENUM (
    'llm_api_key','integration_token','webhook_secret','signing_key','kms_credential','generic'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.app_vault_kek_provider AS ENUM (
    'meta_managed','aws_kms','gcp_kms','azure_kv'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.app_vault_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  secret_class public.app_vault_secret_class NOT NULL,
  name text NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  wrapped_dek bytea NOT NULL,
  kek_provider public.app_vault_kek_provider NOT NULL DEFAULT 'meta_managed',
  kek_ref text NOT NULL DEFAULT 'APP_DATA_ENC_KEY',
  fingerprint_sha256 text NOT NULL,
  last4 text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT app_vault_scope_tenant_ck CHECK (
    (scope='platform' AND tenant_id IS NULL) OR
    (scope='tenant' AND tenant_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS app_vault_secrets_uq_platform
  ON public.app_vault_secrets (secret_class, name) WHERE scope='platform';
CREATE UNIQUE INDEX IF NOT EXISTS app_vault_secrets_uq_tenant
  ON public.app_vault_secrets (tenant_id, secret_class, name) WHERE scope='tenant';
CREATE INDEX IF NOT EXISTS app_vault_secrets_tenant_idx ON public.app_vault_secrets(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_vault_secrets TO authenticated;
GRANT ALL ON public.app_vault_secrets TO service_role;
ALTER TABLE public.app_vault_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_vault_platform_admin_all ON public.app_vault_secrets FOR ALL TO authenticated
  USING (scope='platform' AND private.is_platform_admin(auth.uid()))
  WITH CHECK (scope='platform' AND private.is_platform_admin(auth.uid()));

CREATE POLICY app_vault_tenant_admin_all ON public.app_vault_secrets FOR ALL TO authenticated
  USING (
    scope='tenant' AND tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = app_vault_secrets.tenant_id
        AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'
    )
  )
  WITH CHECK (
    scope='tenant' AND tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = app_vault_secrets.tenant_id
        AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'
    )
  );

CREATE TABLE IF NOT EXISTS public.app_vault_rotation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_id uuid NOT NULL REFERENCES public.app_vault_secrets(id) ON DELETE CASCADE,
  rotated_by uuid NULL,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  from_version integer NOT NULL,
  to_version integer NOT NULL,
  from_fingerprint text NOT NULL,
  to_fingerprint text NOT NULL,
  kek_provider public.app_vault_kek_provider NOT NULL,
  kek_ref text NOT NULL,
  reason text NULL
);
GRANT SELECT, INSERT ON public.app_vault_rotation_log TO authenticated;
GRANT ALL ON public.app_vault_rotation_log TO service_role;
ALTER TABLE public.app_vault_rotation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_vault_rot_read ON public.app_vault_rotation_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.app_vault_secrets s
    WHERE s.id = app_vault_rotation_log.secret_id AND (
      (s.scope='platform' AND private.is_platform_admin(auth.uid()))
      OR (s.scope='tenant' AND EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = s.tenant_id AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'
      ))
    )
  ));

CREATE POLICY app_vault_rot_insert ON public.app_vault_rotation_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.app_vault_secrets s
    WHERE s.id = app_vault_rotation_log.secret_id AND (
      (s.scope='platform' AND private.is_platform_admin(auth.uid()))
      OR (s.scope='tenant' AND EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = s.tenant_id AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'
      ))
    )
  ));

CREATE TABLE IF NOT EXISTS public.app_vault_kms_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider public.app_vault_kek_provider NOT NULL,
  key_ref text NOT NULL,
  region text NULL,
  credential_secret_id uuid NULL REFERENCES public.app_vault_secrets(id),
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','revoked')),
  last_verified_at timestamptz NULL,
  verification_error text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kms_binding_scope_ck CHECK (
    (scope='platform' AND tenant_id IS NULL) OR
    (scope='tenant' AND tenant_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS app_vault_kms_default_platform
  ON public.app_vault_kms_bindings (scope) WHERE scope='platform' AND is_default;
CREATE UNIQUE INDEX IF NOT EXISTS app_vault_kms_default_tenant
  ON public.app_vault_kms_bindings (tenant_id) WHERE scope='tenant' AND is_default;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_vault_kms_bindings TO authenticated;
GRANT ALL ON public.app_vault_kms_bindings TO service_role;
ALTER TABLE public.app_vault_kms_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY kms_bind_platform_all ON public.app_vault_kms_bindings FOR ALL TO authenticated
  USING (scope='platform' AND private.is_platform_admin(auth.uid()))
  WITH CHECK (scope='platform' AND private.is_platform_admin(auth.uid()));

CREATE POLICY kms_bind_tenant_all ON public.app_vault_kms_bindings FOR ALL TO authenticated
  USING (
    scope='tenant' AND tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = app_vault_kms_bindings.tenant_id
        AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'
    )
  )
  WITH CHECK (
    scope='tenant' AND tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = app_vault_kms_bindings.tenant_id
        AND tm.user_id = auth.uid() AND tm.role = 'tenant_admin'
    )
  );

CREATE OR REPLACE FUNCTION public.tg_app_vault_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS app_vault_touch ON public.app_vault_secrets;
CREATE TRIGGER app_vault_touch BEFORE UPDATE ON public.app_vault_secrets
  FOR EACH ROW EXECUTE FUNCTION public.tg_app_vault_touch();

DROP TRIGGER IF EXISTS app_vault_kms_touch ON public.app_vault_kms_bindings;
CREATE TRIGGER app_vault_kms_touch BEFORE UPDATE ON public.app_vault_kms_bindings
  FOR EACH ROW EXECUTE FUNCTION public.tg_app_vault_touch();
