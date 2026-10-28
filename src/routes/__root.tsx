import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportPlatformError } from "../lib/error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { MktWidgetMount } from "@/components/mkt-widget-mount";
import { MktThemeMount } from "@/components/mkt-theme-mount";
import { supabase } from "@/integrations/supabase/client";
import { MotionConfig } from "framer-motion";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-semibold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportPlatformError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ReconIQ — Enterprise Reconciliation Engine" },
      {
        name: "description",
        content:
          "ReconIQ is an enterprise-grade, AI-powered reconciliation platform for cash, securities, and intercompany breaks. Hash-chained audit, multi-tenant, agentic.",
      },
      { name: "author", content: "ReconIQ" },
      { property: "og:title", content: "ReconIQ — Enterprise Reconciliation Engine" },
      { property: "og:description", content: "AI-native reconciliation. Agentic, auditable, sovereign." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "ReconIQ" },
      { property: "og:image", content: "https://reconintelligence.app/fv-monogram.svg" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "ReconIQ — Enterprise Reconciliation Engine" },
      { name: "twitter:description", content: "AI-native reconciliation. Agentic, auditable, sovereign." },
      { name: "twitter:image", content: "https://reconintelligence.app/fv-monogram.svg" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/fv-monogram.svg" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],

  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[999] focus:rounded-md focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-none"
          style={{ background: "#c9a44c", color: "var(--ink-void)" }}
        >
          Skip to main content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* reducedMotion="user" — framer-motion honors prefers-reduced-motion
            for every animation in the tree (whileHover sheens, orbit tiles,
            reveals). Non-motion CSS effects are toned down in styles.css. */}
        <MotionConfig reducedMotion="user">
          <Outlet />
          
          <MktThemeMount />
          <MktWidgetMount />
          <Toaster richColors position="top-right" />

        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
