import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { createErrorReference, safeErrorPayload } from "./lib/user-facing-errors";
import { toCrossJSONAsync } from "seroval";
import { applyDevHostRewrite } from "./lib/dev-host-rewrite";
import { installRuntimeEnv } from "./lib/runtime-env.server";
import {
  buildSecurityHeaders,
  generateNonce,
  injectCspNonceMetadata,
  injectScriptNonce,
} from "./lib/security/csp";

// LL-036: module-load probe — logs to stderr so any failure during import
// resolution is visible in CF tail even if the Worker crashes before fetch().
console.error("[MODULE_LOAD][server.ts] starting module evaluation", {
  ts: new Date().toISOString(),
});

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    console.error("[MODULE_LOAD][server.ts] importing @tanstack/react-start/server-entry");
    serverEntryPromise = import("@tanstack/react-start/server-entry")
      .then((m) => {
        console.error("[MODULE_LOAD][server.ts] server-entry import succeeded", {
          hasDefault: !!m?.default,
          keys: Object.keys(m ?? {}),
        });
        return (m.default ?? m) as ServerEntry;
      })
      .catch((err) => {
        const e = err as { name?: string; message?: string; stack?: string; cause?: unknown };
        console.error("[MODULE_LOAD][server.ts] server-entry import FAILED", {
          name: e?.name,
          code: (e as { code?: string })?.code,
        });
        throw err;
      });
  }
  return serverEntryPromise;
}

console.error("[MODULE_LOAD][server.ts] module evaluation complete");

export async function hardenEdgeResponse(response: Response, request: Request): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html");
  const nonce = isHtml ? generateNonce() : undefined;
  let hardened = response;

  if (isHtml && response.body && nonce) {
    const html = injectCspNonceMetadata(injectScriptNonce(await response.text(), nonce), nonce);
    hardened = new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    hardened.headers.delete("content-length");
  }

  for (const [name, value] of Object.entries(buildSecurityHeaders(nonce))) {
    hardened.headers.set(name, value);
  }
  hardened.headers.delete("x-ssr-error");

  const url = new URL(request.url);
  const isServerFn =
    url.pathname.startsWith("/_serverFn/") ||
    url.pathname.startsWith("/_server/") ||
    url.searchParams.has("_serverFnId");
  if (isHtml || isServerFn) {
    hardened.headers.set("Cache-Control", "private, no-store, max-age=0");
    hardened.headers.set("Pragma", "no-cache");
  }
  if (isHtml) hardened.headers.set("X-FVI-CSP-Nonce-Applied", "1");
  return hardened;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
//
// LL-036 (Felix): the actual error lives on the HTTPError's `.cause` field
// (set by h3's `toError()` on prepareResponse). HTTPError.toJSON() drops it.
// We unwrap the cause for internal logs; the response never carries it.
export async function normalizeCatastrophicSsrResponse(response: Response, request: Request): Promise<Response> {
  // Preserve intentional operational contracts such as 501/502/503/504.
  // Only Nitro's opaque generic 500 needs catastrophic SSR normalization.
  if (response.status !== 500) return response;
  // LL-074: Skip the HTML-error-page conversion for TanStack Start server-fn
  // routes. Replace the raw Error with a safe serialized Error so the client
  // still rejects the server function while no exception detail crosses out.
  const url = new URL(request.url);
  const referenceId = createErrorReference();
  if (
    url.pathname.startsWith("/_serverFn/") ||
    url.pathname.startsWith("/_server/") ||
    request.headers.get("x-tsr-serverfn") === "true"
  ) {
    console.error("SERVERFN_5xx", { referenceId, path: url.pathname });
    const copy = safeErrorPayload(referenceId);
    const safeError = new Error(`${copy.message} ${copy.action} Error Reference ID: ${referenceId}`);
    safeError.stack = undefined;
    const serialized = await toCrossJSONAsync(safeError, {
      refs: new Map(), plugins: [],
    });
    const newHeaders = new Headers(response.headers);
    newHeaders.delete("x-ssr-error");
    newHeaders.set("x-fvi-error-reference", referenceId);
    newHeaders.set("cache-control", "private, no-store");
    newHeaders.set("content-type", "application/json");
    newHeaders.set("x-tss-serialized", "true");
    return new Response(JSON.stringify(serialized), {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.clone().text();
  const captured = consumeLastCapturedError();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nitroLast = (globalThis as any).__NITRO_LAST_ERROR__ as
    | { name?: string; message?: string; stack?: string; cause?: unknown; at?: number }
    | undefined;
  const nitroFresh = nitroLast && nitroLast.at && Date.now() - nitroLast.at < 60_000 ? nitroLast : undefined;
  if (nitroFresh) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__NITRO_LAST_ERROR__;
  }
  const raw = (captured ?? nitroFresh) as
    | { name?: string; message?: string; stack?: string; cause?: unknown }
    | undefined;
  // Unwrap: h3's HTTPError.cause is the original error.
  const cause = raw?.cause as { name?: string; message?: string; stack?: string; cause?: unknown } | undefined;
  const e = cause ?? raw;
  const diag = {
    referenceId,
    source: captured ? "unhandled" : nitroFresh ? "nitro" : "none",
    name: e?.name,
    code: (e as { code?: string })?.code,
    bodyLength: body.length,
    contentType,
    path: url.pathname,
  };
  console.error("SSR_5xx", diag);
  return new Response(renderErrorPage(referenceId), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-fvi-error-reference": referenceId,
    },
  });
}

function renderHardErrorJson(referenceId: string): string {
  return JSON.stringify(safeErrorPayload(referenceId));
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // LL-036: probe at fetch entry — if this log line is absent in CF tail,
    // the Worker is crashing at module evaluation time.
    console.error("[SSR_FATAL][probe][fetch]", {
      path: new URL(request.url).pathname,
      method: request.method,
      host: request.headers.get("host"),
      ts: new Date().toISOString(),
    });

    // LL-036: dev/staging app subdomain → /auth routing. Runs FIRST, before
    // any other logic, so a 302 short-circuits the entire SSR pipeline.
    try {
      const rewriteResponse = applyDevHostRewrite(request);
      if (rewriteResponse) return hardenEdgeResponse(rewriteResponse, request);
    } catch (rewriteErr) {
      console.error("[DEV_HOST_REWRITE][error]", {
        name: (rewriteErr as { name?: string })?.name,
        code: (rewriteErr as { code?: string })?.code,
      });
      // fall through to normal handler
    }

    // OUTER try/catch — last-resort catch for sync throws + rejections before
    // they ever reach Nitro/h3 (which otherwise swallows them into an opaque
    // 500 Response). Logs full error to stderr so CF tail picks it up.
    try {
      // Surface CF bindings (R2 buckets, etc.) to lazy server-only helpers
      // before the SSR handler runs. r2-bindings.server.ts probes globalThis.
      installRuntimeEnv(env);
      const handler = await getServerEntry();

      // INNER try/catch — wraps the handler.fetch + normalize chain so we
      // catch any error that escapes h3's internalisation (e.g. our own
      // normalizeCatastrophicSsrResponse throwing on a malformed body).
      try {
        const response = await handler.fetch(request, env, ctx);
        return await hardenEdgeResponse(
          await normalizeCatastrophicSsrResponse(response, request),
          request,
        );
      } catch (innerError) {
        const referenceId = createErrorReference();
        const innerE = innerError as { name?: string; message?: string; stack?: string; cause?: unknown };
        console.error("[SSR_FATAL][inner]", {
          referenceId,
          name: innerE?.name,
          code: (innerE as { code?: string })?.code,
          path: new URL(request.url).pathname,
          method: request.method,
          stage: "handler.fetch+normalize",
        });
        return hardenEdgeResponse(new Response(renderHardErrorJson(referenceId), {
          status: 500,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            "x-fvi-error-reference": referenceId,
          },
        }), request);
      }
    } catch (outerError) {
      const referenceId = createErrorReference();
      // OUTER hard catch — synchronous throws from module-load, getServerEntry
      // import failures, or anything the inner catch somehow missed.
      const outerE = outerError as { name?: string; message?: string; stack?: string; cause?: unknown };
      console.error("[SSR_FATAL][outer]", {
        referenceId,
        name: outerE?.name,
        code: (outerE as { code?: string })?.code,
        path: new URL(request.url).pathname,
        method: request.method,
        stage: "outer",
      });
      return hardenEdgeResponse(new Response(renderHardErrorJson(referenceId), {
        status: 500,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-fvi-error-reference": referenceId,
        },
      }), request);
    }
  },

  // Cloudflare cron triggers — one invocation per [triggers].crons entry.
  async scheduled(
    event: { cron: string; scheduledTime: number },
    env: unknown,
    ctx: { waitUntil: (p: Promise<unknown>) => void },
  ) {
    installRuntimeEnv(env);
    const { dispatchCron } = await import("./lib/cron-trigger");
    ctx.waitUntil(dispatchCron(event.cron));
  },
};
