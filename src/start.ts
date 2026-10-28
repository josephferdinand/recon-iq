import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { createErrorReference, safeErrorPayload } from "./lib/user-facing-errors";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { parseHost } from "@/lib/tenant-host.functions";
import {
  buildSecurityHeaders,
  generateNonce,
  injectScriptNonce,
} from "@/lib/security/csp";

// D1: Security headers for every server response (HTML + API).
// P-M-01 (closed): nonce-based CSP for scripts. Each HTML response gets a
//   fresh nonce; SSR script tags are rewritten to carry it, and script-src
//   drops 'unsafe-inline' in favour of 'nonce-...' 'strict-dynamic'. style-src
//   still needs 'unsafe-inline' for Radix / Tailwind arbitrary-value / Motion
//   inline styles — accepted residual (RESIDUAL_RISK_REGISTER.md #CSP-STYLE).
// P-L-01 closed: Permissions-Policy widened to match public/_headers.
// P-L-02 closed: server-function responses get Cache-Control: private,no-store.

const securityHeadersMiddleware = createMiddleware().server(async ({ next, request }) => {
  const nonce = generateNonce();
  const result = await next();
  if (!(result instanceof Response)) return result;
  let response: Response = result;

  const url = new URL(request.url);
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html");

  // Rewrite SSR HTML to inject nonce on every <script>. Only HTML — never
  // touch API/server-fn/JSON payloads.
  if (isHtml && response.body) {
    const html = await response.text();
    const rewritten = injectScriptNonce(html, nonce);
    response = new Response(rewritten, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const headers = buildSecurityHeaders(isHtml ? nonce : undefined);
  for (const [k, v] of Object.entries(headers)) {
    if (!response.headers.has(k)) response.headers.set(k, v);
  }

  // P-L-02: server-function responses must never be cached by intermediaries
  // (they carry user-scoped data). Detect the TSS server-fn transport path.
  const isServerFn =
    url.pathname.startsWith("/_serverFn/") ||
    url.pathname.startsWith("/_server/") ||
    url.searchParams.has("_serverFnId");
  if (isServerFn && !response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
  }

  // LL-053 (Felix): HTML pages must never be cached between deploys. The
  // cyclic-TDZ bug (LL-016/LL-038) produced HTTP-200 "didn't load" responses
  // during bad builds; browsers then cached that broken HTML and replayed it
  // after the next deploy — even though the upstream was now healthy.
  // Forcing `no-cache, no-store, must-revalidate` on every HTML response means
  // the browser always revalidates with Cloudflare on navigation, and CF
  // revalidates against the Worker. Assets (JS/CSS/images) are still served
  // with their own hashed-URL cache headers by the asset handler.
  if (isHtml && !response.headers.has("Cache-Control")) {
    response.headers.set(
      "Cache-Control",
      "no-cache, no-store, must-revalidate",
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }

  if (isHtml) response.headers.set("X-FVI-CSP-Nonce-Applied", "1");

  return response;
});

// LL-036 (Felix): errorMiddleware was swallowing non-HTTPError exceptions and
// returning a sanitized HTML 500 page WITHOUT propagating the error to either
// (a) h3's global error handler (`error-handler.ts`) which sets
//     `__NITRO_LAST_ERROR__`, or (b) `console.error` at the request lifecycle,
//     which Cloudflare actually surfaces in Workers tail logs.
//
// Symptom: every request returned HTTP 500 with body
// `{"status":500,"unhandled":true,"message":"HTTPError"}` from h3's default
// handler, and the `x-ssr-error` diagnostic header always showed
// `source=none, message=no-capture` — because the real cause never escaped
// the middleware chain.
//
// Fix: capture the error on `globalThis.__NITRO_LAST_ERROR__` (same shape as
// `src/lib/error-handler.ts`) and RETURN a Response (not rethrow) so the
// surrounding `src/server.ts` outer/inner try/catch can read it. Returning a
// Response also ensures h3's `toResponse` sees a Response and passes it through
// without further wrapping. Also log via `console.error` (stderr) so Workers
// tail picks it up.
const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    const e = error as {
      name?: string;
      message?: string;
      stack?: string;
      cause?: unknown;
      statusCode?: number;
    };
    // Propagate to globalThis so server.ts.normalizeCatastrophicSsrResponse
    // can recover the original cause from the 500 Response body.
    try {
      const g = globalThis as unknown as Record<string, unknown>;
      g.__NITRO_LAST_ERROR__ = {
        source: "middleware",
        name: e?.name,
        message: e?.message,
        stack: e?.stack,
        cause: e?.cause,
        statusCode: e?.statusCode,
        path: new URL(request.url).pathname,
        method: (request as { method?: string })?.method,
        at: Date.now(),
      };
    } catch {
      // ignore
    }
    const referenceId = createErrorReference();
    // stderr log so CF tail picks it up; no exception data is returned.
    console.error("[SSR_FATAL][middleware]", {
      referenceId,
      name: e?.name,
      code: (e as { code?: string })?.code,
      statusCode: e?.statusCode,
      path: new URL(request.url).pathname,
      method: (request as { method?: string })?.method,
    });
    // RETURN a Response (not rethrow) so h3's `toResponse` sees a Response
    // and passes it through without exposing the exception.
    return new Response(JSON.stringify(safeErrorPayload(referenceId)), {
      status: 500,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-fvi-error-reference": referenceId,
      },
    });
  }
});

/**
 * Host-context middleware: parses the incoming Host header and exposes the
 * resolved tenant slug / environment as response headers. Edges / proxies use
 * these to route requests, and they're invaluable in browser devtools when
 * debugging custom-domain or subdomain routing.
 */
const hostContextMiddleware = createMiddleware().server(async ({ next, request }) => {
  const host = request.headers.get("host") ?? "";
  const parsed = parseHost(host);
  const response = await next();
  if (response instanceof Response) {
    response.headers.set("X-FVI-Host-Kind", parsed.kind);
    if (parsed.slug) response.headers.set("X-FVI-Tenant-Slug", parsed.slug);
    if (parsed.env)  response.headers.set("X-FVI-Tenant-Env", String(parsed.env));
  }
  return response;
});

const RATE_LIMIT_TRANSPORT_MARKER = "X-FVI-Rate-Limit-Error";
const MAX_RETRY_AFTER_SECONDS = 86_400;

function serverFnResponse(result: unknown) {
  if (result instanceof Response) return result;
  if (!result || typeof result !== "object" || !("response" in result)) return null;
  const response = (result as { response?: unknown }).response;
  return response instanceof Response ? response : null;
}

function quotaRetryAfter(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return null;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds));
}

export const quotaResponseMiddleware = createMiddleware().server(
  async ({ next, handlerType }) => {
    const result = await next();
    if (handlerType !== "serverFn") return result;

    const response = serverFnResponse(result);
    if (
      !response ||
      response.status !== 429 ||
      response.headers.get("x-tss-serialized") !== "true" ||
      response.headers.has("Retry-After")
    ) {
      return result;
    }

    const { getResponseHeader } = await import("@tanstack/react-start/server");
    if (getResponseHeader(RATE_LIMIT_TRANSPORT_MARKER) !== "1") return result;
    const retryAfter = quotaRetryAfter(getResponseHeader("Retry-After"));
    if (retryAfter === null) return result;

    const headers = new Headers(response.headers);
    headers.set("Retry-After", String(retryAfter));
    const bridgedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    return result instanceof Response
      ? bridgedResponse
      : { ...result, response: bridgedResponse };
  },
);

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth()],
  requestMiddleware: [
    errorMiddleware,
    securityHeadersMiddleware,
    hostContextMiddleware,
    quotaResponseMiddleware,
  ],
}));
