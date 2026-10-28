CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.sandbox_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_secret_hash text NOT NULL,
  name text NOT NULL,
  description text,
  allowed_scopes text[] NOT NULL DEFAULT ARRAY['read']::text[],
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sandbox_oauth_clients_created_by_idx ON public.sandbox_oauth_clients(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sandbox_oauth_clients TO authenticated;
GRANT ALL ON public.sandbox_oauth_clients TO service_role;

ALTER TABLE public.sandbox_oauth_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sandbox_clients_owner_select"
  ON public.sandbox_oauth_clients FOR SELECT
  TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_platform_role(auth.uid(), 'platform_admin'::public.platform_role)
  );

CREATE POLICY "sandbox_clients_owner_insert"
  ON public.sandbox_oauth_clients FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "sandbox_clients_owner_update"
  ON public.sandbox_oauth_clients FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by OR public.has_platform_role(auth.uid(), 'platform_admin'::public.platform_role))
  WITH CHECK (auth.uid() = created_by OR public.has_platform_role(auth.uid(), 'platform_admin'::public.platform_role));

CREATE POLICY "sandbox_clients_owner_delete"
  ON public.sandbox_oauth_clients FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by OR public.has_platform_role(auth.uid(), 'platform_admin'::public.platform_role));

CREATE OR REPLACE FUNCTION public.update_sandbox_oauth_clients_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sandbox_oauth_clients_updated_at
  BEFORE UPDATE ON public.sandbox_oauth_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_sandbox_oauth_clients_updated_at();

CREATE OR REPLACE FUNCTION public.verify_sandbox_client_secret(_client_id text, _plain_secret text)
RETURNS TABLE(id uuid, created_by uuid, allowed_scopes text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.created_by, c.allowed_scopes
  FROM public.sandbox_oauth_clients c
  WHERE c.client_id = _client_id
    AND c.active = true
    AND c.revoked_at IS NULL
    AND c.client_secret_hash = crypt(_plain_secret, c.client_secret_hash);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_sandbox_client_secret(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_sandbox_client_secret(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.hash_sandbox_client_secret(_plain_secret text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN crypt(_plain_secret, gen_salt('bf', 10));
END;
$$;

REVOKE ALL ON FUNCTION public.hash_sandbox_client_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hash_sandbox_client_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hash_sandbox_client_secret(text) TO authenticated;