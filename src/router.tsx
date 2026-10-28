import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Sprint 1 / P-O-02: optional Sentry browser-SDK init. Runs only when
// VITE_SENTRY_DSN is set at build time. In dev or when the env var is unset,
// no Sentry code is loaded and the app boots without observability overhead.
//
// Install dependency: pnpm add @sentry/react  (only required when DSN is set)

type SentryLike = {
  init: (options: Record<string, unknown>) => void;
};

type SentryBeforeSendEvent = {
  user?: { ip_address?: string } & Record<string, unknown>;
};

async function maybeInitSentry(): Promise<void> {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn || typeof dsn !== "string") return;
  try {
    // Dynamic import so Vite only bundles @sentry/react when a DSN is present.
    // The module is an optional dependency; ignore the resolver error when it
    // is not installed (operators install it via `pnpm add @sentry/react`
    // only when they want observability on).
    //
    // `/* @vite-ignore */` tells Rolldown/Vite to skip static analysis of the
    // specifier so the build does not fail when @sentry/react is not installed.
    // @sentry/react is an installed dependency; no ts-expect-error needed.
    const mod = (await import(/* @vite-ignore */ "@sentry/react")) as {
      default?: SentryLike;
    } & SentryLike;
    const Sentry: SentryLike = mod.default ?? mod;
    const sentryEnv = env.VITE_SENTRY_ENV ?? "production";
    const release = env.VITE_SENTRY_RELEASE;
    Sentry.init({
      dsn,
      environment: sentryEnv,
      ...(release ? { release } : {}),
      tracesSampleRate: 0.1,
      denyUrls: [/extensions\//i, /^chrome:\/\//i, /facebook\.net/i],
      beforeSend: (raw: unknown) => {
        const event = raw as SentryBeforeSendEvent;
        // Strip PII: FVI does not need the browser IP for triage and the
        // back-end already records tenant-scoped context.
        if (event.user) delete event.user.ip_address;
        return raw as never;
      },
    });
    if (env.DEV) {
      console.info("[sentry] browser SDK initialised", {
        dsn: dsn.replace(/.{6}$/, "******"),
        env: sentryEnv,
      });
    }
  } catch (err) {
    // SDK failed to load - never crash the app because observability is down.
    console.warn(
      "[sentry] failed to init browser SDK:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// LL-041: do NOT call `void maybeInitSentry()` at module top-level. The previous
// top-level statement caused rolldown to emit an eager `init_router()` call at
// the bottom of the SSR chunk which — when combined with the chunk cycle between
// router.mjs and router-...2.mjs — surfaced as
// "init_tenants_functions is not a function" inside the Workers runtime.
// Sentry is now initialised on first getRouter() call instead, which is past
// the cyclic import window.
function initSentryLazy() { void maybeInitSentry(); }

// LL-041: declare `getRouter` as a `function` (not `const = () =>`). The previous
// shape — `export const getRouter = () => {...}` — caused rolldown to generate a
// top-level `var init_router = __esmMin(() => {...})` followed by an eager
// `init_router()` call (last line of the router SSR chunk). When the SSR graph
// is split into router.mjs <-> router-...2.mjs chunks, that eager call fires
// `init_routeTree_gen()` → `init_route()` → `init_tenants_functions()` while
// the circular import is still being resolved, so the `init_tenants_functions`
// binding is `undefined` and the production runtime throws
// "init_tenants_functions is not a function".
//
// A `function` declaration (instead of `const = () =>`) keeps `getRouter` as a
// plain hoisted function reference and does NOT emit the eager `init_router()`
// call. The first time the SSR entry actually invokes `getRouter()`, all
// imports have finished evaluating and the cycle has resolved.
export function getRouter() {
  initSentryLazy();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
}