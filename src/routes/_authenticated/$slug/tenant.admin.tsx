// ─────────────────────────────────────────────────────────────────────────────
// Tenant Administration Console — unified surface for the T-1…T-34 build wave.
//   URL: /:slug/tenant/admin
//   Tabs: Overview, Workspaces, Teams, Access Reviews, Conditional Access,
//         Risk Auth, Vault Approvals, Rotation, Emails, Notifications,
//         Maintenance, Compliance, Policy Compliance, Reports.
//   All server calls use tenant-admin.functions and enforce tenant admin RLS.
// ─────────────────────────────────────────────────────────────────────────────
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listWorkspaces, upsertWorkspace, workspaceLifecycle,
  listTeams, upsertTeam,
  listAccessReviewCampaigns, upsertAccessReviewCampaign,
  listConditionalAccessRules, upsertConditionalAccessRule,
  getRiskAuthPolicy, upsertRiskAuthPolicy,
  listSecretApprovals, decideSecretAccess,
  listRotationPolicies, upsertRotationPolicy,
  listEmailTemplates, upsertEmailTemplate,
  listNotificationChannels, upsertNotificationChannel,
  listMaintenanceWindows, upsertMaintenanceWindow,
  getComplianceProfile, upsertComplianceProfile,
  listPolicyCompliance, upsertPolicyCompliance,
  listDashboardScores, recomputeDashboardScores,
  listReportDefinitions, upsertReportDefinition,
} from "@/lib/tenant-admin.functions";
import { renderReport, runRotationScan } from "@/lib/tenant-admin-batch2.functions";
import { REPORT_DEFINITION_FORMATS, reportFormatLabel, type ReportDefinitionFormat } from "@/lib/report-export-formats";
import { WorkspaceFeaturesPanel } from "@/components/workspace-features-panel";
import { EntitlementsAdmin } from "@/components/entitlements-admin";
import { AiControlPlane } from "@/components/ai-control-plane";
import { SignupAdmissionsTab } from "@/components/signup-admissions-tab";
import { Layers } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { LeftRail, PageContainer, RailBreadcrumbs, type RailItem } from "@/components/left-rail";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, Users, KeyRound, Bell, Wrench, Building2, ClipboardCheck, Activity, FileText, Fingerprint, AlarmClock, Palette, ScrollText, BarChart3, UserCheck } from "lucide-react";

const parent = getRouteApi("/_authenticated/$slug");

const searchSchema = z.object({ page: z.string().optional() });

export const Route = createFileRoute("/_authenticated/$slug/tenant/admin")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Tenant Administration — ReconIQ" },
      { name: "description", content: "Enterprise tenant administration console: workspaces, teams, access reviews, conditional access, vault approvals, compliance, and reports." },
    ],
  }),
  component: TenantAdminPage,
});

// Consolidated Tenant IA — 17 tabs regrouped into seven business-friendly
// sections. Rendered by the shared LeftRail component which enforces
// single-open accordion behavior across the whole administration surface.
const TENANT_PAGES: RailItem[] = [
  // 1. Overview — at-a-glance posture
  { key: "overview",           label: "Overview",              icon: BarChart3,      group: "Overview" },

  // 2. Organization — workspaces & teams
  { key: "workspaces",         label: "Workspaces",            icon: Building2,      group: "Organization" },
  { key: "teams",              label: "Teams",                 icon: Users,          group: "Organization" },
  { key: "workspace-features", label: "Workspace features",    icon: Palette,        group: "Organization" },

  // 3. Identity & Access — governance of who can do what
  { key: "signup-admissions", label: "Signup admissions", icon: UserCheck, group: "Identity & Access" },
  { key: "access-reviews",     label: "Access reviews",        icon: ClipboardCheck, group: "Identity & Access" },
  { key: "conditional",        label: "Conditional access",    icon: ShieldCheck,    group: "Identity & Access" },
  { key: "risk-auth",          label: "Risk-based auth",       icon: Fingerprint,    group: "Identity & Access" },

  // 4. Secrets & Vault — privileged credential control
  { key: "vault-approvals",    label: "Vault approvals",       icon: KeyRound,       group: "Secrets & Vault" },
  { key: "rotation",           label: "Rotation policies",     icon: AlarmClock,     group: "Secrets & Vault" },

  // 5. Communications — user-facing messaging
  { key: "emails",             label: "Email templates",       icon: Palette,        group: "Communications" },
  { key: "notifications",      label: "Notification channels", icon: Bell,           group: "Communications" },

  // 6. Governance & Compliance — controls + audit posture
  { key: "compliance",         label: "Regional compliance",   icon: ScrollText,     group: "Governance & Compliance" },
  { key: "policy",             label: "Policy compliance",     icon: Activity,       group: "Governance & Compliance" },
  { key: "reports",            label: "Report library",        icon: FileText,       group: "Governance & Compliance" },

  // 7. Platform — cross-cutting entitlements + AI control
  { key: "entitlements",       label: "Features & modules",    icon: ShieldCheck,    group: "Platform" },
  { key: "ai-cp",              label: "AI Control Plane",      icon: Layers,         group: "Platform" },
  { key: "maintenance",        label: "Maintenance windows",   icon: Wrench,         group: "Platform" },
];

function TenantAdminPage() {
  const { tenant } = parent.useLoaderData() as any;
  const tenantId = tenant?.id as string;
  const tenantName = tenant?.name as string | undefined;
  const search = Route.useSearch();
  const page = search.page ?? "overview";

  if (tenant?.role !== "tenant_admin" && tenant?.role !== "platform_admin") {
    return <div role="alert" className="mx-auto max-w-xl p-8 text-sm text-muted-foreground">Tenant administration requires administrator access.</div>;
  }

  return (
    <AppShell
      title="Tenant Administration"
      sidebar={
        <LeftRail
          items={TENANT_PAGES}
          activeKey={page}
          defaultKey="overview"
          storageScope="tenant-admin"
          basePath={`/${tenant.slug}/tenant/admin`}
        />
      }
    >
      <PageContainer>
        <RailBreadcrumbs items={TENANT_PAGES} activeKey={page} scopeLabel="Tenant" />
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Tenant Administration</h1>
          <p className="text-sm text-muted-foreground">
            Enterprise governance for {tenantName ?? "this tenant"} — organization, identity, secrets, communications, compliance, and platform controls.
          </p>
        </div>

        {page === "overview" && <OverviewTab tenantId={tenantId} />}
        {page === "workspaces" && <WorkspacesTab tenantId={tenantId} />}
        {page === "teams" && <TeamsTab tenantId={tenantId} />}
        {page === "workspace-features" && <WorkspaceFeaturesPanel tenantId={tenantId} />}
        {page === "signup-admissions" && <SignupAdmissionsTab tenantId={tenantId} />}
        {page === "access-reviews" && <AccessReviewsTab tenantId={tenantId} />}
        {page === "conditional" && <ConditionalAccessTab tenantId={tenantId} />}
        {page === "risk-auth" && <RiskAuthTab tenantId={tenantId} />}
        {page === "vault-approvals" && <VaultApprovalsTab tenantId={tenantId} />}
        {page === "rotation" && <RotationTab tenantId={tenantId} />}
        {page === "emails" && <EmailsTab tenantId={tenantId} />}
        {page === "notifications" && <NotificationsTab tenantId={tenantId} />}
        {page === "maintenance" && <MaintenanceTab tenantId={tenantId} />}
        {page === "compliance" && <ComplianceProfileTab tenantId={tenantId} />}
        {page === "policy" && <PolicyComplianceTab tenantId={tenantId} />}
        {page === "reports" && <ReportsTab tenantId={tenantId} />}
        {page === "entitlements" && (
          <EntitlementsAdmin mode="tenant" tenantId={tenantId} tenantName={tenantName} />
        )}
        {page === "ai-cp" && <AiControlPlane tenantId={tenantId} />}
      </PageContainer>
    </AppShell>
  );
}

// ────────────────────── OVERVIEW ─────────────────────────────────────────────
function OverviewTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listDashboardScores);
  const recomputeFn = useServerFn(recomputeDashboardScores);
  const { data: scores } = useQuery({
    queryKey: ["dashboard-scores", tenantId],
    queryFn: () => listFn({ data: { tenantId } }),
  });
  const recompute = useMutation({
    mutationFn: () => recomputeFn({ data: { tenantId } }),
    onSuccess: () => { toast.success("Scores recomputed"); qc.invalidateQueries({ queryKey: ["dashboard-scores", tenantId] }); },
  });

  const scoreMap = new Map((scores ?? []).map((s: any) => [s.score_key, s]));
  const security = scoreMap.get("security");
  const compliance = scoreMap.get("compliance");

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Security score</CardTitle><CardDescription>MFA %, vault approvals, rotations due</CardDescription></CardHeader>
          <CardContent><div className="text-4xl font-bold">{security?.score_value ?? "—"}<span className="text-lg text-muted-foreground"> / 100</span></div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Compliance score</CardTitle><CardDescription>Policy control status</CardDescription></CardHeader>
          <CardContent><div className="text-4xl font-bold">{compliance?.score_value ?? "—"}<span className="text-lg text-muted-foreground"> / 100</span></div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recompute</CardTitle><CardDescription>Refresh rollups now</CardDescription></CardHeader>
          <CardContent><Button onClick={() => recompute.mutate()} disabled={recompute.isPending}>Recompute scores</Button></CardContent>
        </Card>
      </div>
    </div>
  );
}

// ────────────────────── WORKSPACES ───────────────────────────────────────────
function WorkspacesTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listWorkspaces);
  const upsertFn = useServerFn(upsertWorkspace);
  const lifecycleFn = useServerFn(workspaceLifecycle);
  const { data: rows } = useQuery({ queryKey: ["workspaces", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "" });
  const create = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, ...form } as any }),
    onSuccess: () => { toast.success("Workspace created"); setOpen(false); qc.invalidateQueries({ queryKey: ["workspaces", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const lc = useMutation({
    mutationFn: (v: { id: string; action: any }) => lifecycleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces", tenantId] }),
  });

  return (
    <div className="mt-4 space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Multi-workspace lifecycle for this tenant.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>New workspace</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create workspace</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Slug</Label><Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(rows ?? []).map((w: any) => (
          <Card key={w.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="font-semibold">{w.name} <Badge variant="secondary" className="ml-2">{w.status}</Badge></div>
                <div className="text-xs text-muted-foreground">{w.slug} · {w.region ?? "—"} · {w.department ?? "—"}</div>
              </div>
              <div className="flex gap-2">
                {w.status === "active" && <Button size="sm" variant="outline" onClick={() => lc.mutate({ id: w.id, action: "suspend" })}>Suspend</Button>}
                {w.status !== "archived" && <Button size="sm" variant="outline" onClick={() => lc.mutate({ id: w.id, action: "archive" })}>Archive</Button>}
                {w.status !== "active" && <Button size="sm" variant="outline" onClick={() => lc.mutate({ id: w.id, action: "restore" })}>Restore</Button>}
              </div>
            </CardContent>
          </Card>
        ))}
        {(!rows || rows.length === 0) && <p className="text-sm text-muted-foreground">No workspaces yet.</p>}
      </div>
    </div>
  );
}

// ────────────────────── TEAMS ────────────────────────────────────────────────
function TeamsTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listTeams);
  const upsertFn = useServerFn(upsertTeam);
  const { data: rows } = useQuery({ queryKey: ["teams", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "" });
  const create = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, ...form } as any }),
    onSuccess: () => { toast.success("Team created"); setOpen(false); qc.invalidateQueries({ queryKey: ["teams", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mt-4 space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">First-class teams with nested membership.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>New team</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create team</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Slug</Label><Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(rows ?? []).map((t: any) => (
          <Card key={t.id}><CardContent className="p-4"><div className="font-semibold">{t.name}</div><div className="text-xs text-muted-foreground">{t.slug}</div></CardContent></Card>
        ))}
        {(!rows || rows.length === 0) && <p className="text-sm text-muted-foreground">No teams yet.</p>}
      </div>
    </div>
  );
}

// ────────────────────── ACCESS REVIEWS ───────────────────────────────────────
function AccessReviewsTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAccessReviewCampaigns);
  const upsertFn = useServerFn(upsertAccessReviewCampaign);
  const { data: rows } = useQuery({ queryKey: ["arc", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", scope: "tenant" as any, dueAt: "" });
  const create = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, name: form.name, scope: form.scope, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null } as any }),
    onSuccess: () => { toast.success("Campaign created"); setOpen(false); qc.invalidateQueries({ queryKey: ["arc", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mt-4 space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Recurring access certification with reviewer assignment + evidence trail.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>New campaign</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New access review campaign</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Scope</Label>
                <Select value={form.scope} onValueChange={v => setForm({ ...form, scope: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="tenant">Tenant</SelectItem><SelectItem value="workspace">Workspace</SelectItem><SelectItem value="team">Team</SelectItem><SelectItem value="role">Role</SelectItem><SelectItem value="entitlement">Entitlement</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Due at</Label><Input type="datetime-local" value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(rows ?? []).map((c: any) => (
          <Card key={c.id}><CardContent className="p-4">
            <div className="flex justify-between"><div className="font-semibold">{c.name}</div><Badge>{c.status}</Badge></div>
            <div className="text-xs text-muted-foreground">Scope: {c.scope} · Due: {c.due_at ? new Date(c.due_at).toLocaleString() : "—"}</div>
          </CardContent></Card>
        ))}
        {(!rows || rows.length === 0) && <p className="text-sm text-muted-foreground">No campaigns yet.</p>}
      </div>
    </div>
  );
}

// ────────────────────── CONDITIONAL ACCESS ───────────────────────────────────
function ConditionalAccessTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listConditionalAccessRules);
  const upsertFn = useServerFn(upsertConditionalAccessRule);
  const { data: rows } = useQuery({ queryKey: ["car", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", action: "step_up" as any, priority: 100, isEnabled: true });
  const create = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, name: form.name, action: form.action, priority: form.priority, isEnabled: form.isEnabled } as any }),
    onSuccess: () => { toast.success("Rule saved"); setOpen(false); qc.invalidateQueries({ queryKey: ["car", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mt-4 space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Rule engine gating access based on geo, device posture, time-of-day and risk score.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>New rule</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New conditional access rule</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Action</Label>
                <Select value={form.action} onValueChange={v => setForm({ ...form, action: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="allow">Allow</SelectItem><SelectItem value="deny">Deny</SelectItem><SelectItem value="step_up">Step-up</SelectItem><SelectItem value="session_limit">Session limit</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Priority</Label><Input type="number" value={form.priority} onChange={e => setForm({ ...form, priority: parseInt(e.target.value || "100") })} /></div>
              <div className="flex items-center gap-2"><Switch checked={form.isEnabled} onCheckedChange={v => setForm({ ...form, isEnabled: v })} /><Label>Enabled</Label></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(rows ?? []).map((r: any) => (
          <Card key={r.id}><CardContent className="p-4">
            <div className="flex justify-between"><div className="font-semibold">{r.name}</div><div className="flex gap-2"><Badge>{r.action}</Badge><Badge variant={r.is_enabled ? "default" : "secondary"}>{r.is_enabled ? "on" : "off"}</Badge></div></div>
            <div className="text-xs text-muted-foreground">Priority {r.priority}</div>
          </CardContent></Card>
        ))}
        {(!rows || rows.length === 0) && <p className="text-sm text-muted-foreground">No rules yet.</p>}
      </div>
    </div>
  );
}

// ────────────────────── RISK AUTH ────────────────────────────────────────────
function RiskAuthTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getRiskAuthPolicy);
  const upsertFn = useServerFn(upsertRiskAuthPolicy);
  const { data: pol } = useQuery({ queryKey: ["rap", tenantId], queryFn: () => getFn({ data: { tenantId } }) });
  const [form, setForm] = useState({
    isEnabled: true, lowThreshold: 30, mediumThreshold: 60, highThreshold: 80, blockAction: "deny" as any,
  });
  const save = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, ...form, stepUpMethods: ["totp", "webauthn"] } as any }),
    onSuccess: () => { toast.success("Risk policy saved"); qc.invalidateQueries({ queryKey: ["rap", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>Adaptive / risk-based auth</CardTitle><CardDescription>Score-driven step-up and block thresholds.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2"><Switch checked={form.isEnabled} onCheckedChange={v => setForm({ ...form, isEnabled: v })} /><Label>Enabled</Label></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Low ≤</Label><Input type="number" value={form.lowThreshold} onChange={e => setForm({ ...form, lowThreshold: parseInt(e.target.value || "30") })} /></div>
            <div><Label>Medium ≤</Label><Input type="number" value={form.mediumThreshold} onChange={e => setForm({ ...form, mediumThreshold: parseInt(e.target.value || "60") })} /></div>
            <div><Label>High &gt;</Label><Input type="number" value={form.highThreshold} onChange={e => setForm({ ...form, highThreshold: parseInt(e.target.value || "80") })} /></div>
          </div>
          <div><Label>Block action</Label>
            <Select value={form.blockAction} onValueChange={v => setForm({ ...form, blockAction: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="deny">Deny</SelectItem><SelectItem value="challenge">Challenge</SelectItem><SelectItem value="notify_admin">Notify admin</SelectItem></SelectContent>
            </Select>
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save policy</Button>
          {pol && <div className="text-xs text-muted-foreground">Current: low ≤{pol.low_threshold}, med ≤{pol.medium_threshold}, high &gt;{pol.high_threshold}</div>}
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────── VAULT APPROVALS ──────────────────────────────────────
function VaultApprovalsTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSecretApprovals);
  const decideFn = useServerFn(decideSecretAccess);
  const { data: rows } = useQuery({ queryKey: ["saa", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "deny" }) => decideFn({ data: v }),
    onSuccess: () => { toast.success("Decision recorded"); qc.invalidateQueries({ queryKey: ["saa", tenantId] }); },
  });
  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm text-muted-foreground">N-eyes approval queue for privileged vault access.</p>
      {(rows ?? []).map((r: any) => (
        <Card key={r.id}><CardContent className="p-4 flex justify-between items-center">
          <div>
            <div className="font-semibold">Secret {r.secret_id.slice(0, 8)} · <Badge>{r.status}</Badge></div>
            <div className="text-xs text-muted-foreground">Reason: {r.reason} · Approvals {(r.approvals?.length ?? 0)}/{r.required_approvals}</div>
          </div>
          {r.status === "pending" && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: "approve" })}>Approve</Button>
              <Button size="sm" variant="destructive" onClick={() => decide.mutate({ id: r.id, decision: "deny" })}>Deny</Button>
            </div>
          )}
        </CardContent></Card>
      ))}
      {(!rows || rows.length === 0) && <p className="text-sm text-muted-foreground">No approval requests.</p>}
    </div>
  );
}

// ────────────────────── ROTATION ─────────────────────────────────────────────
function RotationTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listRotationPolicies);
  const upsertFn = useServerFn(upsertRotationPolicy);
  const { data: rows } = useQuery({ queryKey: ["srp", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [form, setForm] = useState({ category: "llm_api_key", rotationIntervalDays: 90, autoRotate: false, alertDaysBefore: 14 });
  const create = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, ...form } as any }),
    onSuccess: () => { toast.success("Policy saved"); qc.invalidateQueries({ queryKey: ["srp", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>New rotation policy</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-4 gap-3">
          <div><Label>Category</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></div>
          <div><Label>Interval (days)</Label><Input type="number" value={form.rotationIntervalDays} onChange={e => setForm({ ...form, rotationIntervalDays: parseInt(e.target.value || "90") })} /></div>
          <div><Label>Alert (days before)</Label><Input type="number" value={form.alertDaysBefore} onChange={e => setForm({ ...form, alertDaysBefore: parseInt(e.target.value || "14") })} /></div>
          <div className="flex items-center gap-2 mt-6"><Switch checked={form.autoRotate} onCheckedChange={v => setForm({ ...form, autoRotate: v })} /><Label>Auto-rotate</Label></div>
          <div className="col-span-4"><Button onClick={() => create.mutate()} disabled={create.isPending}>Save policy</Button></div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {(rows ?? []).map((r: any) => (
          <Card key={r.id}><CardContent className="p-4">
            <div className="flex justify-between"><div className="font-semibold">{r.category ?? "(secret)"} · every {r.rotation_interval_days}d</div><Badge>{r.auto_rotate ? "auto" : "manual"}</Badge></div>
            <div className="text-xs text-muted-foreground">Next: {r.next_rotation_at ? new Date(r.next_rotation_at).toLocaleString() : "—"}</div>
          </CardContent></Card>
        ))}
        {(!rows || rows.length === 0) && <p className="text-sm text-muted-foreground">No policies yet.</p>}
      </div>
    </div>
  );
}

// ────────────────────── EMAILS ───────────────────────────────────────────────
function EmailsTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listEmailTemplates);
  const upsertFn = useServerFn(upsertEmailTemplate);
  const { data: rows } = useQuery({ queryKey: ["tet", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [form, setForm] = useState({ eventKey: "invitation", subject: "", htmlBody: "" });
  const save = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, ...form } as any }),
    onSuccess: () => { toast.success("Template saved"); qc.invalidateQueries({ queryKey: ["tet", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>Branded email templates</CardTitle><CardDescription>Invitation, MFA, password reset, digests.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Event</Label>
            <Select value={form.eventKey} onValueChange={v => setForm({ ...form, eventKey: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="invitation">Invitation</SelectItem>
                <SelectItem value="mfa_challenge">MFA challenge</SelectItem>
                <SelectItem value="password_reset">Password reset</SelectItem>
                <SelectItem value="notification_digest">Notification digest</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Subject</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
          <div><Label>HTML body</Label><Textarea rows={6} value={form.htmlBody} onChange={e => setForm({ ...form, htmlBody: e.target.value })} /></div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {(rows ?? []).map((t: any) => (
          <Card key={t.id}><CardContent className="p-4">
            <div className="font-semibold">{t.event_key} <Badge variant="secondary">v{t.version}</Badge></div>
            <div className="text-xs text-muted-foreground truncate">{t.subject}</div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}

// ────────────────────── NOTIFICATIONS ────────────────────────────────────────
function NotificationsTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listNotificationChannels);
  const upsertFn = useServerFn(upsertNotificationChannel);
  const { data: rows } = useQuery({ queryKey: ["tnc", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const save = useMutation({
    mutationFn: (v: { channel: string; isEnabled: boolean; digestSchedule: string }) =>
      upsertFn({ data: { tenantId, ...v } as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tnc", tenantId] }),
  });
  const channels = ["email", "sms", "push", "inapp", "slack", "webhook"];
  const byChannel = new Map((rows ?? []).map((r: any) => [r.channel, r]));
  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm text-muted-foreground">Per-channel governance + digest scheduling.</p>
      {channels.map((ch) => {
        const r: any = byChannel.get(ch);
        return (
          <Card key={ch}><CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold capitalize">{ch}</div>
              <div className="text-xs text-muted-foreground">Digest: {r?.digest_schedule ?? "realtime"}</div>
            </div>
            <div className="flex items-center gap-3">
              <Select value={r?.digest_schedule ?? "realtime"} onValueChange={v => save.mutate({ channel: ch, isEnabled: r?.is_enabled ?? true, digestSchedule: v })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="realtime">Realtime</SelectItem><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent>
              </Select>
              <Switch checked={r?.is_enabled ?? true} onCheckedChange={v => save.mutate({ channel: ch, isEnabled: v, digestSchedule: r?.digest_schedule ?? "realtime" })} />
            </div>
          </CardContent></Card>
        );
      })}
    </div>
  );
}

// ────────────────────── MAINTENANCE ──────────────────────────────────────────
function MaintenanceTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMaintenanceWindows);
  const upsertFn = useServerFn(upsertMaintenanceWindow);
  const { data: rows } = useQuery({ queryKey: ["tmw", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [form, setForm] = useState({ title: "", startsAt: "", endsAt: "", bannerSeverity: "info" as any, blockWrites: false });
  const create = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, title: form.title, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), bannerSeverity: form.bannerSeverity, blockWrites: form.blockWrites } as any }),
    onSuccess: () => { toast.success("Window scheduled"); qc.invalidateQueries({ queryKey: ["tmw", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>Schedule maintenance window</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label>Starts at</Label><Input type="datetime-local" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} /></div>
          <div><Label>Ends at</Label><Input type="datetime-local" value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })} /></div>
          <div><Label>Severity</Label>
            <Select value={form.bannerSeverity} onValueChange={v => setForm({ ...form, bannerSeverity: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 mt-6"><Switch checked={form.blockWrites} onCheckedChange={v => setForm({ ...form, blockWrites: v })} /><Label>Block writes</Label></div>
          <div className="col-span-2"><Button onClick={() => create.mutate()} disabled={create.isPending}>Schedule</Button></div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {(rows ?? []).map((m: any) => (
          <Card key={m.id}><CardContent className="p-4">
            <div className="flex justify-between"><div className="font-semibold">{m.title}</div><Badge>{m.status}</Badge></div>
            <div className="text-xs text-muted-foreground">{new Date(m.starts_at).toLocaleString()} → {new Date(m.ends_at).toLocaleString()}</div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}

// ────────────────────── COMPLIANCE PROFILE ───────────────────────────────────
function ComplianceProfileTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getComplianceProfile);
  const upsertFn = useServerFn(upsertComplianceProfile);
  const { data: p } = useQuery({ queryKey: ["tcp", tenantId], queryFn: () => getFn({ data: { tenantId } }) });
  const save = useMutation({
    mutationFn: (payload: any) => upsertFn({ data: { tenantId, ...payload } as any }),
    onSuccess: () => { toast.success("Profile saved"); qc.invalidateQueries({ queryKey: ["tcp", tenantId] }); },
  });
  const toggle = (key: string, val: boolean) =>
    save.mutate({
      gdprEnabled: p?.gdpr_enabled ?? false, ccpaEnabled: p?.ccpa_enabled ?? false,
      doraEnabled: p?.dora_enabled ?? false, piplEnabled: p?.pipl_enabled ?? false,
      hipaaEnabled: p?.hipaa_enabled ?? false, soc2Enabled: p?.soc2_enabled ?? true,
      iso27001Enabled: p?.iso27001_enabled ?? false,
      [key]: val,
    });
  const items = [
    ["gdprEnabled", "GDPR", p?.gdpr_enabled],
    ["ccpaEnabled", "CCPA", p?.ccpa_enabled],
    ["doraEnabled", "DORA", p?.dora_enabled],
    ["piplEnabled", "PIPL", p?.pipl_enabled],
    ["hipaaEnabled", "HIPAA", p?.hipaa_enabled],
    ["soc2Enabled", "SOC 2", p?.soc2_enabled],
    ["iso27001Enabled", "ISO 27001", p?.iso27001_enabled],
  ] as const;
  return (
    <div className="mt-4 space-y-3">
      <Card>
        <CardHeader><CardTitle>Regional compliance profile</CardTitle><CardDescription>Drives downstream retention, residency and notification defaults.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          {items.map(([k, l, v]) => (
            <div key={k} className="flex items-center justify-between p-3 border rounded-md">
              <Label>{l}</Label>
              <Switch checked={!!v} onCheckedChange={val => toggle(k as string, val)} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────── POLICY COMPLIANCE ────────────────────────────────────
function PolicyComplianceTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPolicyCompliance);
  const upsertFn = useServerFn(upsertPolicyCompliance);
  const { data: rows } = useQuery({ queryKey: ["tpc", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [form, setForm] = useState({ framework: "soc2", controlId: "CC6.1", status: "implemented" as any });
  const create = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, ...form } as any }),
    onSuccess: () => { toast.success("Control saved"); qc.invalidateQueries({ queryKey: ["tpc", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const grouped = new Map<string, any[]>();
  for (const r of rows ?? []) {
    const arr = grouped.get(r.framework) ?? [];
    arr.push(r); grouped.set(r.framework, arr);
  }
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>Add / update control</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-4 gap-3">
          <div><Label>Framework</Label><Input value={form.framework} onChange={e => setForm({ ...form, framework: e.target.value })} /></div>
          <div><Label>Control ID</Label><Input value={form.controlId} onChange={e => setForm({ ...form, controlId: e.target.value })} /></div>
          <div><Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="not_started">Not started</SelectItem><SelectItem value="implemented">Implemented</SelectItem><SelectItem value="tested">Tested</SelectItem><SelectItem value="failing">Failing</SelectItem><SelectItem value="expired">Expired</SelectItem><SelectItem value="waived">Waived</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="mt-6"><Button onClick={() => create.mutate()} disabled={create.isPending}>Save</Button></div>
        </CardContent>
      </Card>
      {Array.from(grouped.entries()).map(([framework, items]) => (
        <Card key={framework}>
          <CardHeader><CardTitle className="uppercase">{framework}</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {items.map((r: any) => (
              <div key={r.id} className="flex justify-between text-sm border-b py-1 last:border-b-0">
                <span>{r.control_id}</span>
                <Badge variant={r.status === "failing" || r.status === "expired" ? "destructive" : "secondary"}>{r.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ────────────────────── REPORTS ──────────────────────────────────────────────
function ReportsTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listReportDefinitions);
  const upsertFn = useServerFn(upsertReportDefinition);
  const renderFn = useServerFn(renderReport);
  const rotationScanFn = useServerFn(runRotationScan);
  const { data: rows } = useQuery({ queryKey: ["trd", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [form, setForm] = useState<{
    name: string;
    category: "security" | "ai" | "users" | "compliance" | "usage" | "cost" | "custom";
    format: ReportDefinitionFormat;
  }>({ name: "", category: "security", format: "csv" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => upsertFn({ data: { tenantId, ...form } as any }),
    onSuccess: () => { toast.success("Report added"); qc.invalidateQueries({ queryKey: ["trd", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const seed = () => {
    const seeds = [
      { name: "Security report", category: "security" as any },
      { name: "AI report", category: "ai" as any },
      { name: "User report", category: "users" as any },
      { name: "Compliance report", category: "compliance" as any },
      { name: "Usage report", category: "usage" as any },
      { name: "Cost report", category: "cost" as any },
    ];
    Promise.all(seeds.map(s => upsertFn({ data: { tenantId, ...s, format: "csv" as any } as any })))
      .then(() => { toast.success("Report library seeded"); qc.invalidateQueries({ queryKey: ["trd", tenantId] }); });
  };
  const download = async (id: string) => {
    setBusyId(id);
    try {
      const res = await renderFn({ data: { id } });
      const blob = new Blob([res.body], { type: res.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = res.filename; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
      toast.success(`Exported ${res.rows} rows`);
      qc.invalidateQueries({ queryKey: ["trd", tenantId] });
    } catch (e: any) {
      toast.error(e.message ?? "Export failed");
    } finally {
      setBusyId(null);
    }
  };
  const scanRotations = async () => {
    try {
      const r = await rotationScanFn({ data: { tenantId } });
      toast.success(`Rotation scan · ${r.scanned} policies · ${r.overdue} overdue · ${r.rescheduled} rescheduled`);
    } catch (e: any) {
      toast.error(e.message ?? "Rotation scan failed");
    }
  };
  return (
    <div className="mt-4 space-y-4">
      <div className="flex justify-between items-center gap-2">
        <p className="text-sm text-muted-foreground">Self-serve report library — one-click CSV export; scheduled delivery via cron.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={scanRotations}>Run rotation scan</Button>
          <Button variant="outline" onClick={seed}>Seed default library</Button>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>New report</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-4 gap-3">
          <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm({ ...form, category: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="security">Security</SelectItem><SelectItem value="ai">AI</SelectItem><SelectItem value="users">Users</SelectItem><SelectItem value="compliance">Compliance</SelectItem><SelectItem value="usage">Usage</SelectItem><SelectItem value="cost">Cost</SelectItem><SelectItem value="custom">Custom</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>Format</Label>
            <Select value={form.format} onValueChange={v => setForm({ ...form, format: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REPORT_DEFINITION_FORMATS.map((format) => <SelectItem key={format} value={format}>{format.toUpperCase()}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-4"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {(rows ?? []).map((r: any) => (
          <Card key={r.id}><CardContent className="p-4 flex justify-between items-center">
            <div>
              <div className="font-semibold">{r.name}</div>
              <div className="text-xs text-muted-foreground">
                {r.category} · {reportFormatLabel(r.format)}
                {r.last_run_at ? ` · last run ${new Date(r.last_run_at).toLocaleString()}` : ""}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "active" : "off"}</Badge>
              <Button size="sm" variant="outline" onClick={() => download(r.id)} disabled={busyId === r.id}>
                {busyId === r.id ? "Exporting…" : "Download"}
              </Button>
            </div>
          </CardContent></Card>
        ))}
        {(!rows || rows.length === 0) && <p className="text-sm text-muted-foreground">No reports defined.</p>}
      </div>
    </div>
  );
}
