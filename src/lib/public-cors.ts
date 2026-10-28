/**
 * Canonical browser origins allowed to read public ReconIQ API responses.
 *
 * Machine-to-machine callers (OAuth, SCIM, webhooks) commonly omit Origin;
 * authentication and signatures remain authoritative for those requests.
 * Legacy hostnames remain temporarily accepted while external integrations
 * migrate to the current app/dev/docs domains.
 */
const PUBLIC_CORS_ORIGINS = new Set([
  "https://app.reconiq.example",
  "https://dev.app.reconiq.example",
  "https://docs.reconiq.example",
  "https://reconiq.example",
  "https://www.reconiq.example",
  "https://staging.reconiq.example",
  "https://support.reconiq.example",
  "https://app-fvi.reconiq.example",
  "https://staging-fvi.reconiq.example",
  "https://support-fvi.reconiq.example",
]);

export function getPublicCorsOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  return PUBLIC_CORS_ORIGINS.has(requestOrigin) ? requestOrigin : null;
}
