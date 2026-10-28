-- Restore anon SELECT on platform_auth_providers so the public login page can list enabled providers.
-- The row content (provider name, enabled flag, label) is inherently public UI metadata.
GRANT SELECT ON public.platform_auth_providers TO anon;
DROP POLICY IF EXISTS auth_providers_read_auth ON public.platform_auth_providers;
DROP POLICY IF EXISTS auth_providers_read_all ON public.platform_auth_providers;
CREATE POLICY auth_providers_read_all ON public.platform_auth_providers
  FOR SELECT TO anon, authenticated USING (true);

-- Ensure the full industry-standard enterprise identity catalog is present.
INSERT INTO public.platform_auth_providers (provider, enabled, label, description) VALUES
  ('email',           true,  'Email + Password',           'Password sign-in with HIBP leak check.'),
  ('google',          true,  'Google Workspace',           'Google / Workspace OIDC sign-in.'),
  ('apple',           false, 'Apple',                      'Sign in with Apple.'),
  ('microsoft',       false, 'Microsoft / Entra ID',       'Exposed via SAML federation metadata until first-class OIDC lands.'),
  ('saml',            true,  'SAML 2.0 SSO',               'Okta, Ping, ADFS, OneLogin, Entra ID — per-tenant.'),
  ('oidc',            false, 'OIDC (generic)',             'Auth0, Keycloak, Ping OIDC, Google Workspace OIDC.'),
  ('scim',            false, 'SCIM 2.0 Provisioning',      'Auto-provision/de-provision users (SOX / ISO 27001).'),
  ('webauthn',        false, 'Passkeys / WebAuthn (FIDO2)','Phishing-resistant MFA — PSD2 / NIST 800-63B AAL3.'),
  ('totp',            true,  'TOTP MFA',                   'Authenticator-app time-based one-time passwords.'),
  ('mtls',            false, 'mTLS / Device Certificates', 'Per-tenant device posture + IP allow-listing.'),
  ('magic_link',      false, 'Magic Link',                 'Passwordless email sign-in link.')
ON CONFLICT (provider) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;
