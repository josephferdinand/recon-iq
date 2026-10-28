
-- 1) chat_ops_subscriptions: remove broad member SELECT
DROP POLICY IF EXISTS chat_ops_read_members ON public.chat_ops_subscriptions;

-- 2) tenant_iac_exports: restrict SELECT to admins
DROP POLICY IF EXISTS tie_read ON public.tenant_iac_exports;
CREATE POLICY tie_read_admins ON public.tenant_iac_exports
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()));

-- 3) webhook_outbox: restrict SELECT to admins
DROP POLICY IF EXISTS wob_read ON public.webhook_outbox;
CREATE POLICY wob_read_admins ON public.webhook_outbox
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()));

-- 4) tenants: drop unused plaintext domain_verify_token (no code reads it)
ALTER TABLE public.tenants DROP COLUMN IF EXISTS domain_verify_token;

-- 5) tenant_domain_verification: hash-only
ALTER TABLE public.tenant_domain_verification
  ADD COLUMN IF NOT EXISTS token_hash bytea;
-- Table is empty in this environment; drop plaintext column.
ALTER TABLE public.tenant_domain_verification ALTER COLUMN verification_token DROP NOT NULL;
ALTER TABLE public.tenant_domain_verification DROP COLUMN IF EXISTS verification_token;
ALTER TABLE public.tenant_domain_verification ALTER COLUMN token_hash SET NOT NULL;

-- Issue (rotate) a new verification token: returns plaintext to caller exactly once.
CREATE OR REPLACE FUNCTION public.tdv_issue_token(_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _plain text;
BEGIN
  IF NOT (public.has_tenant_role(auth.uid(), _tenant_id, 'tenant_admin')
       OR public.is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  _plain := 'fvi_dv_' || encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.tenant_domain_verification(tenant_id, token_hash, updated_at)
    VALUES (_tenant_id, sha256(convert_to(_plain,'UTF8')), now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET token_hash = EXCLUDED.token_hash, updated_at = now();
  RETURN _plain;
END $$;
REVOKE ALL ON FUNCTION public.tdv_issue_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tdv_issue_token(uuid) TO authenticated;

-- Validate a presented token against the stored hash.
CREATE OR REPLACE FUNCTION public.tdv_validate_token(_tenant_id uuid, _token text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_domain_verification
    WHERE tenant_id = _tenant_id
      AND token_hash = sha256(convert_to(_token,'UTF8'))
  )
$$;
REVOKE ALL ON FUNCTION public.tdv_validate_token(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tdv_validate_token(uuid, text) TO authenticated;

-- 6) status_subscribers: hash-only confirm + unsubscribe tokens
ALTER TABLE public.status_subscribers
  ADD COLUMN IF NOT EXISTS confirm_token_hash bytea,
  ADD COLUMN IF NOT EXISTS unsubscribe_token_hash bytea;
-- Table is empty; drop plaintext columns and require hash columns going forward.
ALTER TABLE public.status_subscribers DROP COLUMN IF EXISTS confirm_token;
ALTER TABLE public.status_subscribers DROP COLUMN IF EXISTS unsubscribe_token;
ALTER TABLE public.status_subscribers ALTER COLUMN confirm_token_hash SET NOT NULL;
ALTER TABLE public.status_subscribers ALTER COLUMN unsubscribe_token_hash SET NOT NULL;
CREATE INDEX IF NOT EXISTS status_subscribers_confirm_hash_idx
  ON public.status_subscribers(confirm_token_hash);
CREATE INDEX IF NOT EXISTS status_subscribers_unsub_hash_idx
  ON public.status_subscribers(unsubscribe_token_hash);

-- Subscribe: stores hashes only; caller supplies pre-generated plaintext tokens.
CREATE OR REPLACE FUNCTION public.status_subscribe(
  _email text, _component_keys text[], _confirm_token text, _unsub_token text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _email IS NULL OR length(_email) > 254
     OR _email !~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;
  IF _confirm_token IS NULL OR length(_confirm_token) < 32
     OR _unsub_token IS NULL OR length(_unsub_token) < 32 THEN
    RAISE EXCEPTION 'invalid token';
  END IF;
  INSERT INTO public.status_subscribers(
    email, component_keys, confirm_token_hash, unsubscribe_token_hash
  ) VALUES (
    lower(_email),
    COALESCE(_component_keys, '{}'::text[]),
    sha256(convert_to(_confirm_token,'UTF8')),
    sha256(convert_to(_unsub_token,'UTF8'))
  )
  ON CONFLICT (email) DO NOTHING;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.status_subscribe(text, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.status_subscribe(text, text[], text, text) TO anon, authenticated;

-- Replace token-validating RPCs (signatures change uuid -> text).
DROP FUNCTION IF EXISTS public.status_confirm_subscriber(uuid);
CREATE OR REPLACE FUNCTION public.status_confirm_subscriber(_token text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE updated int;
BEGIN
  UPDATE public.status_subscribers
     SET confirmed_at = now()
   WHERE confirm_token_hash = sha256(convert_to(_token,'UTF8'))
     AND confirmed_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;
REVOKE ALL ON FUNCTION public.status_confirm_subscriber(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.status_confirm_subscriber(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.status_unsubscribe(uuid);
CREATE OR REPLACE FUNCTION public.status_unsubscribe(_token text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE deleted int;
BEGIN
  DELETE FROM public.status_subscribers
   WHERE unsubscribe_token_hash = sha256(convert_to(_token,'UTF8'));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted > 0;
END $$;
REVOKE ALL ON FUNCTION public.status_unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.status_unsubscribe(text) TO anon, authenticated;

-- Tighten anon INSERT policy: with raw token columns gone, the policy must
-- allow only the safe initial shape and require hash columns be set.
DROP POLICY IF EXISTS subscribers_anyone_insert ON public.status_subscribers;
CREATE POLICY subscribers_anyone_insert ON public.status_subscribers
  FOR INSERT
  WITH CHECK (
    email IS NOT NULL
    AND length(email) <= 254
    AND email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
    AND confirmed_at IS NULL
    AND confirm_token_hash IS NOT NULL
    AND unsubscribe_token_hash IS NOT NULL
  );
