import { useRouterState } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const DrFalconWidget = lazy(() => import("./dr-falcon-widget").then((m) => ({ default: m.DrFalconWidget })));

/**
 * Only mount ReconIQ Copilot on public marketing routes.
 * Excludes: /auth, /reset-password, tenant workspace (`/_authenticated/*` → paths like `/$slug/...`),
 * admin portal, and API routes.
 */
const HIDE_PREFIXES = ["/auth", "/reset-password", "/mkt-admin", "/api", "/m/", "/t/"];

export function MktWidgetMount() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Tenant slug routes look like "/<slug>/..." — skip if there's a slug segment we recognize as authenticated.
  // For safety we only mount on the known public marketing routes.
  const isPublicMarketing =
    pathname === "/" ||
    pathname === "/contact" ||
    pathname === "/book-demo" ||
    pathname === "/status" ||
    pathname.startsWith("/legal");
  if (!isPublicMarketing) return null;
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return (
    <Suspense fallback={null}>
      <DrFalconWidget />
    </Suspense>
  );
}
