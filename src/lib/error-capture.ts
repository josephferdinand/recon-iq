// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

// LL-036 (Felix): h3's HTTPError.toJSON() drops the .cause field, which is
// where the actual original error lives (set by h3's toError() on
// prepareResponse). The response body always shows
// `{"status":500,"unhandled":true,"message":"HTTPError"}` regardless of the
// real cause. Patch HTTPError.prototype.toJSON at module-load time so the
// serialized body preserves the original cause.
//
// We don't have a direct import of h3 here (it's transitively imported by
// TanStack Start's createStartHandler), so we walk the require/import cache
// lazily on first 5xx response, OR we monkey-patch any error-like object
// whose constructor is named "HTTPError" and which has a `cause` field.
function installH3Patch() {
  // Best-effort: try to find HTTPError via global module hooks.
  // The h3 module exports HTTPError as a named export. We can't import h3
  // directly (TanStack Start bundles a private copy), so we hook the
  // `errorResponse` function via console.error wrapping instead — when h3
  // logs the error via `if (error.unhandled && !config.silent) console.error(error)`,
  // we capture it here.
  //
  // Hook into console.error so every unhandled h3 error is captured.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origConsoleError = (console as any).error?.bind(console);
  if (!origConsoleError || (origConsoleError as any).__fviPatched) return;
  (origConsoleError as any).__fviPatched = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).error = (...args: unknown[]) => {
    for (const arg of args) {
      if (arg && typeof arg === "object" && (arg as { unhandled?: boolean }).unhandled) {
        // h3 logs an HTTPError object with .cause set to the original error.
        record(arg);
        break;
      }
      if (arg instanceof Error) {
        record(arg);
        break;
      }
    }
    return origConsoleError(...args);
  };
}

installH3Patch();

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
