// LL-036 (Felix): dev/staging app subdomain → /auth routing.
//
// Task 5: when the user visits `https://dev.app.reconiq.example` (no path)
// or any marketing path, the request was serving the marketing site because
// the dev/staging Pages project had no application logic — it inherited
// marketing from the apex. Fix: at fetch time, if the Host header matches a
// dev/staging app subdomain, redirect marketing paths → /auth and let app
// paths continue to the SSR handler.

const DEV_APP_HOSTS = new Set([
  "dev.app.reconiq.example",
  "staging.app.reconiq.example",
]);

// Marketing paths on the apex/marketing domain. If any of these arrive at a
// dev/staging app subdomain, redirect to /auth.
const MARKETING_PATHS = new Set([
  "/",
  "/pricing",
  "/about",
  "/security",
  "/developers",
  "/support",
  "/solutions",
  "/contact",
  "/book-demo",
  "/enterprise-faq",
  "/due-diligence",
  "/roi",
  "/review/videos",
  "/retention",
  "/status",
  "/sitemap.xml",
]);

export type DevHostRewriteResult =
  | { kind: "passthrough" }
  | { kind: "redirect"; location: string };

export function evaluateDevHostRewrite(request: Request): DevHostRewriteResult {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  // Normalize: "/", no trailing slash
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  // The production app entry belongs to sign-in; the apex keeps marketing.
  if (host === "app.reconiq.example" && normalized === "/") {
    return { kind: "redirect", location: "/auth" };
  }
  if (!DEV_APP_HOSTS.has(host)) return { kind: "passthrough" };
  if (MARKETING_PATHS.has(normalized)) {
    return { kind: "redirect", location: "/auth" };
  }
  // Everything else (/auth, /console, /_authenticated/*, /api/*, /m/*, /t/*,
  // static assets, etc.) passes through to the SSR handler.
  return { kind: "passthrough" };
}

export function applyDevHostRewrite(request: Request): Response | null {
  const result = evaluateDevHostRewrite(request);
  if (result.kind === "passthrough") return null;
  return new Response(null, {
    status: 302,
    headers: {
      location: result.location,
      "cache-control": "no-store",
    },
  });
}
