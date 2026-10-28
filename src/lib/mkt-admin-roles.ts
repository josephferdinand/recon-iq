/**
 * Marketing/Site admin role model — shared between server functions and
 * route beforeLoad guards so that every Site management tab enforces the
 * same tenant-level authorization check on the server.
 *
 * NOTE: This file contains only pure data (no server-only imports) so it
 * can be imported from route files and client code without pulling the
 * Supabase admin client into the browser bundle.
 */

export type MktRole =
  | "super_admin"
  | "sales_admin"
  | "marketing_admin"
  | "ai_admin"
  | "brand_reviewer"
  | "brand_publisher";

/** Human roles permitted to read marketing records containing personal data. */
export const MKT_PII_READ_ROLES = ["super_admin", "sales_admin", "marketing_admin"] as const satisfies readonly MktRole[];
/** Keep existing write authority limited to super_admin and sales_admin. */
export const MKT_PII_WRITE_ROLES = ["super_admin", "sales_admin"] as const satisfies readonly MktRole[];
/** AI admins may receive aggregate marketing metrics, never individual records. */
export const MKT_ANALYTICS_ROLES = ["super_admin", "sales_admin", "marketing_admin", "ai_admin"] as const satisfies readonly MktRole[];

export function hasMktPiiReadAccess(userRoles: readonly string[]): boolean {
  return MKT_PII_READ_ROLES.some((role) => userRoles.includes(role));
}

/** Tabs under the "Site management" nav group and who may access them. */
export const MKT_TAB_ROLES = {
  // /mkt-admin/homepage
  homepage: ["super_admin", "marketing_admin"] as MktRole[],
  // /mkt-admin/site-logos
  site_logos: ["super_admin", "marketing_admin"] as MktRole[],
  // /mkt-admin/chatbot
  chatbot: ["super_admin", "ai_admin"] as MktRole[],
  // /mkt-admin/ai-models
  ai_models: ["super_admin", "ai_admin"] as MktRole[],
  // /mkt-admin/appointments
  appointments: ["super_admin", "sales_admin"] as MktRole[],
  leads: MKT_PII_READ_ROLES,
  // /mkt-admin/themes
  themes: ["super_admin", "marketing_admin"] as MktRole[],
  // /mkt-admin/media
  media: ["super_admin", "marketing_admin"] as MktRole[],
  // /mkt-admin/vault
  vault: ["super_admin"] as MktRole[],
  // /mkt-admin/brand/* — platform-wide branding (super_admin only)
  brand: ["super_admin"] as MktRole[],
} as const;

export type MktTab = keyof typeof MKT_TAB_ROLES;

/** True iff the caller's roles intersect the allowed set. super_admin always passes. */
export function hasAnyMktRole(userRoles: readonly string[], allowed: readonly MktRole[]): boolean {
  if (userRoles.includes("super_admin")) return true;
  return allowed.some((r) => userRoles.includes(r));
}
