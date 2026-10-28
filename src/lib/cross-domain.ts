/**
 * Cross-domain URL helpers for CTAs that span marketing ↔ app surfaces.
 *
 * Marketing site (reconiq.example / www.reconiq.example) → CTAs point
 * to the absolute app URL so the user lands on the app surface cleanly.
 *
 * App surface (app.reconiq.example) → relative paths work, but we still
 * use the same helper to keep one source of truth and avoid drift.
 *
 * Resolution order (client-safe):
 *   1. import.meta.env.VITE_PUBLIC_APP_URL  (set by wrangler Pages vars)
 *   2. process.env.PUBLIC_APP_URL          (server-side fallback)
 *   3. Hard-coded production default
 *
 * Per LL-011: never paste Supabase / API secrets here. This helper only
 * carries public origin URLs.
 */

const DEFAULT_APP_URL = "https://reconintelligence.app";

function resolveAppOrigin(): string {
  // Vite injects only VITE_* at build time for the client bundle.
  const vite = (typeof import.meta !== "undefined" && (import.meta as any).env) || {};
  const fromVite = (vite.VITE_PUBLIC_APP_URL ?? vite.PUBLIC_APP_URL) as string | undefined;
  if (fromVite) return fromVite.replace(/\/+$/, "");
  // process.env.* is replaced at build by Vite for server context and is
  // available at runtime on Cloudflare Workers / Pages functions.
  const fromProcess = (typeof process !== "undefined" ? (process as any).env?.PUBLIC_APP_URL : undefined) as
    | string
    | undefined;
  if (fromProcess) return fromProcess.replace(/\/+$/, "");
  return DEFAULT_APP_URL;
}

const APP_ORIGIN = resolveAppOrigin();

/**
 * Returns an absolute URL pointing at the app surface.
 * Use for cross-domain CTAs (e.g. Sign in → app.reconiq.example/auth).
 */
export function appUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${APP_ORIGIN}${clean}`;
}

/** True when the current window is on the app surface. SSR-safe (returns false). */
export function isAppDomain(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "reconintelligence.app" || h === "app.reconiq.example" || h === "app.fvi.localhost" || h === "app.localhost";
}

/** True when on the marketing surface. SSR-safe (returns false). */
export function isMarketingDomain(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h === "reconiq.example" ||
    h === "www.reconiq.example" ||
    h === "staging.reconiq.example" ||
    h === "support.reconiq.example"
  );
}

export const APP_DOMAIN_ORIGIN = APP_ORIGIN;
