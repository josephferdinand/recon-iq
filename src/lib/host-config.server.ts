/**
 * Host-based routing configuration for the ReconIQ Pages project.
 *
 * The Pages project serves a single bundle containing BOTH the marketing
 * surface (/, /pricing, /about, ...) AND the app surface (/auth, /console,
 * /_authenticated/*). On dev/staging subdomains we want ONLY the app surface
 * — marketing routes should 302 to /auth so QA never sees a marketing hero
 * when they hit `dev.app.reconiq.example/`.
 *
 * Resolution happens at the fetch boundary (see src/server.ts) before any
 * TanStack Start middleware runs, so it's the cheapest and most predictable
 * place to gate this.
 *
 * Per LL-027: dev/staging app subdomains redirect marketing paths to /auth
 * instead of rendering the marketing content. Production marketing and the
 * production app surface are unchanged.
 */

export type Surface = "app" | "marketing" | "platform" | "unknown";

export interface HostConfig {
  /** Lower-cased host header (no port). */
  host: string;
  /** Which surface the request should land on. */
  surface: Surface;
  /**
   * When non-null, marketing paths on this host are gated — see
   * `isMarketingPath` and `marketingRedirectFor`. Null disables the gate
   * (production marketing apex, app surface, etc.).
   */
  marketingGate: MarketingGate | null;
}

/**
 * The gate policy for subdomains that should behave as app-only.
 * When set, any marketing path on this host 302s to the gate's target
 * (defaults to /auth).
 */
export interface MarketingGate {
  /** Where marketing paths redirect. Default: "/auth". */
  redirectTo: string;
  /** Why this gate is active — for logs/debug headers. */
  reason: string;
}

/**
 * Single source of truth for marketing-route paths. Anything listed here
 * is considered "not the app" and gets gated on app-only subdomains.
 *
 * Keep this list aligned with src/routes/* (marketing files). It does NOT
 * need to be exhaustive — anything not in this list that is also not a
 * known app path still goes through the SSR handler.
 */
export const MARKETING_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/about",
  "/pricing",
  "/security",
  "/developers",
  "/support",
  "/solutions",
  "/solutions/index", // both shapes — TanStack treats them as separate
  "/contact",
  "/book-demo",
  "/enterprise-faq",
  "/roi",
  "/due-diligence",
  "/retention",
  "/status",
  "/review/videos",
]);

/**
 * Paths TanStack Start treats as app-only. If a request lands on an
 * app-only subdomain and is one of these (or starts with one of these
 * prefixes), it passes through to the SSR handler.
 */
export const APP_PATH_PREFIXES: readonly string[] = [
  "/auth",
  "/console",
  "/_authenticated",
  "/_serverFn",
  "/_server",
  "/api",
  "/reset-password",
  "/t", // tenant-scoped landing pages
  "/m", // mobile routes
  "/mkt-admin", // internal marketing admin (still app-only)
  "/developers/api-reference",
  "/developers/changelog",
  "/developers/guides",
  "/developers/index",
];

/**
 * Subdomains that should behave as app-only. Add new entries here when
 * spinning up a new QA / preview surface that shouldn't see marketing.
 *
 * The string is matched EXACTLY against the lower-cased Host header
 * (port stripped). Wildcards are not supported — keep the list explicit.
 */
export const APP_ONLY_SUBDOMAINS: ReadonlySet<string> = new Set([
  "dev.app.reconiq.example",
  "staging.app.reconiq.example",
  // Future QA surfaces go here. e.g. "qa.app.reconiq.example"
]);

/**
 * Apex marketing host. Listed explicitly so we never gate marketing pages
 * on the marketing domain itself.
 */
export const MARKETING_HOSTS: ReadonlySet<string> = new Set([
  "reconiq.example",
  "www.reconiq.example",
]);

/**
 * The production app apex. Serves the app surface; marketing paths in the
 * bundle are unreachable because no link points at them, but we leave the
 * gate OFF so deep-links from old emails still resolve.
 */
export const APP_APEX_HOSTS: ReadonlySet<string> = new Set([
  "app.reconiq.example",
]);

/**
 * Decide which surface a Host header should land on and whether the
 * marketing-path gate applies.
 *
 * @param rawHost - The Host header value, may include a port.
 */
export function classifyHost(rawHost: string): HostConfig {
  const host = (rawHost || "").toLowerCase().split(":")[0];
  if (!host) {
    return { host: "", surface: "unknown", marketingGate: null };
  }

  // App-only subdomains — marketing paths gated to /auth.
  if (APP_ONLY_SUBDOMAINS.has(host)) {
    return {
      host,
      surface: "app",
      marketingGate: {
        redirectTo: "/auth",
        reason: `app-only subdomain: ${host}`,
      },
    };
  }

  // Production app apex — gate stays off (deep-link tolerant).
  if (APP_APEX_HOSTS.has(host)) {
    return { host, surface: "app", marketingGate: null };
  }

  // Apex marketing host — never gate.
  if (MARKETING_HOSTS.has(host)) {
    return { host, surface: "marketing", marketingGate: null };
  }

  // Tenant subdomains (jpmc.reconiq.example, jpmc-dev.reconiq.example,
  // …) — treat as app surface, no marketing gate (their tenant landing is
  // served from /t/$slug and isn't in MARKETING_PATHS anyway).
  if (host.endsWith(".reconiq.example")) {
    return { host, surface: "platform", marketingGate: null };
  }

  // localhost / preview / unknown — leave the gate off; let SSR decide.
  return { host, surface: "unknown", marketingGate: null };
}

/** True if the given pathname is one of the marketing routes. */
export function isMarketingPath(pathname: string): boolean {
  if (!pathname) return false;
  // Exact match first.
  if (MARKETING_PATHS.has(pathname)) return true;
  // Dynamic marketing paths: /solutions/$slug, /support/$category/$article,
  // /support/$category, /t/$slug (tenant landing is treated as app).
  if (pathname.startsWith("/solutions/")) return true;
  if (pathname.startsWith("/support/")) return true;
  // /developers subroutes are app-ish (docs surface), so leave them out.
  return false;
}

/** True if the pathname is clearly an app route that should bypass any gate. */
export function isAppPath(pathname: string): boolean {
  if (!pathname) return false;
  for (const prefix of APP_PATH_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/**
 * Build the absolute redirect URL for a marketing-path hit. Uses the
 * SAME host (so we don't bounce between Cloudflare projects) and the
 * `redirectTo` from the gate.
 */
export function marketingRedirectFor(
  request: Request,
  gate: MarketingGate,
): string {
  const url = new URL(request.url);
  // Force https:// same host + gate target. Keep query string intact.
  const target = new URL(gate.redirectTo, url);
  target.protocol = "https:";
  // Preserve the search/hash from the original request.
  if (url.search) target.search = url.search;
  return target.toString();
}