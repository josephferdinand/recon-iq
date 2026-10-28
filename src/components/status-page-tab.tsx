import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { StatusIncidentAdmin } from "@/components/status-incident-admin";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Plus, Trash2, Server, Mail, ExternalLink } from "lucide-react";
import {
  listStatusIncidents, upsertStatusIncident,
  listStatusComponents, upsertStatusComponent, setStatusComponentState, deleteStatusComponent,
  listStatusSubscribers, deleteStatusSubscriber,
} from "@/lib/batch-bc.functions";

const SEV = ["maintenance","minor","major","critical"] as const;
const STATUS = ["investigating","identified","monitoring","resolved"] as const;
const COMP_STATE = ["operational","degraded_performance","partial_outage","major_outage","maintenance"] as const;

const stateLabel: Record<string, string> = {
  operational: "Operational",
  degraded_performance: "Degraded",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
  maintenance: "Maintenance",
};
const stateTone: Record<string, string> = {
  operational: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  degraded_performance: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  partial_outage: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  major_outage: "bg-red-500/10 text-red-600 border-red-500/30",
  maintenance: "bg-sky-500/10 text-sky-600 border-sky-500/30",
};

export function StatusPageTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();

  // Incidents
  const list = useServerFn(listStatusIncidents);
  const upsert = useServerFn(upsertStatusIncident);
  const [draft, setDraft] = useState({
    title: "", body: "", severity: "minor" as (typeof SEV)[number],
    status: "investigating" as (typeof STATUS)[number], component: "",
  });
  const q = useQuery({ queryKey: ["status-incidents"], queryFn: () => list(), staleTime: 30_000 });
  const m = useMutation({
    mutationFn: () => upsert({ data: draft }),
    onSuccess: () => { toast.success("Saved"); setDraft({ ...draft, title: "", body: "", component: "" }); qc.invalidateQueries({ queryKey: ["status-incidents"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mResolve = useMutation({
    mutationFn: (r: any) => upsert({ data: { id: r.id, title: r.title, body: r.body, severity: r.severity, status: "resolved", component: r.component } }),
    onSuccess: () => { toast.success("Resolved"); qc.invalidateQueries({ queryKey: ["status-incidents"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // Components
  const listComps = useServerFn(listStatusComponents);
  const upsertComp = useServerFn(upsertStatusComponent);
  const setCompState = useServerFn(setStatusComponentState);
  const delComp = useServerFn(deleteStatusComponent);
  const qComps = useQuery({ queryKey: ["status-components"], queryFn: () => listComps(), staleTime: 30_000 });
  const [compDraft, setCompDraft] = useState({ key: "", name: "", group_name: "", display_order: 0 });
  const mAddComp = useMutation({
    mutationFn: () => upsertComp({ data: { ...compDraft, state: "operational" as const, display_order: Number(compDraft.display_order) || 0, group_name: compDraft.group_name || null } }),
    onSuccess: () => { toast.success("Component added"); setCompDraft({ key: "", name: "", group_name: "", display_order: 0 }); qc.invalidateQueries({ queryKey: ["status-components"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mSetState = useMutation({
    mutationFn: (v: { id: string; state: (typeof COMP_STATE)[number] }) => setCompState({ data: v }),
    onSuccess: () => { toast.success("State updated"); qc.invalidateQueries({ queryKey: ["status-components"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mDelComp = useMutation({
    mutationFn: (id: string) => delComp({ data: { id } }),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["status-components"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // Subscribers
  const listSubs = useServerFn(listStatusSubscribers);
  const delSub = useServerFn(deleteStatusSubscriber);
  const qSubs = useQuery({ queryKey: ["status-subscribers"], queryFn: () => listSubs(), staleTime: 60_000 });
  const mDelSub = useMutation({
    mutationFn: (id: string) => delSub({ data: { id } }),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["status-subscribers"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const sevColor: Record<string, string> = { maintenance: "secondary", minor: "outline", major: "default", critical: "destructive" };
  const open = (q.data ?? []).filter((r: any) => r.status !== "resolved");
  const subs = qSubs.data ?? [];
  const confirmedCount = subs.filter((s: any) => s.confirmed_at).length;

  return (
    <div className="space-y-4">
      <StatusIncidentAdmin canWrite={canWrite} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Status page</CardTitle>
              <CardDescription>Public incident timeline at <code className="text-xs">/status</code> · JSON feed at <code className="text-xs">/api/public/status.json</code></CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/status" target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" /> View public page</a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
              <span className="font-semibold">No open legacy incident records. Functional health is not measured by this list.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {open.map((r: any) => (
                <div key={r.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{r.title}</div>
                    <Badge variant={sevColor[r.severity] as any}>{r.severity}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{r.component ? `${r.component} · ` : ""}{r.status} · {new Date(r.started_at).toLocaleString()}</div>
                  {r.body ? <p className="mt-1 text-sm">{r.body}</p> : null}
                  {canWrite ? (
                    <div className="mt-2">
                      <Button size="sm" variant="outline" onClick={() => mResolve.mutate(r)}>Mark resolved</Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader><CardTitle>Post incident</CardTitle><CardDescription>Legacy record entry is preserved for owner review. Governed public publication uses the draft/review/publish workflow above.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Input placeholder="e.g. Demo Bank Nostro USD vs GL — Daily" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              <Input placeholder="e.g. ReconIQ Recon API" value={draft.component} onChange={(e) => setDraft((d) => ({ ...d, component: e.target.value }))} />
              <div className="flex gap-2">
                <Select value={draft.severity} onValueChange={(v: any) => setDraft((d) => ({ ...d, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEV.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={draft.status} onValueChange={(v: any) => setDraft((d) => ({ ...d, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <Textarea rows={3} placeholder="e.g. Demo Bank Nostro USD recon restored at 14:02 UTC — Citi feed resumed, all breaks under investigation." value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
            <Button onClick={() => m.mutate()} disabled={!draft.title || m.isPending}>
              <Plus className="mr-2 h-4 w-4" /> Post
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="h-4 w-4" /> Components</CardTitle>
          <CardDescription>Declared service catalog state. Functional health on <code className="text-xs">/status</code> requires registered probes and current measured evidence.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(qComps.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No components yet. Example: “ReconIQ API”, “ReconIQ AIDP”, “ReconIQ Recon Engine”, “ReconIQ Reporting”.</p>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Group</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Key</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(qComps.data ?? []).map((c: any) => (
                    <tr key={c.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.group_name ?? "—"}</td>
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2"><code className="text-xs">{c.key}</code></td>
                      <td className="px-3 py-2">
                        {canWrite ? (
                          <Select value={c.state} onValueChange={(v: any) => mSetState.mutate({ id: c.id, state: v })}>
                            <SelectTrigger className={`h-8 w-44 ${stateTone[c.state]}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{COMP_STATE.map(s => <SelectItem key={s} value={s}>{stateLabel[s]}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <span className={`rounded border px-2 py-0.5 text-xs ${stateTone[c.state]}`}>{stateLabel[c.state]}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canWrite ? (
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove component "${c.name}"?`)) mDelComp.mutate(c.id); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canWrite ? (
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3 md:grid-cols-5">
              <Input placeholder="e.g. reconiq-recon-api" value={compDraft.key} onChange={(e) => setCompDraft((d) => ({ ...d, key: e.target.value.toLowerCase() }))} />
              <Input placeholder="e.g. Demo Bank Nostro USD (Citi)" value={compDraft.name} onChange={(e) => setCompDraft((d) => ({ ...d, name: e.target.value }))} />
              <Input placeholder="e.g. Demo Bank Cash Ops EMEA" value={compDraft.group_name} onChange={(e) => setCompDraft((d) => ({ ...d, group_name: e.target.value }))} />
              <Input type="number" placeholder="e.g. 10 (ReconIQ Recon API displays first)" value={compDraft.display_order} onChange={(e) => setCompDraft((d) => ({ ...d, display_order: Number(e.target.value) }))} />
              <Button onClick={() => mAddComp.mutate()} disabled={!compDraft.key || !compDraft.name || mAddComp.isPending}>
                <Plus className="mr-2 h-4 w-4" /> Add component
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Subscribers</CardTitle>
          <CardDescription>{confirmedCount} confirmed · {subs.length - confirmedCount} pending double opt-in · showing latest {subs.length}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {subs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No subscribers yet. ReconIQ clients can subscribe at /status to receive incident notifications.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Components</th>
                  <th className="px-4 py-2">Subscribed</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s: any) => (
                  <tr key={s.id} className="border-b last:border-b-0">
                    <td className="px-4 py-2">{s.email}</td>
                    <td className="px-4 py-2">
                      {s.confirmed_at
                        ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">Confirmed</Badge>
                        : <Badge variant="secondary">Pending</Badge>}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{(s.component_keys ?? []).length === 0 ? "All" : (s.component_keys ?? []).join(", ")}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      {canWrite ? (
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove ${s.email}?`)) mDelSub.mutate(s.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {q.data && q.data.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Recent incident history</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-2">Started</th><th className="px-4 py-2">Title</th><th className="px-4 py-2">Severity</th><th className="px-4 py-2">Status</th></tr>
              </thead>
              <tbody>
                {q.data.map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="px-4 py-2">{r.title}</td>
                    <td className="px-4 py-2"><Badge variant={sevColor[r.severity] as any}>{r.severity}</Badge></td>
                    <td className="px-4 py-2"><Badge variant="outline">{r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
