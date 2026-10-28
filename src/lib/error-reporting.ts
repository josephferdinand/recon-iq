/**
 * Client-side error reporting shim.
 *
 * Forwards uncaught React errors to the platform observability sink when
 * one is present on `window`. Neutral naming; kept as a thin bridge so
 * hosting-layer telemetry (if injected) still receives events.
 */
type ErrorReportOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type PlatformEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: ErrorReportOptions,
  ) => void;
};

declare global {
  interface Window {
    __fviEvents?: PlatformEvents;
    __metaEvents?: PlatformEvents;
  }
}

export function reportPlatformError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const sink = window.__fviEvents ?? window.__metaEvents;
  const handled = context.source === "user_feedback";
  sink?.captureException?.(
    error,
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...context,
    },
    {
      mechanism: handled ? "manual" : "react_error_boundary",
      handled,
      severity: "error",
    },
  );
}

// Backwards-compatible export while callers migrate.
export const reportMetaError = reportPlatformError;
