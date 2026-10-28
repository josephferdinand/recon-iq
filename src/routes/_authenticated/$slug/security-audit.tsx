import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { listTenantSecurityEvents } from "@/lib/security-audit.functions";
import { listAgentRuns, listAgentActions } from "@/lib/agent.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldAlert, ArrowLeft, RefreshCw, Bot, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/$slug/security-audit")({
  component: SecurityAuditPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">Failed to load: {error instanceof Error ? error.message : "An unexpected error occurred."}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

const PREFIX_OPTIONS = [
  { v: "all", label: "All security events" },
  { v: "auth.", label: "Authentication" },
  { v: "mfa.", label: "MFA" },
  { v: "sso.", label: "SSO" },
  { v: "step_up.", label: "Step-up auth" },
  { v: "rls.", label: "RLS denies" },
  { v: "policy.", label: "Policy changes" },
  { v: "secdef.", label: "SECURITY DEFINER" },
  { v: "break_glass.", label: "Break-glass access" },
  { v: "rbac.", label: "RBAC changes" },
  { v: "role.", label: "Role grants" },
  { v: "ip_allowlist.", label: "IP allowlist" },
];

const SINCE_OPTIONS = [
  { v: 24, label: "Last 24 hours" },
  { v: 168, label: "Last 7 days" },
  { v: 720, label: "Last 30 days" },
  { v: 2160, label: "Last 90 days" },
];

const ACTION_KIND_OPTIONS = [
  { v: "all", label: "All action kinds" },
  { v: "resolve_breaks", label: "Resolve breaks" },
  { v: "assign_breaks", label: "Assign / comment" },
  { v: "trigger_reconciliation_run", label: "Trigger recon run" },
];

const ACTION_STATUS_OPTIONS = [
  { v: "all", label: "All statuses" },
  { v: "proposed", label: "Proposed" },
  { v: "approved", label: "Approved" },
  { v: "executed", label: "Executed" },
  { v: "rejected", label: "Rejected" },
  { v: "reverted", label: "Reverted" },
  { v: "failed", label: "Failed" },
];

function SecurityAuditPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/security-audit" });
  const lookupTenant = useServerFn(getTenantBySlug);

  const tenantQ = useQuery({
    queryKey: ["tenant-by-slug", slug],
    queryFn: () => lookupTenant({ data: { slug } }),
  });
  const tenantId = tenantQ.data?.id as string | undefined;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <Link
          to="/$slug/tenant"
          params={{ slug }}
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Back to Tenant
        </Link>
        <h1 className="text-2xl font-semibold mt-1 flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-amber-600" /> Audit
        </h1>
        <p className="text-sm text-muted-foreground">
          Hash-chained, tamper-evident audit trail. Browse security events and every agent run / action with full
          filters.
        </p>
      </div>

      <Tabs defaultValue="security" className="space-y-4">
        <TabsList>
          <TabsTrigger value="security" className="gap-2">
            <ShieldAlert className="h-4 w-4" /> Security events
          </TabsTrigger>
          <TabsTrigger value="agent-runs" className="gap-2">
            <Bot className="h-4 w-4" /> Agent runs
          </TabsTrigger>
          <TabsTrigger value="agent-actions" className="gap-2">
            <Activity className="h-4 w-4" /> Agent actions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="security">
          <SecurityEventsPanel tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="agent-runs">
          <AgentRunsPanel tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="agent-actions">
          <AgentActionsPanel tenantId={tenantId} />
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        All entries are append-only, SHA-256 hash-chained, and anchored daily. Verify integrity with{" "}
        <code>SELECT * FROM verify_audit_chain();</code>.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Security events
// ─────────────────────────────────────────────────────────────────────────────
function SecurityEventsPanel({ tenantId }: { tenantId?: string }) {
  const fetchEvents = useServerFn(listTenantSecurityEvents);
  const [prefix, setPrefix] = useState("all");
  const [sinceHours, setSinceHours] = useState(168);
  const [filter, setFilter] = useState("");

  const eventsQ = useQuery({
    queryKey: ["security-audit", tenantId, prefix, sinceHours],
    queryFn: () =>
      fetchEvents({
        data: {
          tenant_id: tenantId!,
          limit: 200,
          since_hours: sinceHours,
          action_prefix: prefix === "all" ? undefined : prefix,
        },
      }),
    enabled: !!tenantId,
  });

  const rows = useMemo(() => {
    const list = eventsQ.data ?? [];
    if (!filter) return list;
    const f = filter.toLowerCase();
    return list.filter((r: any) =>
      [r.actor_email, r.action, r.resource_type, r.resource_id, r.client_ip]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(f)),
    );
  }, [eventsQ.data, filter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Filters</CardTitle>
          <Button variant="outline" size="sm" onClick={() => eventsQ.refetch()} disabled={eventsQ.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${eventsQ.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={prefix} onValueChange={setPrefix}>
            <SelectTrigger><SelectValue placeholder="Event type" /></SelectTrigger>
            <SelectContent>
              {PREFIX_OPTIONS.map((o) => (
                <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(sinceHours)} onValueChange={(v) => setSinceHours(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SINCE_OPTIONS.map((o) => (
                <SelectItem key={o.v} value={String(o.v)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search actor, action, resource, IP…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Events <span className="text-muted-foreground font-normal">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Actor</th>
                  <th className="text-left p-3">Action</th>
                  <th className="text-left p-3">Resource</th>
                  <th className="text-left p-3">Client IP</th>
                </tr>
              </thead>
              <tbody>
                {eventsQ.isLoading ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No security events in this window.</td></tr>
                ) : (
                  rows.map((r: any) => (
                    <tr key={r.id} className="border-t hover:bg-muted/20">
                      <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.occurred_at).toLocaleString()}
                      </td>
                      <td className="p-3 text-xs">{r.actor_email ?? "—"}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="font-mono text-xs">{r.action}</Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {r.resource_type ? (
                          <span>
                            {r.resource_type}
                            {r.resource_id ? ` · ${r.resource_id}` : ""}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-3 text-xs font-mono">{r.client_ip ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent runs
// ─────────────────────────────────────────────────────────────────────────────
function runStatusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "succeeded") return "default";
  if (s === "failed") return "destructive";
  if (s === "running") return "secondary";
  return "outline";
}

function AgentRunsPanel({ tenantId }: { tenantId?: string }) {
  const fetchRuns = useServerFn(listAgentRuns);
  const [status, setStatus] = useState("all");
  const [filter, setFilter] = useState("");

  const runsQ = useQuery({
    queryKey: ["audit-agent-runs", tenantId],
    queryFn: () => fetchRuns({ data: { tenant_id: tenantId!, limit: 200 } }),
    enabled: !!tenantId,
  });

  const rows = useMemo(() => {
    const list: any[] = runsQ.data ?? [];
    return list.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (filter && !`${r.objective ?? ""} ${r.summary ?? ""} ${r.id}`.toLowerCase().includes(filter.toLowerCase()))
        return false;
      return true;
    });
  }, [runsQ.data, status, filter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Filters</CardTitle>
          <Button variant="outline" size="sm" onClick={() => runsQ.refetch()} disabled={runsQ.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${runsQ.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="succeeded">Succeeded</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="md:col-span-2"
            placeholder="Search objective, summary, run id…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Runs <span className="text-muted-foreground font-normal">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Mode</th>
                  <th className="text-left p-3">Objective</th>
                  <th className="text-left p-3">Actions</th>
                  <th className="text-left p-3">Run ID</th>
                </tr>
              </thead>
              <tbody>
                {runsQ.isLoading ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No agent runs.</td></tr>
                ) : (
                  rows.map((r: any) => (
                    <tr key={r.id} className="border-t hover:bg-muted/20 align-top">
                      <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="p-3"><Badge variant={runStatusVariant(r.status)}>{r.status}</Badge></td>
                      <td className="p-3 text-xs">{r.mode ?? "—"}</td>
                      <td className="p-3 text-xs max-w-md"><div className="line-clamp-2">{r.objective}</div></td>
                      <td className="p-3 text-xs whitespace-nowrap">
                        {r.executed_actions_count ?? 0} / {r.planned_actions_count ?? 0}
                      </td>
                      <td className="p-3 text-xs"><span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide">{String(r.id).slice(0, 8).toUpperCase()}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent actions
// ─────────────────────────────────────────────────────────────────────────────
function actionStatusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "executed" || s === "approved") return "default";
  if (s === "rejected" || s === "failed") return "destructive";
  if (s === "reverted") return "secondary";
  return "outline";
}

function AgentActionsPanel({ tenantId }: { tenantId?: string }) {
  const fetchActions = useServerFn(listAgentActions);
  const [actionKind, setActionKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [sinceHours, setSinceHours] = useState(168);
  const [filter, setFilter] = useState("");

  const actionsQ = useQuery({
    queryKey: ["audit-agent-actions", tenantId, actionKind, status, sinceHours],
    queryFn: () =>
      fetchActions({
        data: {
          tenant_id: tenantId!,
          action_kind: actionKind === "all" ? undefined : actionKind,
          status: status === "all" ? undefined : status,
          since_hours: sinceHours,
          limit: 300,
        },
      }),
    enabled: !!tenantId,
  });

  const rows = useMemo(() => {
    const list: any[] = actionsQ.data ?? [];
    if (!filter) return list;
    const f = filter.toLowerCase();
    return list.filter((r) =>
      [r.tool, r.action_kind, r.rejection_reason, JSON.stringify(r.input ?? {})]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(f)),
    );
  }, [actionsQ.data, filter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Filters</CardTitle>
          <Button variant="outline" size="sm" onClick={() => actionsQ.refetch()} disabled={actionsQ.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${actionsQ.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select value={actionKind} onValueChange={setActionKind}>
            <SelectTrigger><SelectValue placeholder="Action kind" /></SelectTrigger>
            <SelectContent>
              {ACTION_KIND_OPTIONS.map((o) => (
                <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {ACTION_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(sinceHours)} onValueChange={(v) => setSinceHours(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SINCE_OPTIONS.map((o) => (
                <SelectItem key={o.v} value={String(o.v)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search tool, input, reason…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Actions <span className="text-muted-foreground font-normal">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Tool</th>
                  <th className="text-left p-3">Action kind</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Ceiling</th>
                  <th className="text-left p-3">Run</th>
                  <th className="text-left p-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {actionsQ.isLoading ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No agent actions in this window.</td></tr>
                ) : (
                  rows.map((r: any) => (
                    <tr key={r.id} className="border-t hover:bg-muted/20 align-top">
                      <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="p-3 text-xs font-mono">{r.tool}</td>
                      <td className="p-3 text-xs">
                        {r.action_kind ? <Badge variant="outline" className="font-mono text-xs">{r.action_kind}</Badge> : "—"}
                      </td>
                      <td className="p-3"><Badge variant={actionStatusVariant(r.status)}>{r.status}</Badge></td>
                      <td className="p-3 text-xs">{r.policy_ceiling ?? "—"}</td>
                      <td className="p-3 text-xs"><span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide">{r.run_id ? String(r.run_id).slice(0, 8).toUpperCase() : "—"}</span></td>
                      <td className="p-3 text-xs text-muted-foreground max-w-sm">
                        {r.rejection_reason
                          ? <span className="text-destructive">Rejected: {r.rejection_reason}</span>
                          : r.reverted_at
                            ? <span>Reverted {new Date(r.reverted_at).toLocaleString()}</span>
                            : <span className="line-clamp-2">{summariseInput(r.input)}</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function summariseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "—";
  try {
    const s = JSON.stringify(input);
    return s.length > 160 ? s.slice(0, 160) + "…" : s;
  } catch {
    return "—";
  }
}
