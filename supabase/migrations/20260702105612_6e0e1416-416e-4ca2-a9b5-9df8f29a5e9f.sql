
CREATE TABLE public.app_vault_secret_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_id uuid NOT NULL REFERENCES public.app_vault_secrets(id) ON DELETE CASCADE,
  version integer NOT NULL,
  scope text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  secret_class app_vault_secret_class NOT NULL,
  name text NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  wrapped_dek bytea NOT NULL,
  kek_provider app_vault_kek_provider NOT NULL,
  kek_ref text NOT NULL,
  fingerprint_sha256 text NOT NULL,
  last4 text,
  reason text,
  change_kind text NOT NULL CHECK (change_kind IN ('create','rotate','rollback')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (secret_id, version)
);

CREATE INDEX app_vault_secret_versions_secret_idx
  ON public.app_vault_secret_versions (secret_id, version DESC);

GRANT SELECT, INSERT ON public.app_vault_secret_versions TO authenticated;
GRANT ALL ON public.app_vault_secret_versions TO service_role;

ALTER TABLE public.app_vault_secret_versions ENABLE ROW LEVEL SECURITY;

-- Read: same principals allowed to read the parent secret (mirrors rotation_log).
CREATE POLICY "app_vault_ver_read" ON public.app_vault_secret_versions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.app_vault_secrets s
    WHERE s.id = app_vault_secret_versions.secret_id
      AND (
        (s.scope = 'platform' AND private.is_platform_admin(auth.uid()))
        OR (s.scope = 'tenant' AND EXISTS (
          SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = s.tenant_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'tenant_admin'::tenant_role
        ))
      )
  )
);

CREATE POLICY "app_vault_ver_insert" ON public.app_vault_secret_versions
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.app_vault_secrets s
    WHERE s.id = app_vault_secret_versions.secret_id
      AND (
        (s.scope = 'platform' AND private.is_platform_admin(auth.uid()))
        OR (s.scope = 'tenant' AND EXISTS (
          SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = s.tenant_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'tenant_admin'::tenant_role
        ))
      )
  )
);

-- WORM: block updates and deletes at the trigger level (defence in depth beyond RLS).
CREATE OR REPLACE FUNCTION public.app_vault_secret_versions_worm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'app_vault_secret_versions is append-only (WORM). % denied.', TG_OP;
END;
$$;

CREATE TRIGGER app_vault_secret_versions_no_update
BEFORE UPDATE ON public.app_vault_secret_versions
FOR EACH ROW EXECUTE FUNCTION public.app_vault_secret_versions_worm();

-- DELETE is only allowed via cascade from app_vault_secrets (statement-level would
-- block cascade). We rely on the missing DELETE privilege from the GRANT above to
-- prevent direct row deletion; cascade still works because it runs as table owner.

COMMENT ON TABLE public.app_vault_secret_versions IS
  'Append-only history of encrypted DEK envelopes per secret. Enables rollback to a prior DEK without ever exposing plaintext.';
