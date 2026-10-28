/**
 * Pure landing-tenant resolution logic.
 * Extracted so it can be unit-tested without server middleware.
 *
 * Routing priority:
 *   1. preferred_slug (e.g. ?tenant=jpmc) if user is a member
 *   2. profile default_tenant_id if user is still a member
 *   3. exactly one membership → straight to that workspace
 *   4. otherwise → /home picker
 */
export type LandingTenant = { id: string; slug: string; name: string };

export type LandingResult =
  | { path: "/home"; reason: "no_memberships" }
  | { path: "/home"; reason: "membership_lookup_failed" }
  | { path: "/home"; reason: "multi_tenant_picker"; tenantCount: number }
  | { path: string; reason: "preferred_slug"; tenant: LandingTenant }
  | { path: string; reason: "default_tenant"; tenant: LandingTenant }
  | { path: string; reason: "single_tenant"; tenant: LandingTenant };

export function computeLandingPath(args: {
  tenants: LandingTenant[];
  defaultTenantId?: string | null;
  preferredSlug?: string | null;
}): LandingResult {
  const { tenants, defaultTenantId, preferredSlug } = args;

  if (!tenants || tenants.length === 0) {
    return { path: "/home", reason: "no_memberships" };
  }

  const preferred = preferredSlug?.trim().toLowerCase();
  if (preferred) {
    const match = tenants.find((t) => t.slug?.toLowerCase() === preferred);
    if (match) {
      return { path: `/${match.slug}/workspace`, reason: "preferred_slug", tenant: match };
    }
  }

  if (defaultTenantId) {
    const match = tenants.find((t) => t.id === defaultTenantId);
    if (match) {
      return { path: `/${match.slug}/workspace`, reason: "default_tenant", tenant: match };
    }
  }

  if (tenants.length === 1) {
    const only = tenants[0];
    return { path: `/${only.slug}/workspace`, reason: "single_tenant", tenant: only };
  }

  return { path: "/home", reason: "multi_tenant_picker", tenantCount: tenants.length };
}
