// Cloudflare Pages uses this as the Nitro global error handler (see vite.config.ts
// `errorHandler: "src/lib/error-handler.ts"`). h3 normally converts in-handler
// throws into an opaque 500 Response with body
// {"status":500,"unhandled":true,"message":"HTTPError"}. By defaulting here, we
// receive the original error + h3 event and log the cause to stderr, while
// returning only safe, actionable copy and a correlation reference.
import { defineErrorHandler } from "nitro";
import { createErrorReference, safeErrorPayload } from "./user-facing-errors";

export default defineErrorHandler((error, event) => {
  const referenceId = createErrorReference();
  const path = String((event as { path?: string })?.path ??
    (event as { node?: { req?: { url?: string } } })?.node?.req?.url ?? "").split("?")[0];
  const err = error as {
    name?: string;
    message?: string;
    stack?: string;
    cause?: unknown;
    statusCode?: number;
    statusMessage?: string;
  };

  // FIRST: record hit on a process-global so server.ts can see it (CF tail is
  // not reliable in non-interactive sessions, so we propagate via header).
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    g.__NITRO_LAST_ERROR__ = {
      source: "nitro-handler",
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
      cause: err?.cause,
      statusCode: err?.statusCode,
      statusMessage: err?.statusMessage,
      path,
      method: (event as { method?: string })?.method,
      at: Date.now(),
    };
  } catch {
    // ignore
  }

  console.error("[NITRO_ERROR]", {
    referenceId,
    name: err?.name,
    code: (err as { code?: string })?.code,
    statusCode: err?.statusCode,
    path,
    method: (event as { method?: string })?.method,
  });

  const status = err?.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  const responseBody = JSON.stringify(safeErrorPayload(referenceId, status));
  return new Response(responseBody, {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-fvi-error-reference": referenceId,
    },
  });
});
