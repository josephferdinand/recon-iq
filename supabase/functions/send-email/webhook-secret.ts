/**
 * Supabase Auth stores hook secrets as a versioned value such as
 * `v1,whsec_<base64>`. standardwebhooks@1.0.0 understands `whsec_` but not
 * the outer `v1,` selector, so remove only that selector before verifying.
 */
export function normalizeWebhookSecret(secret: string): string {
  return secret.startsWith("v1,") ? secret.slice(3) : secret;
}
