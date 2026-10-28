import { createFileRoute, getRouteApi, Link, Navigate, Outlet, useMatches } from "@tanstack/react-router";
import { z } from "zod";

const parentRoute = getRouteApi("/_authenticated/$slug");
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { setTenantAi, listRecentAudit } from "@/lib/tenants.functions";
import { AppShell, SidebarSection, SidebarLink } from "@/components/app-shell";
import { LeftRail, PageContainer, RailBreadcrumbs, type RailItem } from "@/components/left-rail";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Home, Settings, Users, Fingerprint, BookOpen, LifeBuoy, GitBranch,
  ShieldCheck, Timer, Lock, KeyRound, Zap, Bell, Shield, ToggleLeft, UsersRound, DollarSign, ShieldAlert,
  Database, FileBarChart, UserCog, Bot, Network, Building2,
  Palette, FileCode2, Archive, Activity, Eye,
} from "lucide-react";
import { TenantUserAnalyticsDashboard } from "@/components/user-analytics-dashboard";
import { BrandingTab } from "@/components/tenant/branding-tab";
import { ApiDocsTab } from "@/components/tenant/api-docs-tab";
import { BusinessUnitsTab } from "@/components/business-units-tab";
import { SubProcessorsTab } from "@/components/subprocessors-tab";
import { AgentPoliciesTab } from "@/components/agent-policies-tab";
import { AgentReviewQueue } from "@/components/agent-review-queue";
import { AidpReviewQueue } from "@/components/aidp-review-queue";
import { ReportingMappingsTab } from "@/components/reporting-mappings-tab";
import { ReportingDbTab } from "@/components/reporting-db-tab";
import { ScimTab } from "@/components/scim-tab";
import { DoraTab } from "@/components/dora-tab";
import { ByokTab } from "@/components/byok-tab";
import { ResidencyTab } from "@/components/residency-tab";
import { StreamingTab } from "@/components/streaming-tab";
import { GtmTab } from "@/components/gtm-tab";
import { Radio, Globe2, Rocket } from "lucide-react";
import { AiGovernanceTab } from "@/components/ai-governance-tab";
import { FeatureFlagsTab } from "@/components/feature-flags-tab";
import { WorkspaceVisibilityTab } from "@/components/workspace-visibility-tab";
import { TenantModulesTab } from "@/components/tenant-modules-tab";
import { GovernanceApprovalQueue } from "@/components/governance-approval-queue";
import { GroupsTab } from "@/components/groups-tab";
import { AiUsageTab } from "@/components/ai-usage-tab";
import { UsageMeteringTab } from "@/components/usage-metering-tab";
import { FirstReconWizard } from "@/components/first-recon-wizard";
import { toast } from "sonner";
import { MembersTab } from "@/components/members-tab";
import { RbacRolesTab } from "@/components/rbac-roles-tab";
import { TenantDomainsTab } from "@/components/tenant-domains-tab";
import { LlmTab } from "@/components/llm-tab";
import { VaultTab } from "@/components/vault-tab";
import { NavigatorHub } from "@/components/navigator-hub";
import { TicketsTab, SlaTab } from "@/components/tickets-tab";
import { EnvironmentDeliveryTab } from "@/components/environment-delivery-tab";
import { SecurityTab } from "@/components/security-tab";
import { SsoTab } from "@/components/sso-tab";
import { ConnectorsTab } from "@/components/connectors-tab";
import { ChannelsTab } from "@/components/channels-tab";
import { ResidencyCard } from "@/components/residency-card";
import { useTenantSessionMaxAge } from "@/hooks/use-tenant-session-max-age";
import { RetentionTab } from "@/components/retention-tab";
import { WebhooksTab } from "@/components/webhooks-tab";
import { CmekTab } from "@/components/cmek-tab";
import { AgentWorkflowDesignerTab } from "@/components/agent-workflow-designer-tab";
import { ChatOpsTab } from "@/components/chat-ops-tab";
import { SecurityV2Tab } from "@/components/security-v2-tab";
import { ReconHealthDashboard } from "@/components/recon-health-dashboard";
import { WorkerHealthTab } from "@/components/worker-health-tab";
import { ResilienceTab } from "@/components/resilience-tab";
import { DevPlatformTab } from "@/components/dev-platform-tab";
import { Webhook as WebhookIcon, Library as LibraryIcon, Workflow as WorkflowIcon, ShoppingBag, MessageSquare, Code2 } from "lucide-react";
import { AccessExplorer } from "@/components/access-explorer";
import { TenantIpAllowlistTab } from "@/components/tenant-ip-allowlist-tab";
import { TenantDlpTab } from "@/components/tenant-dlp-tab";
import { useAccess, PageGate } from "@/hooks/use-access";
import { TENANT_PAGES, findPageDef } from "@/lib/page-permissions";


const searchSchema = z.object({ page: z.string().optional() });

export const Route = createFileRoute("/_authenticated/$slug/tenant")({
  validateSearch: searchSchema,
  component: TenantAdmin,
});

const ICONS: Record<string, any> = {
  settings: Settings, members: Users, "rbac-roles": ShieldCheck, domains: Globe2,
  groups: UsersRound, "people-analytics": Activity, "business-units": Building2,
  branding: Palette, "access-explorer": KeyRound, governance: ShieldCheck,
  ai: Fingerprint, "ai-gov": Shield, "ai-usage": DollarSign, "usage-metering": DollarSign,
  modules: ToggleLeft, features: ToggleLeft, "workspace-visibility": Eye, "agent-policies": Bot, "agent-review": Bot, "aidp-review": Bot,
  "agent-workflows": WorkflowIcon,
  connectors: Zap, channels: Bell, sso: KeyRound, gtm: Rocket, "api-docs": FileCode2,
  webhooks: WebhookIcon, "dev-platform": Code2,
  "chat-ops": MessageSquare, scim: UserCog,
  kb: BookOpen, tickets: LifeBuoy, sla: Timer,
  "reporting-map": FileBarChart, "reporting-db": Database,
  promo: GitBranch, security: Lock, byok: KeyRound, cmek: KeyRound,
  "security-v2": Lock, resilience: ShieldAlert, residency: Globe2, streaming: Radio,
  dora: ShieldAlert, subprocessors: Network, retention: Archive, audit: ShieldCheck,
  "ip-allowlist": Shield, dlp: ShieldAlert,
  "recon-health": Activity, "worker-health": Activity,
  "pipeline-status": Activity,

};
// Specialist and legacy routes remain available through governed deep links.
const TENANT_HIDDEN_FROM_PRIMARY_NAV = new Set(["gtm", "dev-platform", "security", "byok", "cmek", "pipeline-status"]);
const RAIL_PAGES: RailItem[] = TENANT_PAGES
  .filter((page) => !TENANT_HIDDEN_FROM_PRIMARY_NAV.has(page.key))
  .map((p) => ({ ...p, icon: ICONS[p.key] ?? Settings }));

function TenantAdmin() {
  const { tenant } = parentRoute.useLoaderData() as any;
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const page = search.page ?? "settings";
  const qc = useQueryClient();
  const toggleAi = useServerFn(setTenantAi);
  const fetchAudit = useServerFn(listRecentAudit);
  useTenantSessionMaxAge(tenant.id);

  // Detect whether a child route (tenant/settings/*, tenant/admin, tenant/pipeline-status) is matched.
  const matches = useMatches();
  const hasChild = matches.some(
    (m) =>
      m.routeId !== "/_authenticated/$slug/tenant" &&
      typeof m.routeId === "string" &&
      m.routeId.startsWith("/_authenticated/$slug/tenant/"),
  );

  const auditQ = useQuery({
    queryKey: ["tenant-audit", tenant.id],
    queryFn: () => fetchAudit({ data: { tenant_id: tenant.id, limit: 100 } }),
    enabled: page === "audit",
  });

  const m = useMutation({
    mutationFn: (v: boolean) => toggleAi({ data: { tenant_id: tenant.id, ai_enabled: v } }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["my-tenants"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isAdmin = tenant.role === "tenant_admin" || tenant.role === "platform_admin";
  const access = useAccess(tenant.id);
  const permSet = access.isPlatformAdmin ? null : new Set(access.permissionIds);
  const currentPageDef = findPageDef("tenant", page);

  return (
    <AppShell
      title={`${tenant.name} — Tenant management`}
      tenantSlug={slug}
      tenantId={tenant.id}
      scope="tenant"
      sidebar={
        <>
          <SidebarSection label="Account" collapsible={false}>
            <SidebarLink to="/home" icon={Home}>Home</SidebarLink>
          </SidebarSection>
          <LeftRail items={RAIL_PAGES} activeKey={page} defaultKey="settings" permissionSet={permSet} storageScope={`tenant:${tenant.slug}`} basePath={`/${slug}/tenant`} />
          <SidebarSection label="Template Marketplace" collapsible={false}>
            <SidebarLink to="/$slug/tenant/browse-templates" params={{ slug }} icon={ShoppingBag}>Browse Catalog</SidebarLink>
            <SidebarLink to="/$slug/tenant/templates" params={{ slug }} icon={LibraryIcon}>Installed Templates</SidebarLink>
          </SidebarSection>
        </>
      }
    >
      <PageContainer>
        {hasChild ? (
          <Outlet />
        ) : (
        <>
        <RailBreadcrumbs items={RAIL_PAGES} activeKey={page} scopeLabel={`Tenant · ${tenant.name ?? tenant.slug}`} />
        <div className="mb-4 flex justify-end">
          <FirstReconWizard tenantSlug={tenant.slug} />
        </div>
        <PageGate tenantId={tenant.id} permission={currentPageDef?.permission ?? null} pageLabel={currentPageDef?.label ?? page}>
        {page === "access-explorer" && <AccessExplorer tenantId={tenant.id} />}
        {page === "governance" && <GovernanceApprovalQueue tenantId={tenant.id} tenantSlug={tenant.slug} />}
        {page === "settings" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Identity</CardTitle><CardDescription>Tenant URL and environment.</CardDescription></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{tenant.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Slug</span><code>/{tenant.slug}</code></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Environment</span><Badge variant="outline" className="uppercase">{tenant.environment}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Custom domain</span><span>{tenant.custom_domain ?? "—"}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Your role</CardTitle><CardDescription>What you can do here.</CardDescription></CardHeader>
              <CardContent><Badge>{tenant.role.replace("_", " ")}</Badge></CardContent>
            </Card>
            <ResidencyCard tenantId={tenant.id} region={tenant.region ?? "eu-west-1"} locked={!!tenant.residency_locked} canWrite={isAdmin} />
            {(isAdmin || permSet === null || permSet.has("tenant.settings.read")) && (
              <Card>
                <CardHeader><CardTitle>Additional administration tools</CardTitle><CardDescription>Specialist views for this tenant.</CardDescription></CardHeader>
                <CardContent className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  {isAdmin && <Link to="/$slug/tenant/admin" params={{ slug }} className="text-primary hover:underline">Administration controls</Link>}
                  {(permSet === null || permSet.has("tenant.settings.read")) && (
                    <Link to="/$slug/tenant/pipeline-status" params={{ slug }} className="text-primary hover:underline">Pipeline status</Link>
                  )}
                  {isAdmin && <Link to="/$slug/tenant/settings/domain" params={{ slug }} className="text-primary hover:underline">Domain tools</Link>}
                  {isAdmin && <Link to="/$slug/tenant/settings/scale" params={{ slug }} className="text-primary hover:underline">Scale tools</Link>}
                  {isAdmin && <Link to="/$slug/tenant/settings/verticals" params={{ slug }} className="text-primary hover:underline">Vertical tools</Link>}
                </CardContent>
              </Card>
            )}
          </div>
        )}
        {page === "connectors" && <ConnectorsTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "pipeline-status" && <Navigate to="/$slug/tenant/pipeline-status" params={{ slug }} search={{ page: "pipeline-status" }} replace />}
        {page === "channels" && <ChannelsTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "sso" && <SsoTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "ai-gov" && <AiGovernanceTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "ai-usage" && <AiUsageTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "usage-metering" && <UsageMeteringTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "modules" && <TenantModulesTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "features" && <FeatureFlagsTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "workspace-visibility" && <WorkspaceVisibilityTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "members" && <MembersTab tenantId={tenant.id} />}
        {page === "rbac-roles" && <RbacRolesTab tenantId={tenant.id} />}
        {page === "domains" && <TenantDomainsTab tenantId={tenant.id} />}
        {page === "groups" && <GroupsTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "people-analytics" && <TenantUserAnalyticsDashboard tenantId={tenant.id} />}
        {page === "business-units" && <BusinessUnitsTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "branding" && <BrandingTab tenantId={tenant.id} tenantSlug={tenant.slug} canWrite={isAdmin} />}
        {page === "api-docs" && <ApiDocsTab tenantSlug={tenant.slug} tenantName={tenant.name} />}
        {page === "ai" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>AI capabilities</CardTitle>
                <CardDescription>ReconIQ Studio works fully without AI. Turn on to unlock Copilot and agentic features.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between rounded-md border p-4">
                  <div>
                    <div className="font-medium">AI for this tenant</div>
                    <p className="text-sm text-muted-foreground">When on, configure a BYO-LLM provider below.</p>
                  </div>
                  <Switch aria-label="AI enabled for this tenant" checked={tenant.ai_enabled} disabled={!isAdmin || m.isPending} onCheckedChange={(v) => m.mutate(v)} />
                </div>
              </CardContent>
            </Card>
            {tenant.ai_enabled ? <LlmTab scope="tenant" tenantId={tenant.id} /> : null}
          </div>
        )}
        
        {page === "kb" && <NavigatorHub scope="tenant" tenantId={tenant.id} />}
        {page === "tickets" && <TicketsTab mode="tenant" tenantId={tenant.id} />}
        {page === "sla" && <SlaTab tenantId={tenant.id} />}
        {page === "reporting-map" && <ReportingMappingsTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "reporting-db" && <ReportingDbTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "scim" && <ScimTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "promo" && <EnvironmentDeliveryTab controlTenantId={tenant.id} />}
        {page === "security" && <SecurityTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "dora" && <DoraTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "vault" && <VaultTab scope="tenant" tenantId={tenant.id} />}
        {page === "byok" && <ByokTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "cmek" && <CmekTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "security-v2" && <SecurityV2Tab tenantId={tenant.id} />}
        {page === "resilience" && <ResilienceTab tenantId={tenant.id} isPlatformAdmin={tenant.role === "platform_admin"} />}
        {page === "webhooks" && <WebhooksTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "dev-platform" && <DevPlatformTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "chat-ops" && <ChatOpsTab tenantId={tenant.id} canWrite={isAdmin} tenantSlug={tenant.slug} />}
        {page === "residency" && <ResidencyTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "streaming" && <StreamingTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "gtm" && <GtmTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "agent-policies" && <AgentPoliciesTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "agent-review" && <AgentReviewQueue tenantId={tenant.id} canApprove={isAdmin} />}
        {page === "aidp-review" && <AidpReviewQueue tenantId={tenant.id} />}
        {page === "agent-workflows" && <AgentWorkflowDesignerTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "subprocessors" && <SubProcessorsTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "retention" && <RetentionTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "ip-allowlist" && <TenantIpAllowlistTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "dlp" && <TenantDlpTab tenantId={tenant.id} canWrite={isAdmin} />}
        {page === "audit" && (
          <Card>
            <CardHeader>
              <CardTitle>Tenant audit trail</CardTitle>
              <CardDescription>Hash-chained, append-only. Includes any actions taken by platform administrators inside this tenant.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-4 py-2">Time</th><th className="px-4 py-2">Actor</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Resource</th><th className="px-4 py-2">Via</th></tr>
                </thead>
                <tbody>
                  {(auditQ.data ?? []).map((r: any) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleString()}</td>
                      <td className="px-4 py-2 text-xs">{r.actor_email ?? "system"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.resource_type ?? ""}</td>
                      <td className="px-4 py-2 text-xs">{(r.context as any)?.via_platform_admin ? <Badge variant="outline">Platform admin</Badge> : null}</td>
                    </tr>
                  ))}
                  {auditQ.data && auditQ.data.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No events yet. Example: jane.doe@demo-bank.example · recon.run.completed · Demo Bank Nostro USD · 2026-06-26 06:17 UTC.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        {page === "recon-health" && <ReconHealthDashboard tenantId={tenant.id} />}
        {page === "worker-health" && <WorkerHealthTab tenantId={tenant.id} />}
        </PageGate>
        </>
        )}
      </PageContainer>

    </AppShell>
  );
}
