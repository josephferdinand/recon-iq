-- Durable replay protection for synchronous public API mutations.
CREATE TABLE IF NOT EXISTS public.public_api_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES public.api_tokens(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 120),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'processing' CHECK (state IN ('processing', 'completed')),
  response_status integer CHECK (response_status BETWEEN 200 AND 599),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (tenant_id, token_id, operation, idempotency_key)
);

ALTER TABLE public.public_api_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_api_idempotency FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_public_api_idempotency(
  _tenant_id uuid,
  _token_id uuid,
  _operation text,
  _idempotency_key text,
  _request_hash text
) RETURNS TABLE (
  claim_state text,
  stored_status integer,
  stored_body jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.public_api_idempotency%ROWTYPE;
BEGIN
  IF length(_operation) NOT BETWEEN 1 AND 120
    OR length(_idempotency_key) NOT BETWEEN 1 AND 128
    OR _request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid idempotency claim';
  END IF;

  INSERT INTO public.public_api_idempotency (
    tenant_id, token_id, operation, idempotency_key, request_hash
  ) VALUES (
    _tenant_id, _token_id, _operation, _idempotency_key, _request_hash
  )
  ON CONFLICT (tenant_id, token_id, operation, idempotency_key) DO NOTHING;

  IF FOUND THEN
    RETURN QUERY SELECT 'claimed'::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO existing
  FROM public.public_api_idempotency
  WHERE tenant_id = _tenant_id
    AND token_id = _token_id
    AND operation = _operation
    AND idempotency_key = _idempotency_key
  FOR UPDATE;

  IF existing.request_hash <> _request_hash THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::integer, NULL::jsonb;
  ELSIF existing.state = 'completed' THEN
    RETURN QUERY SELECT 'replay'::text, existing.response_status, existing.response_body;
  ELSIF existing.updated_at < now() - interval '5 minutes' THEN
    UPDATE public.public_api_idempotency
    SET request_hash = _request_hash,
        updated_at = now(),
        expires_at = now() + interval '24 hours'
    WHERE id = existing.id;
    RETURN QUERY SELECT 'claimed'::text, NULL::integer, NULL::jsonb;
  ELSE
    RETURN QUERY SELECT 'in_progress'::text, NULL::integer, NULL::jsonb;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_public_api_idempotency(
  _tenant_id uuid,
  _token_id uuid,
  _operation text,
  _idempotency_key text,
  _request_hash text,
  _response_status integer,
  _response_body jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.public_api_idempotency
  SET state = 'completed',
      response_status = _response_status,
      response_body = _response_body,
      updated_at = now()
  WHERE tenant_id = _tenant_id
    AND token_id = _token_id
    AND operation = _operation
    AND idempotency_key = _idempotency_key
    AND request_hash = _request_hash
    AND state = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Idempotency claim not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_public_api_idempotency(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_public_api_idempotency(uuid, uuid, text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_public_api_idempotency(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_public_api_idempotency(uuid, uuid, text, text, text, integer, jsonb) TO service_role;
