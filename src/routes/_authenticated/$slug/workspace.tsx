import { createFileRoute, getRouteApi, Link, Navigate, Outlet, useMatches } from "@tanstack/react-router";
import { z } from "zod";

const parentRoute = getRouteApi("/_authenticated/$slug");
import { AppShell, SidebarSection, SidebarLink } from "@/components/app-shell";
import { PageContainer, type RailItem } from "@/components/left-rail";
import { WorkspaceRail, type WorkspaceRailPage, type WorkspaceRailSection } from "@/components/workspace-rail";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Home,
  LifeBuoy,
  BookOpen,
  ShieldAlert,
  ShieldCheck,
  GitBranch,
  Database,
  BarChart3,
  Bot,
  Workflow,
  Eye,
  History,
  FileScan,
  Clock,
} from "lucide-react";
import { DataSourcesTab } from "@/components/data-sources-tab";
import { NavigatorHub } from "@/components/navigator-hub";
import { TicketsTab } from "@/components/tickets-tab";
import { ReconsTab } from "@/components/recons-tab";
import { ExceptionsTab } from "@/components/exceptions-tab";
import { ExceptionDashboard } from "@/components/exception-dashboard";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { useTenantSessionMaxAge } from "@/hooks/use-tenant-session-max-age";
import { BreakManagerTab } from "@/components/break-manager-tab";
import { ReportsTab } from "@/components/reports-tab";
import { AgentTab } from "@/components/agent-tab";
import { DataPrepTab } from "@/components/data-prep-tab";
import { WatchersTab } from "@/components/watchers-tab";
import { RunHistoryTab } from "@/components/run-history-tab";
import { AidpTab } from "@/components/aidp-tab";
import { ReconSchedulesTab } from "@/components/recon-schedules-tab";
import { ConnectorsTab } from "@/components/connectors-tab";
import { IngestionHub } from "@/components/ingestion-hub";
import { WorkspaceDashboard } from "@/components/workspace-dashboard";
import { MyAuditTrail } from "@/components/my-audit-trail";
import { Plug, UploadCloud, Layers, Gauge, ScrollText, GitMerge } from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { RegulatoryTab } from "@/components/regulatory-tab";
import { LineageTab } from "@/components/lineage-tab";
import { ReconTemplatesTab } from "@/components/recon-templates-tab";
import { CollateralTab } from "@/components/collateral-tab";
import { ProposedMatchesTab } from "@/components/proposed-matches-tab";
import { ManualMatchApprovalsTab } from "@/components/manual-match-approvals-tab";
import { ReferenceDataTab } from "@/components/reference-data-tab";
import { AgeingTab, EodSignoffTab } from "@/components/ageing-eod-tabs";
import { MatchesConsolidatedTab } from "@/components/rekon/matches-consolidated-tab";
import { NRLEditor } from "@/components/rekon/nrl-editor";
import { NRLPage } from "@/components/rekon/nrl-page";
import { Library, Coins, Sparkles, ShieldCheck as ShieldCheckIcon, Table as TableIcon, Hourglass, CalendarCheck, Wand2, Users } from "lucide-react";
import { AssignmentRulesTab } from "@/components/assignment-rules-tab";
import { ProductivityTab } from "@/components/productivity-tab";
import { Sparkles as SparklesIcon } from "lucide-react";
import { useAccess, PageGate } from "@/hooks/use-access";
import { GovernanceMembershipApprovals } from "@/components/governance-membership-approvals";
import { WORKSPACE_PAGES, findPageDef } from "@/lib/page-permissions";
import { listWorkspacePageVisibility } from "@/lib/workspace-visibility.functions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EyeOff } from "lucide-react";

const searchSchema = z.object({
  page: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/$slug/workspace")({
  validateSearch: searchSchema,
  component: WorkspacePage,
});

const RAIL_PAGES: RailItem[] = WORKSPACE_PAGES.filter((item) => item.key !== "access-explorer").map((p) => {
  const fallback: Record<string, any> = {
    dashboard: Gauge, ingest: Layers, data: UploadCloud,
    connectors: Plug, watchers: Eye, prep: Workflow, aidp: FileScan, reference: TableIcon,
    recons: GitBranch, schedules: Clock, runs: History, templates: Library,
    collateral: Coins, "exception-dashboard": BarChart3, exceptions: ShieldAlert, assignment: Users, breaks: ShieldAlert,
    proposed: Sparkles, matches: Layers, nrl: Wand2, "manual-approvals": ShieldCheckIcon,
    ageing: Hourglass, reports: BarChart3, agent: Bot, productivity: SparklesIcon,
    eod: CalendarCheck, regulatory: ScrollText, lineage: GitMerge, audit: ShieldCheck,
    tickets: LifeBuoy, kb: BookOpen,
  };
  return { ...p, icon: fallback[p.key] };
});

type WorkspaceSection = {
  key: string;
  label: string;
  icon: RailItem["icon"];
  pages: string[];
};

const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { key: "dashboard", label: "Home", icon: Home, pages: ["dashboard"] },
  { key: "ingest", label: "Ingestion", icon: Layers, pages: ["ingest", "data", "connectors", "watchers", "aidp", "reference"] },
  { key: "prep", label: "Data Prep", icon: Workflow, pages: ["prep"] },
  { key: "recons", label: "Reconciliations", icon: GitBranch, pages: ["recons", "schedules", "runs", "templates", "collateral", "my-templates"] },
  { key: "exceptions", label: "Exceptions", icon: ShieldAlert, pages: ["exception-dashboard", "exceptions", "assignment", "breaks", "proposed", "matches", "nrl"] },
  { key: "ageing", label: "Insights", icon: SparklesIcon, pages: ["ageing", "agent", "productivity", "lineage"] },
  { key: "reports", label: "Reports", icon: BarChart3, pages: ["reports", "regulatory"] },
  { key: "manual-approvals", label: "Tasks & Approvals", icon: CalendarCheck, pages: ["manual-approvals", "eod"] },
  { key: "audit", label: "Audit Trail", icon: ShieldCheck, pages: ["audit"] },
  { key: "tickets", label: "Support", icon: LifeBuoy, pages: ["tickets", "kb"] },
];

function WorkspacePage() {
  const { tenant } = parentRoute.useLoaderData() as any;
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const requestedPage = search.page ?? "dashboard";
  const page = WORKSPACE_PAGES.some((item) => item.key === requestedPage) ? requestedPage : "dashboard";
  const matches = useMatches();
  const activeRailKey = matches.some((match) => match.routeId === "/_authenticated/$slug/workspace/templates")
    ? "my-templates" : page;
  const hasChild = matches.some(
    (m) =>
      m.routeId !== "/_authenticated/$slug/workspace" &&
      typeof m.routeId === "string" &&
      m.routeId.startsWith("/_authenticated/$slug/workspace/"),
  );
  useTenantSessionMaxAge(tenant.id);
  const access = useAccess(tenant.id);
  const permSet = access.isPlatformAdmin ? null : new Set(access.permissionIds);
  const canWrite =
    access.isPlatformAdmin ||
    tenant.role === "tenant_admin" ||
    tenant.role === "tenant_analyst";
  const currentPageDef = findPageDef("workspace", page);

  // Tenant-admin-controlled page visibility. Missing row => enabled.
  const fetchVisibility = useServerFn(listWorkspacePageVisibility);
  const visQ = useQuery({
    queryKey: ["workspace-visibility-map", tenant.id],
    queryFn: () => fetchVisibility({ data: { tenant_id: tenant.id } }),
    staleTime: 60_000,
  });
  const disabledPages = new Set<string>(
    (visQ.data ?? []).filter((r: any) => !r.enabled).map((r: any) => r.key),
  );
  // Always keep dashboard reachable so users never see a blank shell.
  disabledPages.delete("dashboard");
  const canSeePage = (key: string) => {
    if (disabledPages.has(key)) return false;
    const definition = WORKSPACE_PAGES.find((candidate) => candidate.key === key);
    return permSet == null || !definition?.permission || permSet.has(definition.permission);
  };
  const visibleSections = WORKSPACE_SECTIONS.filter((section) =>
    section.pages.some(canSeePage),
  );
  const workspaceRailSections: WorkspaceRailSection[] = visibleSections.map((section) => ({
    ...section,
    pages: section.pages.filter(canSeePage).flatMap((key): WorkspaceRailPage[] => {
      if (key === "my-templates") {
        // Preserve the existing authenticated workspace/RLS contract. This is
        // the assigned-template child route, not the Starter Kits query page.
        return [{ key, label: "My Templates", icon: Library, to: `/${slug}/workspace/templates` }];
      }
      const item = RAIL_PAGES.find((candidate) => candidate.key === key);
      return item ? [{ ...item, label: key === "prep" ? "Data Prep pipelines" : item.label }] : [];
    }),
  }));
  const activeSection =
    WORKSPACE_SECTIONS.find((section) => section.pages.includes(activeRailKey)) ?? WORKSPACE_SECTIONS[0];
  const sectionPages = workspaceRailSections.find((section) => section.key === activeSection.key)?.pages ?? [];
  const pageDisabled = disabledPages.has(page);

  return (
    <AppShell
      title={`${tenant.name} — Workspace`}
      tenantSlug={slug}
      tenantId={tenant.id}
      scope="workspace"
      canTenant={access.isPlatformAdmin || tenant.role === "tenant_admin" || access.hasAny(["tenant.settings.read", "tenant.role.read", "tenant.user.read"])}
      sidebar={
        <>
          <SidebarSection label="Account" collapsible={false}>
            <SidebarLink to="/home" icon={Home}>All workspaces</SidebarLink>
          </SidebarSection>
          <WorkspaceRail sections={workspaceRailSections} activeKey={activeRailKey} basePath={`/${slug}/workspace`} />
        </>
      }
    >
      {!hasChild && requestedPage !== page ? (
        <Navigate to="/$slug/workspace" params={{ slug }} search={{ page }} replace />
      ) : null}
      {hasChild ? (
        <Outlet />
      ) : (
        <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3" data-tour="page-header">
          <p className="text-sm text-muted-foreground">
            /{tenant.slug} · {String(tenant.role).replace("tenant_", "")}
          </p>
          <div className="flex items-center gap-2" data-tour="env-badges">
            <Badge variant="outline" className="uppercase">{tenant.environment}</Badge>
            <Badge variant={tenant.ai_enabled ? "default" : "outline"}>
              {tenant.ai_enabled ? "AI on" : "AI off"}
            </Badge>
          </div>
        </div>

        <PageContainer>
        <WorkspaceSectionNav slug={slug} section={activeSection} pages={sectionPages} activePage={page} />
        {pageDisabled ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <EyeOff className="h-4 w-4" /> Page unavailable
              </CardTitle>
              <CardDescription>
                <span className="font-medium">{currentPageDef?.label ?? page}</span> has been
                disabled for this workspace by your tenant administrator. Contact your admin
                if you need access.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
        <PageGate tenantId={tenant.id} permission={currentPageDef?.permission ?? null} pageLabel={currentPageDef?.label ?? page}>
        {page === "dashboard" && <ErrorBoundary label="Dashboard"><WorkspaceDashboard tenantId={tenant.id} tenantName={tenant.name} /></ErrorBoundary>}
        {page === "access-explorer" && <Navigate to="/$slug/tenant" params={{ slug }} search={{ page: "access-explorer" }} replace />}
        {page === "ingest" && <ErrorBoundary label="Ingestion hub"><IngestionHub tenantId={tenant.id} slug={slug} /></ErrorBoundary>}
        {page === "data" && <ErrorBoundary label="File uploads"><DataSourcesTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "connectors" && <ErrorBoundary label="Connections"><ConnectorsTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "prep" && <ErrorBoundary label="Data prep"><DataPrepTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "aidp" && <ErrorBoundary label="AIDP"><AidpTab tenantId={tenant.id} tenantSlug={slug} canWrite={canWrite} /></ErrorBoundary>}
        {page === "watchers" && <ErrorBoundary label="Watchers"><WatchersTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "recons" && <ErrorBoundary label="ReconIQ Studio"><ReconsTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "schedules" && <ErrorBoundary label="Rekon Orchestrator"><ReconSchedulesTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "templates" && <ErrorBoundary label="Templates"><ReconTemplatesTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "collateral" && <ErrorBoundary label="Collateral"><CollateralTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "runs" && <ErrorBoundary label="Run history"><RunHistoryTab tenantId={tenant.id} /></ErrorBoundary>}
        {page === "exception-dashboard" && <ErrorBoundary label="Exceptions dashboard"><ExceptionDashboard tenantId={tenant.id} slug={slug} /></ErrorBoundary>}
        {page === "exceptions" && <ErrorBoundary label="Exceptions"><ExceptionsTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "breaks" && <ErrorBoundary label="Break manager"><BreakManagerTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "proposed" && <ErrorBoundary label="Proposed matches"><ProposedMatchesTab tenantId={tenant.id} /></ErrorBoundary>}
        {page === "matches" && <ErrorBoundary label="Matched records"><MatchesConsolidatedTab tenantId={tenant.id} /></ErrorBoundary>}
        {page === "nrl" && <ErrorBoundary label="NRL"><NRLPage tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "manual-approvals" && <ErrorBoundary label="Manual match approvals"><ManualMatchApprovalsTab tenantId={tenant.id} /></ErrorBoundary>}
        {page === "membership-requests" && <ErrorBoundary label="My group access requests"><GovernanceMembershipApprovals tenantId={tenant.id} /></ErrorBoundary>}
        {page === "reference" && <ErrorBoundary label="Reference data"><ReferenceDataTab tenantId={tenant.id} /></ErrorBoundary>}
        {page === "reports" && <ErrorBoundary label="Reports"><ReportsTab tenantId={tenant.id} /></ErrorBoundary>}
        {page === "ageing" && <ErrorBoundary label="Ageing"><AgeingTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "agent" && <ErrorBoundary label="Agent"><AgentTab tenantId={tenant.id} canWrite={canWrite} aiEnabled={!!tenant.ai_enabled} /></ErrorBoundary>}
        {page === "eod" && <ErrorBoundary label="EOD"><EodSignoffTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "assignment" && <ErrorBoundary label="Auto-assignment"><AssignmentRulesTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "productivity" && <ErrorBoundary label="Productivity"><ProductivityTab tenantId={tenant.id} /></ErrorBoundary>}
        {page === "tickets" && <ErrorBoundary label="Tickets"><TicketsTab mode="workspace" tenantId={tenant.id} /></ErrorBoundary>}
        {page === "kb" && <ErrorBoundary label="Knowledge"><div className="space-y-6"><NavigatorHub scope="workspace" tenantId={tenant.id} /><OnboardingChecklist tenantId={tenant.id} aiEnabled={!!tenant.ai_enabled} /></div></ErrorBoundary>}
        {page === "audit" && <ErrorBoundary label="My Audit Trail"><MyAuditTrail tenantId={tenant.id} /></ErrorBoundary>}
        {page === "regulatory" && <ErrorBoundary label="Regulatory"><RegulatoryTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}
        {page === "lineage" && <ErrorBoundary label="Lineage"><LineageTab tenantId={tenant.id} /></ErrorBoundary>}
        </PageGate>
        )}
        </PageContainer>
        </>
      )}
    </AppShell>
  );
}

function WorkspaceSectionNav({
  slug,
  section,
  pages,
  activePage,
}: {
  slug: string;
  section: WorkspaceSection;
  pages: WorkspaceRailPage[];
  activePage: string;
}) {
  if (pages.length <= 1) return null;
  return (
    <nav aria-label={`${section.label} tools`} className="mb-5 rounded-xl border bg-card p-2 shadow-sm">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {section.label}
      </div>
      <div className="flex flex-wrap gap-1">
        {pages.map((item) => {
          const Icon = item.icon;
          const active = item.key === activePage;
          return (
            <Link
              key={item.key}
              to={item.to ?? "/$slug/workspace"}
              params={{ slug }}
              search={item.to ? {} : { page: item.key }}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "bg-[var(--brand-gold)] text-[#0e1a30] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
