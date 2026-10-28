import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listDoraRegister, upsertDoraRegister, deleteDoraRegister,
  listDoraIncidents, createDoraIncident,
  listDoraExitPlans, upsertDoraExitPlan,
  doraEvidenceExport,
} from "@/lib/dora.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldAlert, Plus, FileDown, Trash2 } from "lucide-react";
import { DoraValidationPanel } from "@/components/dora-validation-panel";

export function DoraTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchReg = useServerFn(listDoraRegister);
  const upsertReg = useServerFn(upsertDoraRegister);
  const delReg = useServerFn(deleteDoraRegister);
  const fetchInc = useServerFn(listDoraIncidents);
  const createInc = useServerFn(createDoraIncident);
  const fetchPlans = useServerFn(listDoraExitPlans);
  const upsertPlan = useServerFn(upsertDoraExitPlan);
  const exportFn = useServerFn(doraEvidenceExport);

  const regQ = useQuery({ queryKey: ["dora-reg", tenantId], queryFn: () => fetchReg({ data: { tenant_id: tenantId } }) });
  const incQ = useQuery({ queryKey: ["dora-inc", tenantId], queryFn: () => fetchInc({ data: { tenant_id: tenantId } }) });
  const planQ = useQuery({ queryKey: ["dora-plans", tenantId], queryFn: () => fetchPlans({ data: { tenant_id: tenantId } }) });

  const handleExport = async () => {
    const pack = await exportFn({ data: { tenant_id: tenantId } });
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `dora-evidence-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" /> DORA Article 28 — ICT Third-Party Compliance
            </CardTitle>
            <CardDescription>
              Maintain the register, exit plans, and incident log required by the EU Digital Operational Resilience Act.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={handleExport}>
            <FileDown className="mr-1 h-3.5 w-3.5" /> Export evidence pack
          </Button>
        </CardHeader>
      </Card>

      <DoraValidationPanel register={(regQ.data ?? []) as any} />

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Third-party register</TabsTrigger>
          <TabsTrigger value="plans">Exit plans</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-3">
          {canWrite ? <RegisterForm tenantId={tenantId} onSave={async (v) => { await upsertReg({ data: v as any }); qc.invalidateQueries({ queryKey: ["dora-reg", tenantId] }); toast.success("Saved"); }} /> : null}
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-4 py-2">Provider</th><th className="px-4 py-2">Criticality</th><th className="px-4 py-2">Country</th><th className="px-4 py-2">Status</th><th className="px-4 py-2"></th></tr>
                </thead>
                <tbody>
                  {(regQ.data ?? []).map((r: any) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.provider_name}</div>
                        <div className="line-clamp-1 text-xs text-muted-foreground">{r.service_description}</div>
                      </td>
                      <td className="px-4 py-2"><Badge variant={r.criticality === "critical" ? "destructive" : "outline"} className="text-[10px] uppercase">{r.criticality}</Badge></td>
                      <td className="px-4 py-2 text-xs">{r.country ?? "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.status}</td>
                      <td className="px-4 py-2 text-right">
                        {canWrite ? (
                          <Button size="sm" variant="ghost" onClick={async () => { await delReg({ data: { id: r.id, tenant_id: tenantId } }); qc.invalidateQueries({ queryKey: ["dora-reg", tenantId] }); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {regQ.data && regQ.data.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No providers registered yet.</td></tr> : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="space-y-3">
          {canWrite ? <ExitPlanForm tenantId={tenantId} onSave={async (v) => { await upsertPlan({ data: v as any }); qc.invalidateQueries({ queryKey: ["dora-plans", tenantId] }); toast.success("Saved"); }} /> : null}
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-4 py-2">Title</th><th className="px-4 py-2">RTO</th><th className="px-4 py-2">RPO</th><th className="px-4 py-2">Status</th></tr>
                </thead>
                <tbody>
                  {(planQ.data ?? []).map((p: any) => (
                    <tr key={p.id} className="border-b">
                      <td className="px-4 py-2 font-medium">{p.title}</td>
                      <td className="px-4 py-2 text-xs">{p.rto_hours}h</td>
                      <td className="px-4 py-2 text-xs">{p.rpo_minutes}m</td>
                      <td className="px-4 py-2 text-xs">{p.status}</td>
                    </tr>
                  ))}
                  {planQ.data && planQ.data.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No exit plans.</td></tr> : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incidents" className="space-y-3">
          {canWrite ? <IncidentForm tenantId={tenantId} onSave={async (v) => { await createInc({ data: v as any }); qc.invalidateQueries({ queryKey: ["dora-inc", tenantId] }); toast.success("Logged"); }} /> : null}
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Class</th><th className="px-4 py-2">Root cause</th><th className="px-4 py-2">Reported</th></tr>
                </thead>
                <tbody>
                  {(incQ.data ?? []).map((i: any) => (
                    <tr key={i.id} className="border-b">
                      <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(i.occurred_at).toLocaleString()}</td>
                      <td className="px-4 py-2"><Badge variant={i.classification === "major" ? "destructive" : "outline"} className="text-[10px] uppercase">{i.classification}</Badge></td>
                      <td className="px-4 py-2 text-xs">{i.root_cause ?? "—"}</td>
                      <td className="px-4 py-2 text-xs">{i.reported_to_regulator ? `Yes ${i.regulator_ref ?? ""}` : "No"}</td>
                    </tr>
                  ))}
                  {incQ.data && incQ.data.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No incidents logged.</td></tr> : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RegisterForm({ tenantId, onSave }: { tenantId: string; onSave: (v: any) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ provider_name: "", service_description: "", criticality: "important", country: "", status: "active" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> Add provider</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Register ICT third party</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="e.g. Citibank N.A. (Demo Bank Nostro USD provider)" value={v.provider_name} onChange={(e) => setV({ ...v, provider_name: e.target.value })} />
          <Textarea placeholder="e.g. SWIFT MT940 ingestion for Demo Bank Nostro USD" value={v.service_description} onChange={(e) => setV({ ...v, service_description: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={v.criticality} onValueChange={(x) => setV({ ...v, criticality: x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="important">Important</SelectItem>
                <SelectItem value="non_critical">Non-critical</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="e.g. United States (Demo Bank Nostro USD jurisdiction)" value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })} />
          </div>
          <Button onClick={async () => { await onSave({ ...v, tenant_id: tenantId }); setOpen(false); }} disabled={!v.provider_name || !v.service_description}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExitPlanForm({ tenantId, onSave }: { tenantId: string; onSave: (v: any) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ title: "", trigger_conditions: "", rto_hours: 24, rpo_minutes: 60, status: "draft" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> Add exit plan</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Exit plan</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="e.g. Demo Bank EMEA EOD discrepancy review" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          <Textarea placeholder="Trigger conditions" value={v.trigger_conditions} onChange={(e) => setV({ ...v, trigger_conditions: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" placeholder="e.g. 4 (Demo Bank target RTO)" value={v.rto_hours} onChange={(e) => setV({ ...v, rto_hours: Number(e.target.value) })} />
            <Input type="number" placeholder="e.g. 15 (Demo Bank target RPO)" value={v.rpo_minutes} onChange={(e) => setV({ ...v, rpo_minutes: Number(e.target.value) })} />
          </div>
          <Button onClick={async () => { await onSave({ ...v, tenant_id: tenantId }); setOpen(false); }} disabled={!v.title}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IncidentForm({ tenantId, onSave }: { tenantId: string; onSave: (v: any) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ classification: "major", root_cause: "", notes: "", reported_to_regulator: false, regulator_ref: "" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> Log incident</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Log ICT incident</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={v.classification} onValueChange={(x) => setV({ ...v, classification: x })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="major">Major</SelectItem>
              <SelectItem value="significant">Significant</SelectItem>
              <SelectItem value="minor">Minor</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="e.g. Citi FX cut-off applied 1 day earlier than Demo Bank GL" value={v.root_cause} onChange={(e) => setV({ ...v, root_cause: e.target.value })} />
          <Textarea placeholder="e.g. Demo Bank Treasury confirmed — reversing T+1, no client impact" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          <Input placeholder="e.g. FCA-BR-2026-0421 / OCC-RPT-9912" value={v.regulator_ref} onChange={(e) => setV({ ...v, regulator_ref: e.target.value, reported_to_regulator: !!e.target.value })} />
          <Button onClick={async () => { await onSave({ ...v, tenant_id: tenantId }); setOpen(false); }}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
