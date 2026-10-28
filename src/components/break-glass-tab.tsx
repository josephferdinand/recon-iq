import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ShieldAlert, Plus, Clock, CheckCircle2, XCircle, Ban, FileWarning, RefreshCw,
  AlertTriangle, Lock, History, Settings2,
} from "lucide-react";
import {
  listBreakGlassPolicies, updateBreakGlassPolicy,
  listBreakGlassGrants, requestBreakGlass, decideBreakGlass, revokeBreakGlass,
  getBreakGlassGrant,
} from "@/lib/break-glass.functions";
import { listAllTenants } from "@/lib/tenants.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

const SCOPE_META: Record<string, { label: string; risk: "low" | "med" | "high" | "critical" }> = {
  tenant_data_read: { label: "Tenant Data — Read", risk: "med" },
  tenant_data_write: { label: "Tenant Data — Write", risk: "high" },
  tenant_admin_impersonate: { label: "Tenant Admin Impersonation", risk: "high" },
  secrets_read: { label: "Secrets / Credentials", risk: "critical" },
  billing_admin: { label: "Billing Admin Override", risk: "high" },
  audit_export: { label: "Audit Log Export", risk: "med" },
  full_platform: { label: "Full Platform Override", risk: "critical" },
};

function riskBadge(risk: "low" | "med" | "high" | "critical") {
  const cls =
    risk === "critical" ? "bg-red-600 text-white" :
    risk === "high" ? "bg-amber-600 text-white" :
    risk === "med" ? "bg-yellow-500 text-black" : "bg-emerald-600 text-white";
  return <Badge className={cls}>{risk.toUpperCase()}</Badge>;
}

function statusBadge(s: string) {
  switch (s) {
    case "active": return <Badge className="bg-emerald-600 text-white"><CheckCircle2 className="mr-1 h-3 w-3" />Active</Badge>;
    case "pending": return <Badge className="bg-amber-500 text-black"><Clock className="mr-1 h-3 w-3" />Pending approval</Badge>;
    case "expired": return <Badge variant="outline"><Clock className="mr-1 h-3 w-3" />Expired</Badge>;
    case "revoked": return <Badge variant="destructive"><Ban className="mr-1 h-3 w-3" />Revoked</Badge>;
    case "denied": return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Denied</Badge>;
    default: return <Badge variant="outline">{s}</Badge>;
  }
}

function fmtTimeLeft(expires?: string | null) {
  if (!expires) return "—";
  const ms = new Date(expires).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export function BreakGlassTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-300/40 bg-red-50/60 p-4 dark:bg-red-950/20">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-red-600" />
          <div className="text-sm">
            <div className="font-display font-semibold text-red-900 dark:text-red-200">
              Break-Glass Emergency Access
            </div>
            <p className="mt-1 text-red-900/80 dark:text-red-200/80">
              Time-bound, justified, four-eyes-approved elevation for catastrophic incident response.
              Every grant is hash-chained into the platform audit log and notifies all platform admins.
              Use only when normal RBAC cannot resolve the incident.
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active"><ShieldAlert className="mr-1 h-4 w-4" />Active &amp; pending</TabsTrigger>
          <TabsTrigger value="history"><History className="mr-1 h-4 w-4" />History</TabsTrigger>
          <TabsTrigger value="policies"><Settings2 className="mr-1 h-4 w-4" />Policies</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4"><GrantsList showActiveOnly /></TabsContent>
        <TabsContent value="history" className="mt-4"><GrantsList showActiveOnly={false} /></TabsContent>
        <TabsContent value="policies" className="mt-4"><PoliciesPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Grants list ---------------- */

function GrantsList({ showActiveOnly }: { showActiveOnly: boolean }) {
  const qc = useQueryClient();
  const fetchGrants = useServerFn(listBreakGlassGrants);
  const grantsQ = useQuery({
    queryKey: ["bg-grants", showActiveOnly],
    queryFn: () => fetchGrants({ data: { status: "all", limit: 200 } }),
    refetchInterval: showActiveOnly ? 15_000 : false,
  });

  const rows = useMemo(() => {
    const list = grantsQ.data ?? [];
    if (!showActiveOnly) return list;
    return list.filter((g: any) => g.status === "active" || g.status === "pending");
  }, [grantsQ.data, showActiveOnly]);

  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">
            {showActiveOnly ? "Active & pending requests" : "Grant history"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {showActiveOnly
              ? "Live elevations expire automatically. Revoke immediately if no longer needed."
              : "All historical grants — expired, revoked, and denied."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["bg-grants"] })}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
          {showActiveOnly ? <RequestGrantDialog onCreated={() => qc.invalidateQueries({ queryKey: ["bg-grants"] })} /> : null}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Grant</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Time left</th>
                <th className="px-4 py-3">Approvals</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((g: any) => {
                const meta = SCOPE_META[g.scope] ?? { label: g.scope, risk: "med" as const };
                return (
                  <tr key={g.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{g.grant_uid}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {riskBadge(meta.risk)}
                        <span className="text-xs">{meta.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {g.tenant?.name ?? <span className="italic">platform-wide</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">{g.requester?.email ?? "—"}</td>
                    <td className="px-4 py-3">{statusBadge(g.status)}</td>
                    <td className="px-4 py-3 text-xs">
                      {g.status === "active" ? fmtTimeLeft(g.expires_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">{g.approver_count ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(g.id)}>Open</Button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    {showActiveOnly ? "No active or pending break-glass grants. Good." : "No grant history yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <GrantDetailDialog grantId={detailId} onClose={() => setDetailId(null)} />
    </>
  );
}

/* ---------------- Request dialog ---------------- */

function RequestGrantDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>("tenant_data_read");
  const [tenantId, setTenantId] = useState<string>("__none__");
  const [justification, setJustification] = useState("");
  const [incidentRef, setIncidentRef] = useState("");
  const [duration, setDuration] = useState(30);

  const fetchPolicies = useServerFn(listBreakGlassPolicies);
  const fetchTenants = useServerFn(listAllTenants);
  const policiesQ = useQuery({ queryKey: ["bg-policies"], queryFn: () => fetchPolicies() });
  const tenantsQ = useQuery({ queryKey: ["platform-tenants"], queryFn: () => fetchTenants() });

  const policy = (policiesQ.data ?? []).find((p: any) => p.scope === scope);

  const requestFn = useServerFn(requestBreakGlass);
  const m = useMutation({
    mutationFn: () => requestFn({
      data: {
        scope: scope as any,
        tenant_id: tenantId === "__none__" ? null : tenantId,
        justification,
        incident_ref: incidentRef || null,
        duration_minutes: duration,
      },
    }),
    onSuccess: (res: any) => {
      toast.success(`Grant ${res.grant_uid} created (${res.status})`);
      setOpen(false);
      setJustification(""); setIncidentRef(""); setDuration(30);
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const justOk = justification.trim().length >= 20;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Plus className="mr-1 h-4 w-4" /> Request break-glass
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-600" /> Request emergency access
          </DialogTitle>
          <DialogDescription>
            Use only when standard RBAC cannot resolve the incident. A second platform admin must approve before activation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Scope</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(policiesQ.data ?? []).filter((p: any) => p.enabled).map((p: any) => (
                  <SelectItem key={p.scope} value={p.scope}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {policy ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {riskBadge(SCOPE_META[policy.scope]?.risk ?? "med")}
                <span>max {policy.max_duration_minutes}m</span>
                <span>· {policy.min_approvers} approver(s)</span>
                {policy.require_step_up ? <Badge variant="outline"><Lock className="mr-1 h-3 w-3" />Step-up</Badge> : null}
              </div>
            ) : null}
          </div>
          <div>
            <Label>Target tenant (optional)</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger><SelectValue placeholder="e.g. Platform-wide or Demo Bank NA only" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Platform-wide (no tenant)</SelectItem>
                {(tenantsQ.data ?? []).map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.slug})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Incident reference{policy?.require_incident_ref ? " *" : ""}</Label>
            <Input
              placeholder="e.g. FAL-INC-4821 / DEMO-JIRA-9912 / PD-Q1234"
              value={incidentRef}
              onChange={(e) => setIncidentRef(e.target.value)}
            />
          </div>
          <div>
            <Label>Justification *</Label>
            <Textarea
              rows={4}
              placeholder="e.g. Demo Bank production incident FAL-INC-4821 — Citi MT940 ingestion failed, need step-up to rotate Demo Bank BYOK credentials and replay 2026-06-26 EOD recon."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
            <div className="mt-1 text-xs text-muted-foreground">
              {justification.length}/2000 — minimum 20 characters.
            </div>
          </div>
          <div>
            <Label>Duration (minutes) — max {policy?.max_duration_minutes ?? 60}</Label>
            <Input
              type="number"
              min={5}
              max={policy?.max_duration_minutes ?? 60}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value || 0))}
            />
          </div>
          <div className="rounded-md border border-amber-300/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
              <div>
                Every action under an active grant is recorded in an append-only ledger and broadcast to all platform admins.
                You cannot approve your own request.
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!justOk || (policy?.require_incident_ref && !incidentRef) || m.isPending}
            onClick={() => m.mutate()}
          >
            {m.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Detail / approve / revoke ---------------- */

function GrantDetailDialog({ grantId, onClose }: { grantId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const fetchOne = useServerFn(getBreakGlassGrant);
  const decideFn = useServerFn(decideBreakGlass);
  const revokeFn = useServerFn(revokeBreakGlass);

  const q = useQuery({
    queryKey: ["bg-grant", grantId],
    queryFn: () => fetchOne({ data: { grant_id: grantId! } }),
    enabled: !!grantId,
  });

  const [reason, setReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");

  const grant = q.data?.grant;
  const approvals = q.data?.approvals ?? [];
  const activities = q.data?.activities ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["bg-grant", grantId] });
    qc.invalidateQueries({ queryKey: ["bg-grants"] });
  };
  const mDecide = useMutation({
    mutationFn: (decision: "approve" | "deny") =>
      decideFn({ data: { grant_id: grantId!, decision, reason: reason || undefined } }),
    onSuccess: (r: any) => { toast.success(`Recorded: ${r.status}`); setReason(""); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const mRevoke = useMutation({
    mutationFn: () => revokeFn({ data: { grant_id: grantId!, reason: revokeReason } }),
    onSuccess: () => { toast.success("Grant revoked"); setRevokeReason(""); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={!!grantId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-600" />
            {grant?.grant_uid ?? "Break-glass grant"}
          </DialogTitle>
          <DialogDescription>
            {grant ? (SCOPE_META[grant.scope]?.label ?? grant.scope) : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {!grant ? <div className="p-6 text-center text-muted-foreground">Loading…</div> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Field label="Status">{statusBadge(grant.status)}</Field>
              <Field label="Tenant">{grant.tenant?.name ?? <span className="italic text-muted-foreground">platform-wide</span>}</Field>
              <Field label="Requester">{grant.requester?.email ?? "—"}</Field>
              <Field label="Duration">{grant.requested_duration_minutes}m</Field>
              <Field label="Created">{new Date(grant.created_at).toLocaleString()}</Field>
              <Field label="Activated">{grant.activated_at ? new Date(grant.activated_at).toLocaleString() : "—"}</Field>
              <Field label="Expires">{grant.expires_at ? new Date(grant.expires_at).toLocaleString() : "—"}</Field>
              <Field label="Incident">{grant.incident_ref ?? "—"}</Field>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Justification</div>
              <div className="whitespace-pre-wrap">{grant.justification}</div>
            </div>

            {grant.status === "revoked" ? (
              <div className="rounded-md border border-red-300/40 bg-red-50/60 p-3 text-sm dark:bg-red-950/20">
                <div className="mb-1 text-xs font-medium uppercase text-red-700 dark:text-red-300">Revoked</div>
                <div>{grant.revoke_reason}</div>
              </div>
            ) : null}

            <div>
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                Approvals ({approvals.length})
              </div>
              <div className="space-y-1">
                {approvals.length === 0 ? (
                  <div className="text-xs text-muted-foreground">None yet.</div>
                ) : approvals.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      {a.decision === "approve"
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        : <XCircle className="h-4 w-4 text-red-600" />}
                      <span>{a.approver?.email ?? a.approver_user_id}</span>
                      {a.reason ? <span className="text-xs text-muted-foreground">— {a.reason}</span> : null}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(a.decided_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {grant.status === "pending" ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Decide as approver</div>
                <Textarea placeholder="e.g. Demo Bank Internal Audit Q3 sample review" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => mDecide.mutate("approve")} disabled={mDecide.isPending}>
                    <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button variant="destructive" onClick={() => mDecide.mutate("deny")} disabled={mDecide.isPending}>
                    <XCircle className="mr-1 h-4 w-4" /> Deny
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Requester cannot approve their own grant.
                </div>
              </div>
            ) : null}

            {grant.status === "active" ? (
              <div className="space-y-2 rounded-md border border-red-300/40 p-3">
                <div className="text-xs font-medium uppercase text-red-700 dark:text-red-300">Revoke immediately</div>
                <Input placeholder="e.g. Demo Bank offboarding — staff member left 2026-06-25" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
                <Button variant="destructive" disabled={revokeReason.length < 5 || mRevoke.isPending} onClick={() => mRevoke.mutate()}>
                  <Ban className="mr-1 h-4 w-4" /> Revoke grant
                </Button>
              </div>
            ) : null}

            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                <FileWarning className="h-3 w-3" /> Activity ledger ({activities.length})
              </div>
              <div className="max-h-64 overflow-auto rounded border">
                {activities.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">No actions recorded under this grant.</div>
                ) : (
                  <table className="w-full text-xs">
                    <tbody>
                      {activities.map((a: any) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="px-2 py-1.5 font-mono">{new Date(a.occurred_at).toLocaleString()}</td>
                          <td className="px-2 py-1.5">{a.actor?.email ?? a.actor_user_id}</td>
                          <td className="px-2 py-1.5">{a.action}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{a.resource_type ?? ""} {a.resource_id ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/* ---------------- Policies ---------------- */

function PoliciesPanel() {
  const qc = useQueryClient();
  const fetchPolicies = useServerFn(listBreakGlassPolicies);
  const updateFn = useServerFn(updateBreakGlassPolicy);
  const q = useQuery({ queryKey: ["bg-policies"], queryFn: () => fetchPolicies() });

  const m = useMutation({
    mutationFn: (input: any) => updateFn({ data: input }),
    onSuccess: () => { toast.success("Policy updated"); qc.invalidateQueries({ queryKey: ["bg-policies"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Scope policies</CardTitle>
        <CardDescription>Tune approval thresholds and time bounds per emergency scope.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3">Max duration (m)</th>
              <th className="px-4 py-3">Min approvers</th>
              <th className="px-4 py-3">Step-up</th>
              <th className="px-4 py-3">Incident ref</th>
              <th className="px-4 py-3">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((p: any) => (
              <tr key={p.id} className="border-b">
                <td className="px-4 py-3">
                  <div className="font-medium">{p.display_name}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </td>
                <td className="px-4 py-3">{riskBadge(SCOPE_META[p.scope]?.risk ?? "med")}</td>
                <td className="px-4 py-3">
                  <Input
                    type="number"
                    className="h-8 w-20"
                    defaultValue={p.max_duration_minutes}
                    min={5} max={480}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== p.max_duration_minutes) m.mutate({ id: p.id, max_duration_minutes: v });
                    }}
                  />
                </td>
                <td className="px-4 py-3">
                  <Input
                    type="number"
                    className="h-8 w-16"
                    defaultValue={p.min_approvers}
                    min={1} max={5}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== p.min_approvers) m.mutate({ id: p.id, min_approvers: v });
                    }}
                  />
                </td>
                <td className="px-4 py-3">
                  <Switch checked={p.require_step_up} onCheckedChange={(v) => m.mutate({ id: p.id, require_step_up: v })} />
                </td>
                <td className="px-4 py-3">
                  <Switch checked={p.require_incident_ref} onCheckedChange={(v) => m.mutate({ id: p.id, require_incident_ref: v })} />
                </td>
                <td className="px-4 py-3">
                  <Switch checked={p.enabled} onCheckedChange={(v) => m.mutate({ id: p.id, enabled: v })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
