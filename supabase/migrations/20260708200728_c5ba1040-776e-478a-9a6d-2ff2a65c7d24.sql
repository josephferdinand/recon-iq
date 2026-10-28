CREATE TABLE IF NOT EXISTS public.platform_auth_providers (
  provider text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  label text NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

GRANT SELECT ON public.platform_auth_providers TO anon, authenticated;
GRANT UPDATE ON public.platform_auth_providers TO authenticated;
GRANT ALL ON public.platform_auth_providers TO service_role;

ALTER TABLE public.platform_auth_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_providers_read_all"
  ON public.platform_auth_providers FOR SELECT
  USING (true);

CREATE POLICY "auth_providers_admin_write"
  ON public.platform_auth_providers FOR UPDATE
  TO authenticated
  USING (public.has_platform_role(auth.uid(), 'platform_admin'::public.platform_role))
  WITH CHECK (public.has_platform_role(auth.uid(), 'platform_admin'::public.platform_role));

CREATE OR REPLACE FUNCTION public.touch_platform_auth_providers()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_touch_platform_auth_providers ON public.platform_auth_providers;
CREATE TRIGGER trg_touch_platform_auth_providers
  BEFORE UPDATE ON public.platform_auth_providers
  FOR EACH ROW EXECUTE FUNCTION public.touch_platform_auth_providers();

INSERT INTO public.platform_auth_providers (provider, enabled, label, description) VALUES
  ('google',    false, 'Google sign-in',    'When disabled, the "Continue with Google" button on the sign-in page is greyed out and cannot be used. Password and magic-link flows are unaffected.'),
  ('apple',     false, 'Apple sign-in',     'When disabled, the "Continue with Apple" button on the sign-in page is greyed out and cannot be used. Password and magic-link flows are unaffected.'),
  ('microsoft', false, 'Microsoft sign-in', 'When disabled, the "Continue with Microsoft" (Entra ID / Azure AD) button on the sign-in page is greyed out and cannot be used. Password and magic-link flows are unaffected.')
ON CONFLICT (provider) DO NOTHING;

CREATE OR REPLACE FUNCTION public.audit_platform_auth_provider_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.enabled IS DISTINCT FROM NEW.enabled THEN
    BEGIN
      INSERT INTO public.audit_log (actor_id, action, resource_type, resource_id, metadata)
      VALUES (
        auth.uid(),
        CASE WHEN NEW.enabled THEN 'auth_provider.enabled' ELSE 'auth_provider.disabled' END,
        'platform_auth_provider',
        NEW.provider,
        jsonb_build_object('provider', NEW.provider, 'label', NEW.label)
      );
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_platform_auth_provider ON public.platform_auth_providers;
CREATE TRIGGER trg_audit_platform_auth_provider
  AFTER UPDATE ON public.platform_auth_providers
  FOR EACH ROW EXECUTE FUNCTION public.audit_platform_auth_provider_change();
