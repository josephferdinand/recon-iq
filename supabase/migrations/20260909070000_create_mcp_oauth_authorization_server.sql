-- OAuth 2.1 authorization-code/PKCE state for the FVI MCP gateway.
-- These tables are service-only. Browser users interact through authenticated
-- application routes; no OAuth code or refresh token is readable through RLS.

CREATE TABLE public.mcp_oauth_clients (
  client_id text PRIMARY KEY,
  client_name text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 120),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  allowed_scopes text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.mcp_oauth_authorization_codes (
  code_hash text PRIMARY KEY CHECK (char_length(code_hash) = 64),
  client_id text NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL,
  code_challenge text NOT NULL CHECK (char_length(code_challenge) BETWEEN 43 AND 128),
  resource text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_oauth_codes_expiry_idx
  ON public.mcp_oauth_authorization_codes(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE public.mcp_oauth_refresh_tokens (
  token_hash text PRIMARY KEY CHECK (char_length(token_hash) = 64),
  api_token_id uuid NOT NULL REFERENCES public.api_tokens(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scopes text[] NOT NULL,
  resource text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_oauth_refresh_expiry_idx
  ON public.mcp_oauth_refresh_tokens(expires_at)
  WHERE revoked_at IS NULL;

GRANT ALL ON public.mcp_oauth_clients,
  public.mcp_oauth_authorization_codes,
  public.mcp_oauth_refresh_tokens TO service_role;

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mcp_oauth_clients,
  public.mcp_oauth_authorization_codes,
  public.mcp_oauth_refresh_tokens FROM anon, authenticated;

COMMENT ON TABLE public.mcp_oauth_clients IS 'Dynamically registered public OAuth clients for the FVI MCP gateway.';
COMMENT ON TABLE public.mcp_oauth_authorization_codes IS 'Single-use, five-minute OAuth authorization codes stored only as SHA-256 hashes.';
COMMENT ON TABLE public.mcp_oauth_refresh_tokens IS 'Rotating MCP OAuth refresh tokens stored only as SHA-256 hashes.';

CREATE OR REPLACE FUNCTION public.exchange_mcp_oauth_code(
  _code_hash text, _client_id text, _redirect_uri text, _code_challenge text,
  _access_hash text, _access_prefix text, _refresh_hash text,
  _access_expires_at timestamptz, _refresh_expires_at timestamptz
)
RETURNS TABLE(access_token_id uuid, tenant_id uuid, user_id uuid, scopes text[], resource text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_oauth_authorization_codes%ROWTYPE; new_api_id uuid;
BEGIN
  SELECT * INTO c FROM public.mcp_oauth_authorization_codes WHERE code_hash = _code_hash FOR UPDATE;
  IF NOT FOUND OR c.client_id <> _client_id OR c.redirect_uri <> _redirect_uri
     OR c.code_challenge <> _code_challenge OR c.consumed_at IS NOT NULL OR c.expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_grant' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = c.tenant_id AND tm.user_id = c.user_id AND tm.active = true) THEN
    RAISE EXCEPTION 'invalid_grant' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.api_tokens(tenant_id,name,prefix,token_hash,scopes,expires_at,created_by)
  VALUES (c.tenant_id,'MCP OAuth '||left(c.client_id,24),_access_prefix,_access_hash,c.scopes,_access_expires_at,c.user_id)
  RETURNING id INTO new_api_id;
  INSERT INTO public.mcp_oauth_refresh_tokens(token_hash,api_token_id,client_id,tenant_id,user_id,scopes,resource,expires_at)
  VALUES (_refresh_hash,new_api_id,c.client_id,c.tenant_id,c.user_id,c.scopes,c.resource,_refresh_expires_at);
  UPDATE public.mcp_oauth_authorization_codes SET consumed_at = now() WHERE code_hash = c.code_hash;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (c.user_id,c.tenant_id,'tenant','mcp.oauth.token.issue','api_tokens',new_api_id,
    jsonb_build_object('client_id',c.client_id,'scopes',c.scopes));
  RETURN QUERY SELECT new_api_id,c.tenant_id,c.user_id,c.scopes,c.resource;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_mcp_oauth_refresh_token(
  _refresh_hash text, _client_id text, _new_access_hash text, _new_access_prefix text,
  _new_refresh_hash text, _access_expires_at timestamptz, _refresh_expires_at timestamptz
)
RETURNS TABLE(access_token_id uuid, tenant_id uuid, user_id uuid, scopes text[], resource text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.mcp_oauth_refresh_tokens%ROWTYPE; new_api_id uuid;
BEGIN
  SELECT * INTO r FROM public.mcp_oauth_refresh_tokens WHERE token_hash = _refresh_hash FOR UPDATE;
  IF NOT FOUND OR r.client_id <> _client_id OR r.revoked_at IS NOT NULL
     OR r.rotated_at IS NOT NULL OR r.expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_grant' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = r.tenant_id AND tm.user_id = r.user_id AND tm.active = true) THEN
    RAISE EXCEPTION 'invalid_grant' USING ERRCODE = '22023';
  END IF;
  UPDATE public.mcp_oauth_refresh_tokens SET rotated_at = now() WHERE token_hash = r.token_hash;
  UPDATE public.api_tokens SET revoked_at = now() WHERE id = r.api_token_id;
  INSERT INTO public.api_tokens(tenant_id,name,prefix,token_hash,scopes,expires_at,created_by)
  VALUES (r.tenant_id,'MCP OAuth '||left(r.client_id,24),_new_access_prefix,_new_access_hash,r.scopes,_access_expires_at,r.user_id)
  RETURNING id INTO new_api_id;
  INSERT INTO public.mcp_oauth_refresh_tokens(token_hash,api_token_id,client_id,tenant_id,user_id,scopes,resource,expires_at)
  VALUES (_new_refresh_hash,new_api_id,r.client_id,r.tenant_id,r.user_id,r.scopes,r.resource,_refresh_expires_at);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (r.user_id,r.tenant_id,'tenant','mcp.oauth.token.refresh','api_tokens',new_api_id,
    jsonb_build_object('client_id',r.client_id,'scopes',r.scopes,'prior_token_id',r.api_token_id));
  RETURN QUERY SELECT new_api_id,r.tenant_id,r.user_id,r.scopes,r.resource;
END;
$$;

REVOKE ALL ON FUNCTION public.exchange_mcp_oauth_code(text,text,text,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_mcp_oauth_refresh_token(text,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_mcp_oauth_code(text,text,text,text,text,text,text,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_mcp_oauth_refresh_token(text,text,text,text,text,timestamptz,timestamptz) TO service_role;
