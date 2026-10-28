
-- 1) kb_article_steps: only readable when parent article is published, or caller is admin
DROP POLICY IF EXISTS "kb_steps read" ON public.kb_article_steps;
CREATE POLICY "kb_steps read" ON public.kb_article_steps
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.kb_articles a
      WHERE a.id = kb_article_steps.article_id
        AND (
          a.status = 'published'
          OR private.is_platform_admin(auth.uid())
          OR (a.tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), a.tenant_id, 'tenant_admin'))
        )
    )
  );

-- 2) tenant_environments: drop the anon "true" policy. Public host resolution
-- continues to work via the SECURITY DEFINER resolve_tenant_from_host RPC.
DROP POLICY IF EXISTS "tenant_envs public host lookup" ON public.tenant_environments;
REVOKE SELECT ON public.tenant_environments FROM anon;

-- 3) status_subscribers: drop the anon INSERT policy. All subscriptions go
-- through the SECURITY DEFINER public.status_subscribe RPC, which now enforces
-- per-email and per-IP-less rate limiting via rate_limit_buckets.
DROP POLICY IF EXISTS subscribers_anyone_insert ON public.status_subscribers;
REVOKE INSERT ON public.status_subscribers FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.status_subscribe(
  _email text, _component_keys text[], _confirm_token text, _unsub_token text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _bucket_key text;
  _window timestamptz := date_trunc('hour', now());
  _cur int;
BEGIN
  IF _email IS NULL OR length(_email) > 254
     OR _email !~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;
  IF _confirm_token IS NULL OR length(_confirm_token) < 32
     OR _unsub_token IS NULL OR length(_unsub_token) < 32 THEN
    RAISE EXCEPTION 'invalid token';
  END IF;

  -- Rate-limit: max 3 subscription attempts per email per hour.
  _bucket_key := 'status_subscribe:' || lower(_email);
  INSERT INTO public.rate_limit_buckets(bucket_key, window_start, count)
  VALUES (_bucket_key, _window, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = public.rate_limit_buckets.count + 1
  RETURNING count INTO _cur;
  IF _cur > 3 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '42901';
  END IF;

  INSERT INTO public.status_subscribers(
    email, component_keys, confirm_token_hash, unsubscribe_token_hash
  ) VALUES (
    lower(_email),
    COALESCE(_component_keys, '{}'::text[]),
    extensions.digest(convert_to(_confirm_token,'UTF8'),'sha256'),
    extensions.digest(convert_to(_unsub_token,'UTF8'),'sha256')
  )
  ON CONFLICT (email) DO NOTHING;
  RETURN FOUND;
END $$;

-- Ensure unique window per bucket (no-op if already present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='rate_limit_buckets_key_window_uidx'
  ) THEN
    CREATE UNIQUE INDEX rate_limit_buckets_key_window_uidx
      ON public.rate_limit_buckets(bucket_key, window_start);
  END IF;
END $$;

-- 4) Fix mutable search_path on the 3 remaining functions
CREATE OR REPLACE FUNCTION public.tenant_custom_domains_touch()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.trg_tenant_groups_touch()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.tenants_check_reserved_slug()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reserved_slugs WHERE slug = lower(NEW.slug)) THEN
    RAISE EXCEPTION 'Slug "%" is reserved and cannot be used as a tenant slug', NEW.slug
      USING ERRCODE = '23514';
  END IF;
  IF lower(NEW.slug) !~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Invalid slug: must be 2-63 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen'
      USING ERRCODE = '23514';
  END IF;
  IF lower(NEW.slug) LIKE '%-dev' OR lower(NEW.slug) LIKE '%-sandbox'
     OR lower(NEW.slug) LIKE '%-uat' OR lower(NEW.slug) LIKE '%-staging' THEN
    RAISE EXCEPTION 'Slug cannot end with environment suffix (-dev/-sandbox/-uat/-staging)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 5) profiles co-member email read: the policy set is already self-only +
-- platform-admin + explicit deny-anon. Add a documentation comment so future
-- audits can confirm no co-member SELECT exists.
COMMENT ON TABLE public.profiles IS
  'PII (email/phone). SELECT restricted to row owner and platform admins. '
  'No co-member exposure: tenant_members joins MUST NOT project profiles.email.';
