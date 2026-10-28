// LL-061 (Pri1): re-export shim.
//
// Background: per LL-039, the handler bodies for `tenants.functions.ts` were
// originally split out into this file so the `createServerFn(...)` registration
// file wouldn't transitively import into the route tree. That worked at
// runtime but **broke the TanStack Start manifest scanner**: the compiler
// only recognizes `export const x = createServerFn(...).handler(...)` at
// module top-level, and 9 of the 10 server-fns (`createFamily`,
// `createTenant`, `listAllTenants`, `listFamilies`, `listMyTenants`,
// `listRecentAudit`, `listSeedablePlatformPrincipals`, `setTenantAi`,
// `getTenantBySlug`) were never registered — they only existed as lazy
// function wrappers `function x(...args) { return createServerFn(...).handler(handler)(...args) }`
// which the static scanner ignored. Result: "Server function info not found
// for createFamily" at request time.
//
// Fix (LL-061): collapse the handler bodies back into `tenants.functions.ts`
// as inline `export const x = createServerFn(...).handler(handler)` declarations.
// This file is kept as a re-export shim for any consumer that imports the
// handler functions directly (none in src today, but keep the surface stable
// so we don't break imports from elsewhere).

export {
  listMyTenantsHandler,
  getMyAccessHandler,
  listAllTenantsHandler,
  listFamiliesHandler,
  createFamilyHandler,
  createTenantHandler,
  listSeedablePlatformPrincipalsHandler,
  setTenantAiHandler,
  getTenantBySlugHandler,
  listRecentAuditHandler,
} from "./tenants.functions";