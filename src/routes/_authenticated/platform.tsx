import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listAllTenants,
  listFamilies,
  createFamily,
  createTenant,
  listSeedablePlatformPrincipals,
} from "@/lib/tenants.functions";
import {
  listPlatformUsers,
  findUserByEmail,
  grantPlatformRole,
  revokePlatformRole,
  updateTenant,
  verifyAuditChain,
  listAuditFiltered,
  createPlatformInvitation,
  listPlatformInvitations,
  revokePlatformInvitation,
  resendPlatformInvitation,
} from "@/lib/platform.functions";
import {
  listPlatformRoleRequests,
  decidePlatformRoleRequest,
} from "@/lib/platform-role-requests.functions";
import { AppShell, SidebarSection, SidebarLink } from "@/components/app-shell";
import { LeftRail, PageContainer, RailBreadcrumbs, type RailItem } from "@/components/left-rail";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Home, ShieldAlert, Plus, Building2, Pencil, Trash2, ShieldCheck, UserPlus, RefreshCw, CheckCircle2, XCircle, Users, BookOpen, LifeBuoy, GitBranch, Fingerprint, KeyRound, Shield, ToggleLeft, Activity, Github, Siren, Map as MapIcon, Upload, Gauge, Network, Inbox, Clock, Loader2, ExternalLink, AlertTriangle, Layers,
} from "lucide-react";
import { RoadmapDashboard } from "@/components/roadmap-dashboard";
import { BreakGlassTab } from "@/components/break-glass-tab";
import { StatusPageTab } from "@/components/status-page-tab";
import { toast } from "sonner";
import { LlmTab } from "@/components/llm-tab";
import { VaultTab } from "@/components/vault-tab";
import { NavigatorHub } from "@/components/navigator-hub";
import { TicketsTab } from "@/components/tickets-tab";
import { EnvironmentDeliveryTab } from "@/components/environment-delivery-tab";
import { PlatformAiGovernanceTab } from "@/components/platform-ai-governance-tab";
import { AiControlPlane } from "@/components/ai-control-plane";
import { GithubSyncTab } from "@/components/github-sync-tab";
import { ResidencyDashboard } from "@/components/residency-dashboard";
import { RlsAlertThresholdsPanel } from "@/components/rls-alert-thresholds-panel";
import { PlatformUserAnalyticsDashboard } from "@/components/user-analytics-dashboard";
import { PiiRedactionsTab } from "@/components/pii-redactions-tab";
import { WorkerHealthTab } from "@/components/worker-health-tab";
import { PlatformGroupsTab } from "@/components/platform-groups-tab";
import { PlatformAccessExplorerTab } from "@/components/platform-access-explorer-tab";
import { AuthProvidersTab } from "@/components/auth-providers-tab";
import { SessionsSecurityTab } from "@/components/sessions-security-tab";
import { PersonaJourneyScorecard } from "@/components/console/persona-journey-scorecard";
import { PlatformSoc2MonitorTab } from "@/components/platform-soc2-monitor-tab";
import { PlatformSessionAnomaliesTab } from "@/components/platform-session-anomalies-tab";
import { PlatformRbacDiagnosticsTab } from "@/components/platform-rbac-diagnostics-tab";

import { KbTemplatesGallery } from "@/components/kb-templates-gallery";
import { TemplateMarketplace } from "@/components/template-marketplace";
import { MarketplaceAnalyticsPanel } from "@/components/marketplace-analytics-panel";
import { ReconHealthDashboard } from "@/components/recon-health-dashboard";
import { PlatformMigrationsTab } from "@/components/platform-migrations-tab";
import { PlatformBenchmarksTab } from "@/components/platform-benchmarks-tab";
import { PlatformSchemaDriftTab } from "@/components/platform-schema-drift-tab";
import { PlatformPolicyAuditorTab } from "@/components/platform-policy-auditor-tab";
import { PlatformCrossReconTab } from "@/components/platform-cross-recon-tab";
import { SecurityAuditTab } from "@/components/security-audit-tab";
import { RolePermissionMatrixTab } from "@/components/role-permission-matrix";
import { PlatformSandboxTab } from "@/components/platform-sandbox-tab";
import { TenantBackupCadenceTab } from "@/components/tenant-backup-cadence-tab";
import { PlatformBackupPanel } from "@/routes/_authenticated/platform-backup";
import { PlatformModulesTab } from "@/components/platform-modules-tab";
import { OpsConsoleContent } from "@/routes/_authenticated/platform.ops-console";
import { GapClosureContent } from "@/routes/_authenticated/platform.gap-closure";
import { GAP_COUNT } from "@/lib/gap-closure.registry";
import { exportCsv, exportPdf, exportXlsxCols, type ExportColumn } from "@/lib/export-utils";
import { Download, FileText, DatabaseBackup, FlaskConical } from "lucide-react";
import { getPlatformSecretStatus } from "@/lib/platform-secret-status.functions";
import { TenantEmailDomainPanel } from "@/components/tenant-email-domain-panel";

const searchSchema = z.object({ page: z.string().optional() });

export const Route = createFileRoute("/_authenticated/platform")({
  validateSearch: searchSchema,
  component: PlatformPage,
});

// Platform destinations are grouped into six semantic sections; specialist
// pages remain available through contextual links and deep links.
// Groups are rendered as collapsible sections; the group containing the
// active page is auto-expanded.
const PAGES: RailItem[] = [
  // 1. Tenancy — who exists on the platform, what they get, where we're going
  { key: "tenants",         label: "Tenants",            icon: Building2,   group: "Tenancy" },
  { key: "families",        label: "Families",           icon: Building2,   group: "Tenancy" },
  { key: "modules",         label: "Modules & Features", icon: ToggleLeft,  group: "Tenancy" },
  { key: "sandbox-access",  label: "Sandbox access",     icon: FlaskConical, group: "Tenancy" },
  { key: "roadmap",         label: "Next Wave roadmap",  icon: MapIcon,     group: "Tenancy" },

  // 2. Identity & Access — who can do what, and how we verify it
  { key: "invitations",     label: "Invitations",        icon: UserPlus,    group: "Identity & Access" },
  { key: "rbac",            label: "Members & roles",    icon: Users,       group: "Identity & Access" },
  { key: "role-matrix",     label: "Role permissions",   icon: ShieldCheck, group: "Identity & Access" },
  { key: "auth-providers",  label: "Auth providers",     icon: Fingerprint, group: "Identity & Access" },
  { key: "groups",          label: "Groups",             icon: Users,       group: "Identity & Access" },
  { key: "access-explorer", label: "Access explorer",    icon: ShieldCheck, group: "Identity & Access" },
  { key: "rbac-diagnostics", label: "RBAC diagnostics",  icon: ShieldCheck, group: "Identity & Access" },
  { key: "user-analytics",  label: "User analytics",     icon: Activity,    group: "Identity & Access" },
  { key: "sessions-security", label: "Sessions & security", icon: ShieldCheck, group: "Identity & Access" },
  { key: "session-anomalies", label: "Session anomalies", icon: ShieldAlert, group: "Identity & Access" },



  // 3. AI Control Plane — providers, models, governance, routing, cost, vault, audit
  { key: "ai-control-plane", label: "AI Control Plane",   icon: Layers,       group: "AI Control Plane" },
  { key: "ai-gov-legacy",    label: "AI Governance (legacy)", icon: Shield,   group: "AI Control Plane" },
  { key: "llm-legacy",       label: "LLM providers (legacy)", icon: Fingerprint, group: "AI Control Plane" },

  // 4. Content & Support — knowledge and customer contact
  { key: "kb",              label: "Knowledge",          icon: BookOpen,    group: "Content & Support" },
  { key: "kb-templates",    label: "KB Templates",       icon: BookOpen,    group: "Content & Support" },
  { key: "tickets",         label: "Escalations",        icon: LifeBuoy,    group: "Content & Support" },

  // 5. Security & Compliance — audit, secrets, DLP, change control
  { key: "audit",           label: "Audit",              icon: ShieldCheck, group: "Security & Compliance" },
  { key: "security-audit",  label: "Security Audit",     icon: ShieldCheck, group: "Security & Compliance" },
  { key: "soc2-monitor",    label: "SOC 2 monitor",      icon: ShieldCheck, group: "Security & Compliance" },
  { key: "break-glass",     label: "Break-Glass",        icon: Siren,       group: "Security & Compliance" },
  { key: "vault",           label: "Vault (BYOK-KMS)",   icon: KeyRound,    group: "Security & Compliance" },
  { key: "secrets",         label: "Secrets (legacy env)", icon: KeyRound,  group: "Security & Compliance" },
  { key: "residency",       label: "Residency denials",  icon: ShieldAlert, group: "Security & Compliance" },
  { key: "pii-events",      label: "PII redactions",     icon: ShieldAlert, group: "Security & Compliance" },
  { key: "policy-auditor",  label: "Policy auditor",     icon: ShieldAlert, group: "Security & Compliance" },
  { key: "github",          label: "GitHub sync",        icon: Github,      group: "Security & Compliance" },
  { key: "promo",           label: "Environment & Delivery", icon: GitBranch, group: "Security & Compliance" },

  // 6. Reliability & Ops — the platform's own health
  { key: "status",          label: "Status page",        icon: Activity,    group: "Reliability & Ops" },
  { key: "recon-health",    label: "Recon health",       icon: Activity,    group: "Reliability & Ops" },
  { key: "worker-health",   label: "Worker health",      icon: Activity,    group: "Reliability & Ops" },
  { key: "migrations",      label: "Migrations",         icon: Upload,      group: "Reliability & Ops" },
  { key: "benchmarks",      label: "Benchmarks",         icon: Gauge,       group: "Reliability & Ops" },
  { key: "schema-drift",    label: "Schema drift",       icon: GitBranch,   group: "Reliability & Ops" },
  { key: "cross-recon",     label: "Cross-recon",        icon: Network,         group: "Reliability & Ops" },
  { key: "backup",          label: "Backup & recovery",  icon: DatabaseBackup,  group: "Reliability & Ops" },
  { key: "tenant-backups",  label: "Tenant backup SLA",  icon: DatabaseBackup,  group: "Reliability & Ops" },
  { key: "persona-journeys", label: "Persona journeys", icon: ShieldCheck, group: "Reliability & Ops" },
  { key: "ops-console",     label: "Ops console",        icon: Activity,    group: "Reliability & Ops" },
  { key: "gap-closure",     label: `Gap closure (${GAP_COUNT})`, icon: ShieldCheck, group: "Reliability & Ops" },
];

// Preserve specialist routes while keeping one canonical primary destination.
const PLATFORM_HIDDEN_FROM_PRIMARY_NAV = new Set([
  "roadmap", "rbac-diagnostics", "ai-gov-legacy", "llm-legacy",
  "secrets", "persona-journeys", "gap-closure",
  "role-matrix", "groups", "access-explorer",
  "migrations", "schema-drift", "github",
  "recon-health", "worker-health", "backup", "tenant-backups",
  "families", "sandbox-access", "session-anomalies", "kb-templates",
  "security-audit", "soc2-monitor", "policy-auditor",
]);
const PLATFORM_RAIL_PAGES = PAGES.filter((page) => !PLATFORM_HIDDEN_FROM_PRIMARY_NAV.has(page.key));

const PLATFORM_CONTEXT_SECTIONS = [
  {
    primary: "tenants",
    label: "Tenant management",
    pages: ["tenants", "families", "sandbox-access"],
  },
  {
    primary: "rbac",
    label: "Access management",
    pages: ["rbac", "role-matrix", "groups", "access-explorer"],
  },
  {
    primary: "sessions-security",
    label: "Auth and sessions",
    pages: ["sessions-security", "session-anomalies"],
  },
  {
    primary: "ai-control-plane",
    label: "AI Control Plane",
    pages: ["ai-control-plane", "ai-gov-legacy", "llm-legacy"],
  },
  {
    primary: "kb",
    label: "Knowledge",
    pages: ["kb", "kb-templates"],
  },
  {
    primary: "audit",
    label: "Audit and compliance",
    pages: ["audit", "security-audit", "soc2-monitor", "policy-auditor"],
  },
  {
    primary: "promo",
    label: "Environment & Delivery",
    pages: ["promo", "migrations", "schema-drift", "github"],
  },
  {
    primary: "status",
    label: "Reliability & Operations",
    pages: ["status", "recon-health", "worker-health", "backup", "tenant-backups"],
  },
] as const;

function PlatformPage() {
  const search = Route.useSearch();
  const page = search.page ?? "tenants";
  const contextSection = PLATFORM_CONTEXT_SECTIONS.find((section) =>
    section.pages.some((key) => key === page),
  );
  const activeRailPage = contextSection?.primary ?? page;
  return (
    <AppShell
      title="Platform administration"
      scope="platform"
      sidebar={
        <>
          <SidebarSection label="Account" collapsible={false}>
            <SidebarLink to="/home" icon={Home}>Home</SidebarLink>
          </SidebarSection>
          <SidebarSection label="Template Marketplace" collapsible={false}>
            <SidebarLink to="/platform" search={{ page: "template-marketplace" }} icon={Layers}>Platform Marketplace</SidebarLink>
            <SidebarLink to="/platform" search={{ page: "marketplace-analytics" }} icon={Activity}>Marketplace Analytics</SidebarLink>
          </SidebarSection>
          <LeftRail items={PLATFORM_RAIL_PAGES} activeKey={activeRailPage} defaultKey="tenants" storageScope="platform" basePath="/platform" />
        </>
      }
    >
      <PageContainer>
        <RailBreadcrumbs items={PAGES} activeKey={page} scopeLabel="Platform" />
        {contextSection ? <PlatformContextNav section={contextSection} activePage={page} /> : null}
        {page === "ops-console" && <OpsConsoleContent />}
        {page === "gap-closure" && <GapClosureContent />}
        {page === "tenants" && <TenantsTab />}
        {page === "families" && <FamiliesTab />}
        {page === "rbac" && <RbacTab />}
        {page === "role-matrix" && <RolePermissionMatrixTab />}
        {page === "invitations" && <PlatformInvitationsTab />}
        {page === "groups" && <PlatformGroupsTab />}
        {page === "access-explorer" && <PlatformAccessExplorerTab />}
        {page === "rbac-diagnostics" && <PlatformRbacDiagnosticsTab />}
        {page === "auth-providers" && <AuthProvidersTab />}
        {page === "sessions-security" && <SessionsSecurityTab />}
        {page === "session-anomalies" && <PlatformSessionAnomaliesTab />}

        {page === "user-analytics" && <PlatformUserAnalyticsDashboard />}
        {page === "ai-control-plane" && <AiControlPlane />}
        {page === "ai-gov-legacy" && <PlatformAiGovernanceTab />}
        {page === "entitlements" && <PlatformModulesTab />}
        {page === "modules" && <PlatformModulesTab />}
        {page === "llm-legacy" && <LlmTab scope="platform" />}
        {page === "kb" && <NavigatorHub scope="platform" />}
        {page === "kb-templates" && <KbTemplatesGallery />}
        {page === "template-marketplace" && <TemplateMarketplace scope={{ kind: "platform" }} />}
        {page === "marketplace-analytics" && <MarketplaceAnalyticsPanel />}
        {page === "tickets" && <TicketsTab mode="platform" />}
        {page === "promo" && <EnvironmentDeliveryTab />}
        {page === "vault" && <VaultTab scope="platform" />}
        {page === "secrets" && <SecretsTab />}
        {page === "break-glass" && <BreakGlassTab />}
        {page === "audit" && <AuditTab />}
        {page === "security-audit" && <SecurityAuditTab />}
        {page === "soc2-monitor" && <PlatformSoc2MonitorTab />}
        {page === "status" && <StatusPageTab canWrite={true} />}
        {page === "residency" && (
          <div className="space-y-6">
            <ResidencyDashboard />
            <RlsAlertThresholdsPanel />
          </div>
        )}
        {page === "pii-events" && <PiiRedactionsTab />}
        {page === "github" && <GithubSyncTab />}
        {page === "worker-health" && <WorkerHealthTab tenantId={null} />}
        {page === "recon-health" && <ReconHealthDashboard tenantId={null} />}
        {page === "roadmap" && <RoadmapDashboard canWrite={true} />}
        {page === "migrations" && <PlatformMigrationsTab />}
        {page === "benchmarks" && <PlatformBenchmarksTab />}
        {page === "schema-drift" && <PlatformSchemaDriftTab />}
        {page === "policy-auditor" && <PlatformPolicyAuditorTab />}
        {page === "cross-recon" && <PlatformCrossReconTab />}
        {page === "backup" && <PlatformBackupPanel showHeader={false} />}
        {page === "tenant-backups" && <TenantBackupCadenceTab />}
        {page === "sandbox-access" && <PlatformSandboxTab />}
        {page === "persona-journeys" && <PersonaJourneyScorecard />}
      </PageContainer>
    </AppShell>
  );
}

function PlatformContextNav({
  section,
  activePage,
}: {
  section: (typeof PLATFORM_CONTEXT_SECTIONS)[number];
  activePage: string;
}) {
  return (
    <nav aria-label={`${section.label} tools`} className="mb-5 rounded-xl border bg-card p-2 shadow-sm">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {section.label}
      </div>
      <div className="flex flex-wrap gap-1">
        {section.pages.map((key) => {
          const item = PAGES.find((candidate) => candidate.key === key)!;
          const Icon = item.icon;
          const active = key === activePage;
          return (
            <Link
              key={key}
              to="/platform"
              search={{ page: key }}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] ${
                active
                  ? "bg-[var(--brand-gold)] text-[#0e1a30]"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              style={
                active
                  ? { backgroundColor: "var(--brand-gold)", color: "#0e1a30" }
                  : undefined
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// (ShieldAlert is now used by the Residency Denials page.)


function SecretsTab() {
  const statusFn = useServerFn(getPlatformSecretStatus);
  const statusQ = useQuery({
    queryKey: ["platform-secret-presence"],
    queryFn: () => statusFn(),
  });
  const statuses = new Map<string, boolean>(
    (statusQ.data?.secrets ?? []).map((secret) => [secret.name, secret.configured]),
  );
  const items = [
    { name: "APP_DATA_ENC_KEY", purpose: "AES-256-GCM at-rest encryption for business data" },
    { name: "AUDIT_SIGNING_KEY", purpose: "HMAC signing of audit chain payloads" },
    { name: "PLATFORM_ADMIN_SEED_EMAIL", purpose: "First user with this email becomes platform admin" },
    { name: "LLM_PLATFORM_ANTHROPIC_SEED", purpose: "Platform Anthropic key (seed)" },
    { name: "FVI_AI_API_KEY", purpose: "Platform-managed default AI provider API key" },
    { name: "SLA_CRON_HMAC", purpose: "Signed SLA breach scanner endpoint" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Secrets & encryption</CardTitle>
        <CardDescription>Runtime presence only. Values remain in Cloudflare bindings and are never returned to the client.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">Secret name</th><th className="px-4 py-2">Purpose</th><th className="px-4 py-2">Status</th></tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.name} className="border-b">
                <td className="px-4 py-2 font-mono text-xs">{s.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{s.purpose}</td>
                <td className="px-4 py-2">
                  {statusQ.isPending ? <Badge variant="outline">checking</Badge>
                    : statusQ.isError ? <Badge variant="destructive">unavailable</Badge>
                    : statuses.get(s.name) ? <Badge>configured</Badge>
                    : <Badge variant="secondary">not configured</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {statusQ.data?.checked_at ? <p className="px-4 py-3 text-xs text-muted-foreground">Last checked {new Date(statusQ.data.checked_at).toLocaleString()}.</p> : null}
      </CardContent>
    </Card>
  );
}


/* ---------------- Tenants ---------------- */

function TenantsTab() {
  const qc = useQueryClient();
  const fetchTenants = useServerFn(listAllTenants);
  const fetchFamilies = useServerFn(listFamilies);
  const fetchSeedables = useServerFn(listSeedablePlatformPrincipals);
  const createTenantFn = useServerFn(createTenant);
  const updateTenantFn = useServerFn(updateTenant);

  const tenantsQ = useQuery({ queryKey: ["platform-tenants"], queryFn: () => fetchTenants() });
  const familiesQ = useQuery({ queryKey: ["platform-families"], queryFn: () => fetchFamilies() });

  const [tOpen, setTOpen] = useState(false);
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);
  const [tForm, setTForm] = useState({
    family_id: "",
    slug: "",
    name: "",
    email_domain: "",
    environment: "dev" as "dev" | "uat" | "prod",
    ai_enabled: false,
  });
  // Opt-out set of platform admins to NOT seed into the new tenant.
  const [excludedUserIds, setExcludedUserIds] = useState<Set<string>>(new Set());
  const [ephemeralAck, setEphemeralAck] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const EPHEMERAL_SLUG_RE = /(^|[-_])(test|demo|tmp|temp|sandbox|scratch)([-_]|$)/i;
  const looksEphemeral = EPHEMERAL_SLUG_RE.test(tForm.slug) || EPHEMERAL_SLUG_RE.test(tForm.name);

  // Tenant search + filter for role-management workflows
  const [tenantSearch, setTenantSearch] = useState("");
  const [envFilter, setEnvFilter] = useState<"all" | "dev" | "uat" | "prod">("all");
  const [familyFilter, setFamilyFilter] = useState<string>("all");


  const seedablesQ = useQuery({
    queryKey: ["platform-seedable-principals"],
    queryFn: () => fetchSeedables(),
    enabled: tOpen,
    staleTime: 60_000,
  });

  const mTenant = useMutation({
    mutationFn: () =>
      createTenantFn({
        data: { ...tForm, excluded_user_ids: Array.from(excludedUserIds) },
      }),
    onSuccess: (res: any) => {
      const skipped = res?.seed_excluded_count ?? 0;
      toast.success(
        skipped > 0
          ? `Tenant created — ${skipped} platform admin${skipped === 1 ? "" : "s"} excluded from auto-seed`
          : "Tenant created",
      );
      setTOpen(false);
      setCreatedTenantId(res.id);
      setTForm({ family_id: "", slug: "", name: "", email_domain: "", environment: "dev", ai_enabled: false });
      setExcludedUserIds(new Set());
      setEphemeralAck(false);
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      qc.invalidateQueries({ queryKey: ["platform-families"] });
      qc.invalidateQueries({ queryKey: ["my-tenants"] });
    },
    onError: () => toast.error("Could not create the tenant. Check the details and try again, or contact platform support."),
  });

  const mUpdate = useMutation({
    mutationFn: (input: any) => updateTenantFn({ data: input }),
    onSuccess: () => {
      toast.success("Tenant updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleExcluded = (userId: string) =>
    setExcludedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const admins = seedablesQ.data?.admins ?? [];
  const groups = seedablesQ.data?.groups ?? [];
  const seedCount = admins.filter((a: any) => a.is_creator || !excludedUserIds.has(a.user_id)).length;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">All tenants</h2>
          <p className="text-sm text-muted-foreground">Pooled multi-tenant deployment, environment-tagged.</p>
        </div>
        <Dialog open={tOpen} onOpenChange={setTOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-1 h-4 w-4" /> New tenant</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader><DialogTitle>Create tenant</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Family</Label>
                <Select value={tForm.family_id} onValueChange={(v) => setTForm((f) => ({ ...f, family_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="e.g. Demo Financial Group" /></SelectTrigger>
                  <SelectContent>
                    {(familiesQ.data ?? []).map((fam: any) => (
                      <SelectItem key={fam.id} value={fam.id}>{fam.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Display name</Label>
                <Input value={tForm.name} onChange={(e) => setTForm((f) => ({ ...f, name: e.target.value }))} placeholder="Demo Bank — Production" />
              </div>
              <div>
                <Label>URL slug</Label>
                <Input value={tForm.slug} onChange={(e) => setTForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))} placeholder="demo-bank-prod" />
                <p className="mt-1 text-xs text-muted-foreground">Reached at <code>/{tForm.slug || "your-slug"}/workspace</code>.</p>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <Label htmlFor="tenant-email-domain" className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Approved signup email domain</Label>
                <Input
                  id="tenant-email-domain"
                  className="mt-2"
                  type="text"
                  autoComplete="off"
                  inputMode="url"
                  maxLength={253}
                  value={tForm.email_domain}
                  onChange={(e) => setTForm((f) => ({ ...f, email_domain: e.target.value.trim().toLowerCase() }))}
                  placeholder="jpmorgan.com"
                  aria-describedby="tenant-email-domain-help"
                />
                <p id="tenant-email-domain-help" className="mt-2 text-xs text-muted-foreground">
                  Enter the organization’s email domain, without @ or www. Domain ownership must be verified before matching signups can request access. Each request still needs tenant admin approval.
                </p>
                {tForm.email_domain && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(tForm.email_domain) ? (
                  <p role="alert" className="mt-1 text-xs text-destructive">Enter a valid email domain, such as example.com.</p>
                ) : null}
              </div>
              <div>
                <Label>Environment</Label>
                <Select value={tForm.environment} onValueChange={(v) => setTForm((f) => ({ ...f, environment: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dev">Dev</SelectItem>
                    <SelectItem value="uat">UAT</SelectItem>
                    <SelectItem value="prod">Production</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>Enable AI</Label>
                  <p className="text-xs text-muted-foreground">Tenant can configure BYO-LLM and use Copilot.</p>
                </div>
                <Switch checked={tForm.ai_enabled} onCheckedChange={(v) => setTForm((f) => ({ ...f, ai_enabled: v }))} />
              </div>

              {/* Auto-seeded platform access preview + override */}
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <Label className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" /> Auto-seeded platform access
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      These platform admins receive <code>tenant_admin</code> on the new tenant. Uncheck anyone you want to exclude.
                    </p>
                  </div>
                  <Badge variant="outline">{seedCount} will be seeded</Badge>
                </div>

                {seedablesQ.isLoading ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">Loading…</p>
                ) : admins.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    No platform admins found. Only you (the creator) will be seeded.
                  </p>
                ) : (
                  <>
                    {groups.length > 0 ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {groups.map((g: any) => (
                          <Badge key={g.id} variant="outline" className="text-[10px]">
                            {g.name} · {g.member_count} member{g.member_count === 1 ? "" : "s"}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="max-h-56 overflow-y-auto rounded border bg-background">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 text-left uppercase text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1.5 w-8">Seed</th>
                            <th className="px-2 py-1.5">Admin</th>
                            <th className="px-2 py-1.5">Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {admins.map((a: any) => {
                            const seeded = a.is_creator || !excludedUserIds.has(a.user_id);
                            return (
                              <tr key={a.user_id} className="border-t">
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    aria-label={`Seed ${a.email ?? a.user_id}`}
                                    className="h-3.5 w-3.5"
                                    checked={seeded}
                                    disabled={a.is_creator}
                                    onChange={() => toggleExcluded(a.user_id)}
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <div className="font-medium">{a.email ?? a.user_id.slice(0, 8)}</div>
                                  {a.full_name ? (
                                    <div className="text-[10px] text-muted-foreground">{a.full_name}</div>
                                  ) : null}
                                </td>
                                <td className="px-2 py-1.5">
                                  <div className="flex flex-wrap gap-1">
                                    {a.is_creator ? (
                                      <Badge variant="default" className="text-[10px]">creator</Badge>
                                    ) : null}
                                    {a.is_direct ? (
                                      <Badge variant="secondary" className="text-[10px]">direct</Badge>
                                    ) : null}
                                    {a.via_group_names.map((gn: string) => (
                                      <Badge key={gn} variant="outline" className="text-[10px]">
                                        {gn}
                                      </Badge>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Tip: To change defaults globally, edit membership in Platform → Groups. The creator is always seeded.
                    </p>
                  </>
                )}
              </div>

              {looksEphemeral ? (
                <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="flex-1">
                      <p className="font-medium text-amber-900 dark:text-amber-200">
                        This looks like a test / demo / sandbox tenant.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Per policy, only production tenants may persist. If you are running a
                        one-off check, you MUST delete this tenant in the same session.
                      </p>
                      <label className="mt-2 flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={ephemeralAck}
                          onChange={(e) => setEphemeralAck(e.target.checked)}
                        />
                        <span>I will delete this tenant before ending my session.</span>
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              <Button
                className="w-full"
                disabled={
                  !tForm.family_id || !tForm.slug || !tForm.name || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(tForm.email_domain) || mTenant.isPending ||
                  (looksEphemeral && !ephemeralAck)
                }
                onClick={() => mTenant.mutate()}
              >
                Create tenant
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {createdTenantId ? (
        <div className="mb-4 space-y-2">
          <p className="text-sm font-medium">Tenant created. Complete the email domain proof below before signup requests can be routed.</p>
          <TenantEmailDomainPanel tenantId={createdTenantId} />
          <Button size="sm" variant="outline" asChild><Link to="/platform/tenants/$id" params={{ id: createdTenantId }}>Open tenant details</Link></Button>
        </div>
      ) : null}


      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-2 md:grid-cols-[1fr_180px_220px_auto]">
            <Input
              placeholder="Search tenants by name or slug…"
              value={tenantSearch}
              onChange={(e) => setTenantSearch(e.target.value)}
            />
            <Select value={envFilter} onValueChange={(v) => setEnvFilter(v as any)}>
              <SelectTrigger><SelectValue placeholder="Environment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All environments</SelectItem>
                <SelectItem value="dev">Dev</SelectItem>
                <SelectItem value="uat">UAT</SelectItem>
                <SelectItem value="prod">Prod</SelectItem>
              </SelectContent>
            </Select>
            <Select value={familyFilter} onValueChange={setFamilyFilter}>
              <SelectTrigger><SelectValue placeholder="Family" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All families</SelectItem>
                {(familiesQ.data ?? []).map((f: any) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost" size="sm"
              onClick={() => { setTenantSearch(""); setEnvFilter("all"); setFamilyFilter("all"); }}
            >Clear</Button>
          </div>
        </CardContent>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Family</th>
                <th className="px-4 py-3">Env</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">AI</th>
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(() => {
                if (tenantsQ.isLoading) {
                  return <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading tenants…</td></tr>;
                }
                if (tenantsQ.isError) {
                  return <tr><td colSpan={7} className="px-4 py-10 text-center" role="alert">
                    <p>Tenant list temporarily unavailable. Your access has not necessarily changed.</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => { void tenantsQ.refetch(); }}>Retry tenant list</Button>
                  </td></tr>;
                }
                const needle = tenantSearch.trim().toLowerCase();
                const rows = ((tenantsQ.data ?? []) as any[]).filter((t: any) => {
                  const textOk = !needle
                    || String(t.name ?? "").toLowerCase().includes(needle)
                    || String(t.slug ?? "").toLowerCase().includes(needle)
                    || String(t.custom_domain ?? "").toLowerCase().includes(needle);
                  const envOk = envFilter === "all" || t.environment === envFilter;
                  const famOk = familyFilter === "all" || t.family?.id === familyFilter || t.family_id === familyFilter;
                  return textOk && envOk && famOk;
                });
                if (rows.length === 0) {
                  return (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      {(tenantsQ.data?.length ?? 0) === 0
                        ? "No tenants yet. Create a family (e.g. “Demo Financial Group”) then a tenant (e.g. “Demo Bank NA”, slug demo-bank-na)."
                        : "No tenants match the current search or filters."}
                    </td></tr>
                  );
                }
                return rows.map((t: any) => (
                  <tr key={t.id} className="border-b">
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.family?.name}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="uppercase">{t.environment}</Badge></td>
                    <td className="px-4 py-3 font-mono text-xs">/{t.slug}</td>
                    <td className="px-4 py-3">{t.ai_enabled ? <Badge>On</Badge> : <Badge variant="outline">Off</Badge>}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{t.custom_domain ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Button asChild variant="ghost" size="icon" title="Open detail">
                        <Link to="/platform/tenants/$id" params={{ id: t.id }}>
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditing({ ...t })} title="Quick edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </CardContent>
      </Card>


      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit tenant</DialogTitle></DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div>
                <Label>Display name</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>Custom domain</Label>
                <Input
                  value={editing.custom_domain ?? ""}
                  onChange={(e) => setEditing({ ...editing, custom_domain: e.target.value })}
                  placeholder="recon.demo-bank.example"
                />
                <p className="mt-1 text-xs text-muted-foreground">Leave blank to use the default slug path.</p>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>AI enabled</Label>
                  <p className="text-xs text-muted-foreground">Toggle BYO-LLM &amp; Copilot for this tenant.</p>
                </div>
                <Switch checked={!!editing.ai_enabled} onCheckedChange={(v) => setEditing({ ...editing, ai_enabled: v })} />
              </div>
              <DialogFooter>
                <Button
                  disabled={mUpdate.isPending}
                  onClick={() => mUpdate.mutate({
                    tenant_id: editing.id,
                    name: editing.name,
                    custom_domain: editing.custom_domain || null,
                    ai_enabled: editing.ai_enabled,
                  })}
                >
                  Save changes
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------------- Families ---------------- */

function FamiliesTab() {
  const qc = useQueryClient();
  const fetchFamilies = useServerFn(listFamilies);
  const createFamilyFn = useServerFn(createFamily);
  const familiesQ = useQuery({ queryKey: ["platform-families"], queryFn: () => fetchFamilies() });

  const [famName, setFamName] = useState("");
  const [famOpen, setFamOpen] = useState(false);

  const mFamily = useMutation({
    mutationFn: (name: string) => createFamilyFn({ data: { name } }),
    onSuccess: () => {
      toast.success("Family created");
      setFamName(""); setFamOpen(false);
      qc.invalidateQueries({ queryKey: ["platform-families"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Tenant families</h2>
          <p className="text-sm text-muted-foreground">Each family can hold one Dev, one UAT and one Prod sibling.</p>
        </div>
        <Dialog open={famOpen} onOpenChange={setFamOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> New family</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create family</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Label>Family name</Label>
              <Input value={famName} onChange={(e) => setFamName(e.target.value)} placeholder="Demo Bank NA" />
              <Button className="w-full" disabled={!famName || mFamily.isPending} onClick={() => mFamily.mutate(famName)}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(familiesQ.data ?? []).map((f: any) => (
          <Card key={f.id}>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2"><Building2 className="h-4 w-4" /> {f.name}</CardTitle>
              <CardDescription>{f.tenants?.length ?? 0} tenant(s)</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {(f.tenants ?? []).map((t: any) => (
                <Badge key={t.id} variant="outline" className="uppercase">{t.environment}</Badge>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ---------------- Platform RBAC ---------------- */

function RbacTab() {
  const qc = useQueryClient();
  const fetchUsers = useServerFn(listPlatformUsers);
  const findFn = useServerFn(findUserByEmail);
  const grantFn = useServerFn(grantPlatformRole);
  const revokeFn = useServerFn(revokePlatformRole);

  const usersQ = useQuery({ queryKey: ["platform-users"], queryFn: () => fetchUsers() });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"platform_admin" | "platform_member" | "platform_super_admin">("platform_member");
  const [lookup, setLookup] = useState<any | null>(null);

  const mFind = useMutation({
    mutationFn: () => findFn({ data: { email } }),
    onSuccess: (res) => {
      if (!res) toast.error("No user with that email has signed up yet.");
      setLookup(res);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const mGrant = useMutation({
    mutationFn: (uid: string) => grantFn({ data: { user_id: uid, role } }),
    onSuccess: () => {
      toast.success("Role granted");
      setLookup(null); setEmail("");
      qc.invalidateQueries({ queryKey: ["platform-users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const mRevoke = useMutation({
    mutationFn: (v: { user_id: string; role: "platform_admin" | "platform_member" | "platform_super_admin" }) => revokeFn({ data: v }),
    onSuccess: () => {
      toast.success("Role revoked");
      qc.invalidateQueries({ queryKey: ["platform-users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Grant a platform role</CardTitle>
          <CardDescription>
            The user must have signed in at least once. Platform admins manage the entire deployment; platform members are read-only operators.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <div>
              <Label>User email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane.doe@demo-bank.example" />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform_super_admin">Platform super admin</SelectItem>
                  <SelectItem value="platform_admin">Platform admin</SelectItem>
                  <SelectItem value="platform_member">Platform member</SelectItem>
                </SelectContent>

              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => mFind.mutate()} disabled={!email || mFind.isPending} variant="secondary">
                Look up
              </Button>
            </div>
          </div>

          {lookup ? (
            <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
              <div className="text-sm">
                <div className="font-medium">{lookup.full_name ?? "(no name)"}</div>
                <div className="text-xs text-muted-foreground">{lookup.email}</div>
              </div>
              <Button size="sm" disabled={mGrant.isPending} onClick={() => mGrant.mutate(lookup.id)}>
                Grant {role.replace("platform_", "")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <PlatformRoleRequestsPanel />



      <Card>
        <CardHeader>
          <CardTitle>Platform users</CardTitle>
          <CardDescription>Everyone with a platform-level role. Filter by name, email, or role.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <RbacUserSearch users={(usersQ.data ?? []) as any[]} onRevoke={(v) => mRevoke.mutate(v)} isRevoking={mRevoke.isPending} />
        </CardContent>
      </Card>
    </div>
  );
}

function RbacUserSearch({
  users,
  onRevoke,
  isRevoking,
}: {
  users: any[];
  onRevoke: (v: { user_id: string; role: "platform_admin" | "platform_member" | "platform_super_admin" }) => void;
  isRevoking: boolean;
}) {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "platform_admin" | "platform_member" | "platform_super_admin">("all");

  const needle = q.trim().toLowerCase();
  const filtered = users.filter((u) => {
    const email = String(u.profile?.email ?? u.user_id).toLowerCase();
    const name = String(u.profile?.full_name ?? "").toLowerCase();
    const matchesText = !needle || email.includes(needle) || name.includes(needle);
    const matchesRole = roleFilter === "all" || (u.roles ?? []).includes(roleFilter);
    return matchesText && matchesRole;
  });
  return (
    <>
      <div className="grid gap-2 md:grid-cols-[1fr_220px]">
        <Input
          placeholder="Search by name or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="platform_super_admin">Platform super admin</SelectItem>
            <SelectItem value="platform_admin">Platform admin</SelectItem>
            <SelectItem value="platform_member">Platform member</SelectItem>
          </SelectContent>

        </Select>
      </div>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const isOwner =
                String(u.profile?.email ?? "").toLowerCase() ===
                "joseph.ferdinand@reconiq.example";
              return (
              <tr key={u.user_id} className="border-b">
                <td className="px-4 py-3 font-medium">
                  {u.profile?.full_name ?? "—"}
                  {isOwner ? (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Owner · locked</Badge>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{u.profile?.email ?? u.user_id}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r: string) => (
                      <Badge key={r} variant={r === "platform_admin" || r === "platform_super_admin" ? "default" : "outline"}>{r.replace("platform_", "")}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {isOwner ? (
                      <span className="text-xs text-muted-foreground italic">Protected</span>
                    ) : (
                      u.roles.map((r: string) => (
                        <Button
                          key={r}
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={isRevoking}
                          onClick={() => onRevoke({ user_id: u.user_id, role: r as any })}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> {r.replace("platform_", "")}
                        </Button>
                      ))
                    )}
                  </div>
                </td>
              </tr>
              );
            })}

            {filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                {users.length === 0 ? "No platform users yet." : "No users match the current filter."}
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}


/* ---------------- Audit ---------------- */

function AuditTab() {
  const qc = useQueryClient();
  const fetchAudit = useServerFn(listAuditFiltered);
  const verifyFn = useServerFn(verifyAuditChain);

  type SortCol = "occurred_at" | "actor_email" | "tenant_slug" | "action" | "scope";
  const [filters, setFilters] = useState<{
    scope?: "platform" | "tenant" | "workspace";
    action_prefix?: string;
    actor_email?: string;
    tenant_slug?: string;
    since?: string;
    until?: string;
    limit: number;
    offset: number;
    sort_column: SortCol;
    sort_dir: "asc" | "desc";
  }>({ limit: 100, offset: 0, sort_column: "occurred_at", sort_dir: "desc" });

  const auditQ = useQuery({
    queryKey: ["platform-audit", filters],
    queryFn: () => fetchAudit({ data: filters }),
  });

  const rows = (auditQ.data?.rows ?? []) as any[];
  const total = auditQ.data?.total ?? 0;

  const exportCols: ExportColumn<any>[] = [
    { key: "occurred_at", header: "When", value: (r) => new Date(r.occurred_at).toISOString() },
    { key: "actor_email", header: "Actor", value: (r) => r.actor_email ?? "system" },
    { key: "scope", header: "Scope" },
    { key: "action", header: "Action" },
    { key: "tenant_slug", header: "Tenant", value: (r) => r.tenant_slug ?? "" },
    { key: "resource_type", header: "Resource type", value: (r) => r.resource_type ?? "" },
    { key: "resource_id", header: "Resource ID", value: (r) => r.resource_id ?? "" },
    { key: "context", header: "Context", value: (r) => JSON.stringify(r.context ?? {}) },
  ];

  const subtitle = [
    filters.scope ? `scope=${filters.scope}` : null,
    filters.tenant_slug ? `tenant~${filters.tenant_slug}` : null,
    filters.action_prefix ? `action~${filters.action_prefix}%` : null,
    filters.actor_email ? `actor~${filters.actor_email}` : null,
    filters.since ? `since=${filters.since.slice(0,16).replace('T',' ')}Z` : null,
    filters.until ? `until=${filters.until.slice(0,16).replace('T',' ')}Z` : null,
    `sort=${filters.sort_column} ${filters.sort_dir}`,
    `page=${Math.floor(filters.offset / filters.limit) + 1} of ${Math.max(1, Math.ceil(total / filters.limit))}`,
    `total=${total}`,
  ].filter(Boolean).join(" · ");

  const mVerify = useMutation({
    mutationFn: () => verifyFn({ data: { limit: 10000 } }),
    onSuccess: (res) => {
      if (res.ok) toast.success(`Hash chain verified — ${res.verified_rows} rows, no tampering detected.`);
      else toast.error(`Chain broken at audit id ${res.first_bad_id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const evidence = mVerify.data && !mVerify.data.ok ? (mVerify.data as any).evidence : null;

  const sortHeader = (col: SortCol, label: string) => {
    const active = filters.sort_column === col;
    const nextDir: "asc" | "desc" = active && filters.sort_dir === "desc" ? "asc" : "desc";
    return (
      <th
        className="cursor-pointer select-none px-4 py-2 hover:text-foreground"
        onClick={() => setFilters((f) => ({ ...f, sort_column: col, sort_dir: nextDir, offset: 0 }))}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active ? <span className="text-[10px]">{filters.sort_dir === "asc" ? "▲" : "▼"}</span> : null}
        </span>
      </th>
    );
  };

  const dateStamp = new Date().toISOString().slice(0, 10);
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const currentPage = Math.floor(filters.offset / filters.limit) + 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Immutable audit trail</CardTitle>
            <CardDescription>Hash-chained. Server-side paginated & sortable. Updates and deletes blocked at database level.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["platform-audit"] })}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button
              variant="outline" size="sm" disabled={!rows.length}
              onClick={() => exportCsv(`audit-log-${dateStamp}.csv`, exportCols, rows)}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> CSV
            </Button>
            <Button
              variant="outline" size="sm" disabled={!rows.length}
              onClick={() => exportXlsxCols(`audit-log-${dateStamp}.xlsx`, "Audit", exportCols, rows)}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> XLSX
            </Button>
            <Button
              variant="outline" size="sm" disabled={!rows.length}
              onClick={() => exportPdf(`audit-log-${dateStamp}.pdf`, "Immutable audit trail", subtitle, exportCols, rows)}
            >
              <FileText className="mr-1 h-3.5 w-3.5" /> PDF
            </Button>
            <Button size="sm" disabled={mVerify.isPending} onClick={() => mVerify.mutate()}>
              {mVerify.data?.ok ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> : mVerify.data && !mVerify.data.ok ? <XCircle className="mr-1 h-3.5 w-3.5" /> : <ShieldCheck className="mr-1 h-3.5 w-3.5" />}
              {mVerify.isPending ? "Verifying…" : "Verify chain"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {mVerify.data?.ok ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mr-1 inline h-4 w-4" />
              Chain verified at {new Date((mVerify.data as any).verified_at).toLocaleString()} — {(mVerify.data as any).verified_rows} rows inspected.
            </div>
          ) : null}
          {evidence ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-destructive">
                <ShieldAlert className="h-4 w-4" /> Tamper detected — first compromised row #{mVerify.data!.first_bad_id}
              </div>
              <div className="text-xs text-muted-foreground">{evidence.diagnosis}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Compromised row</Label>
                  <pre className="overflow-auto rounded bg-muted/60 p-2 text-[10px] leading-relaxed max-h-64">
{JSON.stringify(evidence.compromised_row, null, 2)}
                  </pre>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Previous row in chain</Label>
                  <pre className="overflow-auto rounded bg-muted/60 p-2 text-[10px] leading-relaxed max-h-64">
{JSON.stringify(evidence.previous_row, null, 2)}
                  </pre>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-3 text-[11px] font-mono">
                <div><div className="text-muted-foreground mb-0.5">Expected prev_hash</div><div className="break-all">{evidence.expected_prev_hash_hex || "—"}</div></div>
                <div><div className="text-muted-foreground mb-0.5">Stored prev_hash</div><div className="break-all">{evidence.stored_prev_hash_hex || "—"}</div></div>
                <div><div className="text-muted-foreground mb-0.5">Stored row_hash</div><div className="break-all">{evidence.stored_row_hash_hex || "—"}</div></div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expected payload (SHA-256 input)</Label>
                <pre className="overflow-auto rounded bg-muted/60 p-2 text-[10px] leading-relaxed max-h-32 break-all whitespace-pre-wrap">{evidence.expected_payload}</pre>
              </div>
              <div className="text-xs text-muted-foreground">
                Evidence captured at {new Date((mVerify.data as any).verified_at).toLocaleString()}. The verification event itself was appended to the chain as <code>audit.chain.verify</code>.
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label>Scope</Label>
              <Select
                value={filters.scope ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, scope: v === "all" ? undefined : (v as any), offset: 0 }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All scopes</SelectItem>
                  <SelectItem value="platform">Platform</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                  <SelectItem value="workspace">Workspace</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tenant slug contains</Label>
              <Input
                placeholder="demo-bank"
                value={filters.tenant_slug ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, tenant_slug: e.target.value || undefined, offset: 0 }))}
              />
            </div>
            <div>
              <Label>Action prefix</Label>
              <Input
                placeholder="e.g. tenant.demo-bank-na.scope"
                value={filters.action_prefix ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, action_prefix: e.target.value || undefined, offset: 0 }))}
              />
            </div>
            <div>
              <Label>Actor email contains</Label>
              <Input
                placeholder="jane.doe@demo-bank.example"
                value={filters.actor_email ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, actor_email: e.target.value || undefined, offset: 0 }))}
              />
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div>
              <Label>From (UTC)</Label>
              <Input
                type="datetime-local"
                value={filters.since ? filters.since.slice(0, 16) : ""}
                onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value ? new Date(e.target.value).toISOString() : undefined, offset: 0 }))}
              />
            </div>
            <div>
              <Label>To (UTC)</Label>
              <Input
                type="datetime-local"
                value={filters.until ? filters.until.slice(0, 16) : ""}
                onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value ? new Date(e.target.value).toISOString() : undefined, offset: 0 }))}
              />
            </div>
            <div>
              <Label>Rows per page</Label>
              <Select
                value={String(filters.limit)}
                onValueChange={(v) => setFilters((f) => ({ ...f, limit: Number(v), offset: 0 }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200, 500].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant="outline" size="sm"
                disabled={filters.offset === 0 || auditQ.isFetching}
                onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}
              >Previous</Button>
              <div className="text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}<br/>
                <span className="text-[10px]">{total.toLocaleString()} total</span>
              </div>
              <Button
                variant="outline" size="sm"
                disabled={currentPage >= totalPages || auditQ.isFetching}
                onClick={() => setFilters((f) => ({ ...f, offset: f.offset + f.limit }))}
              >Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                {sortHeader("occurred_at", "Time")}
                {sortHeader("actor_email", "Actor")}
                {sortHeader("scope", "Scope")}
                {sortHeader("action", "Action")}
                {sortHeader("tenant_slug", "Tenant")}
                <th className="px-4 py-2">Resource</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs">{r.actor_email ?? "system"}</td>
                  <td className="px-4 py-2"><Badge variant="outline">{r.scope}</Badge></td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2 text-xs">{r.tenant_slug ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.resource_type ?? ""}
                    {r.resource_id ? <span className="ml-1 font-mono opacity-60">{String(r.resource_id).slice(0, 8)}</span> : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !auditQ.isFetching ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No audit events match the current filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}


/* =====================================================================
   Platform Invitations Tab
   Designed by 5-agent review:
     • Orchestrator      — one page, Pending / Accepted / Revoked segmented view
     • Security Architect — 14-day TTL, revoke, resend, audit-logged, RLS-gated
     • UX Researcher     — role presets, inline validation, empty states
     • Visual Designer   — status chips (amber pending, emerald accepted, rose revoked)
     • Systems Engineer  — auto-consumed by DB trigger on first sign-in
   ===================================================================== */
function PlatformInvitationsTab() {
  const qc = useQueryClient();
  const inviteFn = useServerFn(createPlatformInvitation);
  const listFn = useServerFn(listPlatformInvitations);
  const revokeInvFn = useServerFn(revokePlatformInvitation);
  const resendFn = useServerFn(resendPlatformInvitation);

  const invsQ = useQuery({ queryKey: ["platform-invitations"], queryFn: () => listFn() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    email: string;
    full_name: string;
    role: "platform_admin" | "platform_member";
    message: string;
    send_email: boolean;
  }>({ email: "", full_name: "", role: "platform_member", message: "", send_email: true });
  const [filter, setFilter] = useState<"pending" | "accepted" | "revoked" | "expired" | "all">("pending");

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const mInvite = useMutation({
    mutationFn: () =>
      inviteFn({
        data: {
          email: form.email.trim(),
          full_name: form.full_name.trim() || undefined,
          role: form.role,
          message: form.message.trim() || undefined,
          send_email: form.send_email,
        },
      }),
    onSuccess: (res: any) => {
      if (res.status === "already_member") toast.info("That user already holds this role.");
      else if (res.status === "granted_existing_user")
        toast.success("User already exists — role granted directly.");
      else {
        toast.success(
          res.email_sent
            ? "Invitation sent by email."
            : "Invitation created (email delivery skipped or failed — see audit log).",
        );
      }
      setOpen(false);
      setForm({ email: "", full_name: "", role: "platform_member", message: "", send_email: true });
      qc.invalidateQueries({ queryKey: ["platform-invitations"] });
      qc.invalidateQueries({ queryKey: ["platform-users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const mRevoke = useMutation({
    mutationFn: (id: string) => revokeInvFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Invitation revoked");
      qc.invalidateQueries({ queryKey: ["platform-invitations"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const mResend = useMutation({
    mutationFn: (id: string) => resendFn({ data: { id } }),
    onSuccess: (res: any) => {
      toast.success(res.email_sent ? "Invitation re-sent" : "Invitation refreshed (email skipped)");
      qc.invalidateQueries({ queryKey: ["platform-invitations"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rows = (invsQ.data ?? []) as any[];
  const counts = {
    pending: rows.filter((r) => r.status === "pending").length,
    accepted: rows.filter((r) => r.status === "accepted").length,
    revoked: rows.filter((r) => r.status === "revoked").length,
    expired: rows.filter((r) => r.status === "expired").length,
    all: rows.length,
  };
  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const statusStyles: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
    accepted: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
    revoked: "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300",
    expired: "bg-muted text-muted-foreground border-muted-foreground/20",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Platform invitations
            </CardTitle>
            <CardDescription>
              Invite new platform admins or members by email. If they already have an account, the role
              is granted immediately. Otherwise the role is applied automatically the moment they sign in.
              Invitations expire after 14 days.
            </CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Invite someone</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Invite to the platform</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>Full name</Label>
                  <Input
                    autoFocus
                    placeholder="Jane Doe"
                    value={form.full_name}
                    maxLength={120}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used as their display name until they update their profile.
                  </p>
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="jane.doe@demo-bank.example"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                  {form.email && !emailValid ? (
                    <p className="mt-1 text-xs text-destructive">Enter a valid email address.</p>
                  ) : null}
                </div>
                <div>
                  <Label>Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="platform_member">Platform member — read-only operator</SelectItem>
                      <SelectItem value="platform_admin">Platform admin — full deployment control</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Personal note (optional)</Label>
                  <textarea
                    className="mt-1 flex min-h-[70px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="Welcome to the ReconIQ platform team — this gives you break-glass access to tenant support."
                    maxLength={2000}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Send invitation email</div>
                    <div className="text-xs text-muted-foreground">
                      Uses Supabase Auth to deliver a signed sign-up link.
                    </div>
                  </div>
                  <Switch
                    checked={form.send_email}
                    onCheckedChange={(v) => setForm({ ...form, send_email: v })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  disabled={!emailValid || mInvite.isPending}
                  onClick={() => mInvite.mutate()}
                >
                  <UserPlus className="mr-1 h-4 w-4" /> Send invitation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["pending", "accepted", "expired", "revoked", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs capitalize transition ${
                  filter === f
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                {f} <span className="ml-1 opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Invitee</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Invited</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b align-top">
                    <td className="px-4 py-3 font-medium">
                      {r.full_name ? (
                        <>
                          <div>{r.full_name}</div>
                          <div className="text-xs font-normal text-muted-foreground">{r.email}</div>
                        </>
                      ) : (
                        r.email
                      )}
                      {r.message ? (
                        <div className="mt-1 max-w-[380px] truncate text-xs text-muted-foreground" title={r.message}>
                          “{r.message}”
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={r.role === "platform_admin" ? "default" : "outline"}>
                        {r.role.replace("platform_", "")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize ${statusStyles[r.status]}`}>
                        {r.status === "accepted" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
                        {r.status === "revoked" ? <XCircle className="mr-1 h-3 w-3" /> : null}
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                      {r.inviter?.email ? <div className="opacity-70">by {r.inviter.email}</div> : null}
                      {r.send_count > 1 ? <div className="opacity-70">sent ×{r.send_count}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.accepted_at
                        ? <span className="text-emerald-600">accepted {new Date(r.accepted_at).toLocaleDateString()}</span>
                        : r.revoked_at
                          ? <span>revoked</span>
                          : <>{new Date(r.expires_at).toLocaleDateString()}</>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.status === "pending" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={mResend.isPending}
                            onClick={() => mResend.mutate(r.id)}
                          >
                            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Resend
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={mRevoke.isPending}
                            onClick={() => mRevoke.mutate(r.id)}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Revoke
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      No {filter === "all" ? "" : filter} invitations.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- Platform role requests (self-serve elevation) ---------------- */

function PlatformRoleRequestsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPlatformRoleRequests);
  const decideFn = useServerFn(decidePlatformRoleRequest);

  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "denied" | "cancelled" | "all">("pending");
  const [denyOpenId, setDenyOpenId] = useState<string | null>(null);
  const [denyNote, setDenyNote] = useState("");
  const [approveNote, setApproveNote] = useState("");

  const q = useQuery({
    queryKey: ["platform-role-requests", statusFilter],
    queryFn: () => listFn({ data: { status: statusFilter } }),
  });

  const rows = (q.data ?? []) as any[];

  const mDecide = useMutation({
    mutationFn: (v: { request_id: string; decision: "approved" | "denied"; note?: string }) =>
      decideFn({ data: v }),
    onSuccess: (_r, vars) => {
      toast.success(vars.decision === "approved" ? "Access granted" : "Request denied");
      setDenyOpenId(null);
      setDenyNote("");
      setApproveNote("");
      qc.invalidateQueries({ queryKey: ["platform-role-requests"] });
      qc.invalidateQueries({ queryKey: ["platform-users"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to decide request"),
  });

  const pendingCount = statusFilter === "pending"
    ? rows.length
    : rows.filter((r) => r.status === "pending").length;

  const statusBadgeFor = (status: string) => {
    const map: Record<string, { label: string; cls: string; Icon: any }> = {
      pending:   { label: "Pending",   cls: "border-amber-500/60 text-amber-600",       Icon: Clock },
      approved:  { label: "Approved",  cls: "border-emerald-500/60 text-emerald-600",   Icon: CheckCircle2 },
      denied:    { label: "Denied",    cls: "border-destructive/60 text-destructive",   Icon: XCircle },
      cancelled: { label: "Cancelled", cls: "border-muted-foreground/40 text-muted-foreground", Icon: XCircle },
    };
    const m = map[status] ?? map.pending;
    const Icon = m.Icon;
    return <Badge variant="outline" className={`gap-1 ${m.cls}`}><Icon className="h-3 w-3" /> {m.label}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-4 w-4" /> Role elevation requests
              {pendingCount > 0 ? (
                <Badge variant="destructive" className="ml-1">{pendingCount} pending</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Self-serve requests from platform admins asking for the <code className="rounded bg-muted px-1 py-0.5 text-xs">platform_super_admin</code> tier. Every decision is recorded to the platform audit log.
            </CardDescription>
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading requests…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No {statusFilter === "all" ? "" : statusFilter} role requests.
          </div>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Requester</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.requester?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.requester?.email ?? r.requester_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{String(r.requested_role).replace("platform_", "")}</Badge>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <div className="whitespace-pre-wrap text-xs text-muted-foreground">{r.reason}</div>
                      {r.decision_note ? (
                        <div className="mt-1 text-xs text-foreground">
                          <span className="font-medium">Note: </span>{r.decision_note}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {statusBadgeFor(r.status)}
                      {r.decided_at ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          by {r.decider?.email ?? r.decided_by ?? "—"}<br />
                          {new Date(r.decided_at).toLocaleString()}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.status === "pending" ? (
                        <div className="flex justify-end gap-1">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="default" disabled={mDecide.isPending}>
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Approve elevation to Super Admin</DialogTitle>
                                <DialogDescription>
                                  This will immediately grant <code>{r.requested_role}</code> to <strong>{r.requester?.email ?? r.requester_id}</strong>. The grant, decision, and note are written to the audit log.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-2">
                                <Label>Optional note</Label>
                                <Textarea rows={3} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="Approved to cover PTO through 2026-07-15…" maxLength={2000} />
                              </div>
                              <DialogFooter>
                                <Button
                                  disabled={mDecide.isPending}
                                  onClick={() => mDecide.mutate({ request_id: r.id, decision: "approved", note: approveNote.trim() || undefined })}
                                >
                                  {mDecide.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                  Approve & grant
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                          <Dialog open={denyOpenId === r.id} onOpenChange={(o) => { setDenyOpenId(o ? r.id : null); if (!o) setDenyNote(""); }}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={mDecide.isPending}>
                                <XCircle className="mr-1 h-3.5 w-3.5" /> Deny
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Deny request</DialogTitle>
                                <DialogDescription>
                                  Reason for denial is recorded on the request and in the audit log.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-2">
                                <Label>Denial reason</Label>
                                <Textarea rows={3} value={denyNote} onChange={(e) => setDenyNote(e.target.value)} placeholder="Please open a Break Glass request instead…" maxLength={2000} />
                              </div>
                              <DialogFooter>
                                <Button
                                  variant="destructive"
                                  disabled={mDecide.isPending}
                                  onClick={() => mDecide.mutate({ request_id: r.id, decision: "denied", note: denyNote.trim() || undefined })}
                                >
                                  {mDecide.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                  Deny request
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
