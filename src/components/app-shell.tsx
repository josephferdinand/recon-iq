import { Link, useNavigate, useRouterState, type LinkProps } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Command as CommandIcon, ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { RailAccordionProvider, useRailAccordion } from "@/components/rail-accordion";
import { CommandPalette } from "@/components/command-palette";
import { NotificationCenter } from "@/components/notification-center";
import { ChangelogDrawer } from "@/components/changelog-drawer";
import { UserPrefsDialog } from "@/components/user-prefs-dialog";
import { DensityToggle } from "@/components/density-toggle";
import { ScopeSwitcher, type Scope } from "@/components/scope-switcher";
import { UserProfileMenu } from "@/components/user-profile-menu";
import { CopilotSheetButton } from "@/components/copilot-sheet";
import { TourButton } from "@/components/tour-button";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { IdleTimeoutGuard } from "@/hooks/use-idle-timeout";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccess } from "@/lib/tenants.functions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const LAST_SLUG_KEY = "fvi.lastTenantSlug";

export function AppShell({
  sidebar,
  children,
  title,
  tenantSlug,
  tenantId,
  scope,
  canTenant,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  title?: string;
  tenantSlug?: string;
  tenantId?: string;
  scope?: Scope;
  canTenant?: boolean;
}) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const getAccess = useServerFn(getMyAccess);
  const accessQ = useQuery({
    queryKey: ["my-access"],
    queryFn: () => getAccess(),
    staleTime: 5 * 60 * 1000,
  });

  // Remember the last tenant slug the user visited so the scope switcher
  // can still offer Workspace/Tenant when they jump into /platform.
  const [rememberedSlug, setRememberedSlug] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return window.localStorage.getItem(LAST_SLUG_KEY) ?? undefined;
  });
  useEffect(() => {
    if (tenantSlug && typeof window !== "undefined") {
      window.localStorage.setItem(LAST_SLUG_KEY, tenantSlug);
      setRememberedSlug(tenantSlug);
    }
  }, [tenantSlug]);
  const effectiveSlug = tenantSlug ?? rememberedSlug;

  const crumbs = buildCrumbs(pathname);
  const currentScope: Scope | undefined =
    scope ??
    (pathname.startsWith("/platform")
      ? "platform"
      : pathname.includes("/tenant")
        ? "tenant"
        : pathname.includes("/workspace")
          ? "workspace"
          : undefined);

  const railScope = `${currentScope ?? "app"}:${tenantSlug ?? "_"}`;

  return (
    <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
      <div className="grid min-h-dvh grid-cols-1 bg-background md:grid-cols-[260px_minmax(0,1fr)]">
        <IdleTimeoutGuard />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <CommandPalette ctx={{ tenantSlug, tenantId }} />
        <aside
          className="hidden flex-col border-r bg-sidebar text-sidebar-foreground md:flex"
          aria-label="Primary navigation"
        >
          <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-4">
            <FviApprovedLogo className="h-16 w-16 rounded-md" />
            <Link to="/home" className="font-display text-sm font-semibold tracking-tight">
              ReconIQ
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto py-4" style={{ scrollbarGutter: "stable" }}>
            <RailAccordionProvider scope={railScope}>{sidebar}</RailAccordionProvider>
          </div>
          <div className="space-y-1 border-t border-sidebar-border p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => {
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
              }}
            >
              <CommandIcon className="mr-2 h-3.5 w-3.5" />
              Command palette
              <kbd className="ml-auto rounded border px-1.5 text-[10px]">⌘K</kbd>
            </Button>
          </div>
        </aside>

        <SheetContent
          side="left"
          className="flex w-[min(20rem,calc(100dvw-2rem))] max-w-none flex-col gap-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-none"
        >
          <SheetTitle className="sr-only">Primary navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate ReconIQ on a small screen.
          </SheetDescription>
          <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-4 pr-12">
            <FviApprovedLogo className="h-9 w-9 rounded-md" />
            <Link
              to="/home"
              className="font-display text-sm font-semibold tracking-tight"
              onClick={() => setMobileNavigationOpen(false)}
            >
              ReconIQ
            </Link>
          </div>
          <aside
            aria-label="Mobile primary navigation"
            className="min-h-0 flex-1 overflow-y-auto py-4"
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest("a")) setMobileNavigationOpen(false);
            }}
          >
            <RailAccordionProvider scope={railScope}>{sidebar}</RailAccordionProvider>
          </aside>
          <div className="space-y-1 border-t border-sidebar-border p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => {
                setMobileNavigationOpen(false);
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
              }}
            >
              <CommandIcon className="mr-2 h-3.5 w-3.5" />
              Command palette
              <kbd className="ml-auto rounded border px-1.5 text-[10px]">⌘K</kbd>
            </Button>
          </div>
        </SheetContent>

        <main className="flex min-h-dvh min-w-0 flex-col">
          {title ? (
            <header className="fvi-topbar flex flex-col gap-3 border-b border-sidebar-border bg-sidebar px-4 py-3 text-sidebar-foreground sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-8 sm:py-4">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open navigation"
                    className="shrink-0 md:hidden"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <div className="min-w-0 flex-1">
                  {crumbs.length > 1 ? (
                    <nav
                      aria-label="Breadcrumb"
                      className="mb-1 flex items-center gap-1 overflow-hidden text-xs text-sidebar-foreground/60"
                    >
                      {crumbs.map((c, i) => (
                        <span key={i} className="flex min-w-0 items-center gap-1">
                          {i > 0 ? <ChevronRight className="h-3 w-3 shrink-0" /> : null}
                          {c.to ? (
                            <Link
                              to={c.to as LinkProps["to"]}
                              params={c.params as LinkProps["params"]}
                              className="truncate hover:text-sidebar-foreground"
                            >
                              {c.label}
                            </Link>
                          ) : (
                            <span className="truncate">{c.label}</span>
                          )}
                        </span>
                      ))}
                    </nav>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="truncate font-display text-xl font-semibold tracking-tight sm:text-2xl">
                      {title}
                    </h1>
                    {currentScope ? (
                      <ScopeSwitcher
                        current={currentScope}
                        tenantSlug={effectiveSlug}
                        canPlatform={!!accessQ.data?.is_platform_admin}
                        canTenant={canTenant ?? (currentScope === "tenant" || !!accessQ.data?.is_platform_staff)}
                      />
                    ) : null}
                    {currentScope && accessQ.isError ? (
                      <span role="alert" className="text-xs text-destructive">
                        Access check unavailable. Scope options may be incomplete.{" "}
                        <button type="button" className="underline" onClick={() => { void accessQ.refetch(); }}>Retry</button>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto sm:shrink-0 sm:flex-nowrap">
                <UserPrefsDialog />
                <DensityToggle />
                <TourButton />
                <ChangelogDrawer />
                <NotificationCenter />
                <CopilotSheetButton scope={currentScope} tenantId={tenantId} />
                <UserProfileMenu />
              </div>
            </header>
          ) : null}

          <div
            id="main-content"
            tabIndex={-1}
            className="flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-6"
            style={{ scrollbarGutter: "stable" }}
          >
            {children}
          </div>
        </main>
      </div>
    </Sheet>
  );
}

function buildCrumbs(
  pathname: string,
): { label: string; to?: string; params?: Record<string, string> }[] {
  const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);
  const out: { label: string; to?: string; params?: Record<string, string> }[] = [
    { label: "Home", to: "/home" },
  ];
  if (parts[0] === "platform") out.push({ label: "Platform" });
  else if (parts[0] === "home") return out;
  else if (parts.length >= 2) {
    const slug = parts[0];
    out.push({ label: slug, to: `/$slug/${parts[1]}` as any, params: { slug } });
    out.push({ label: parts[1] === "tenant" ? "Tenant management" : "Workspace" });
  }
  return out;
}

export function SidebarSection({
  label,
  children,
  collapsible = true,
}: {
  label: string;
  children: ReactNode;
  collapsible?: boolean;
}) {
  const accordion = useRailAccordion();
  const id = `section:${label}`;
  // Without a provider, keep the legacy always-open behavior.
  const canCollapse = collapsible && accordion != null;
  const isOpen = canCollapse ? accordion!.isOpen(id) : true;
  const contentId = `sidebar-section-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="px-3 py-2">
      {canCollapse ? (
        <button
          type="button"
          onClick={() => accordion!.toggle(id)}
          aria-expanded={isOpen}
          aria-controls={contentId}
          className="group/label flex w-full items-center justify-between rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
        >
          <span className="truncate">{label}</span>
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform duration-200",
              isOpen && "rotate-90",
            )}
          />
        </button>
      ) : (
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/80">
          {label}
        </div>
      )}
      <div
        id={contentId}
        className={cn(
          canCollapse && "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <div className="overflow-hidden">
          <div className="mt-0.5 space-y-0.5" tabIndex={isOpen ? undefined : -1}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SidebarLink({
  to,
  params,
  search,
  icon: Icon,
  children,
}: {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  icon?: any;
  children: ReactNode;
}) {
  return (
    <Link
      to={to as any}
      params={params as any}
      search={search as any}
      activeOptions={{ exact: false }}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground [&.active]:font-medium"
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      <span>{children}</span>
    </Link>
  );
}
