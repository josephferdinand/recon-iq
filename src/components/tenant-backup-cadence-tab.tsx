// Platform · Per-tenant backup cadence + SLA violations.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTenantBackupCadence,
  upsertTenantBackupSla,
  bulkUpsertTenantBackupSlas,
  recordTenantSnapshot,
  type TenantBackupRow,
} from "@/lib/tenant-backup.functions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, ShieldCheck, DatabaseBackup, Settings2, PlusCircle, Users } from "lucide-react";
import { toast } from "sonner";


function ageLabel(h: number | null) {
  if (h === null) return "never";
  if (h < 1) return "<1h";
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// Compact 30-day sparkline of snapshot counts.
function Sparkline({ data, breached }: { data: { d: string; c: number }[]; breached: boolean }) {
  const max = Math.max(1, ...data.map((x) => x.c));
  return (
    <div className="flex h-6 items-end gap-[1px]" aria-hidden>
      {data.map((b, i) => {
        const h = b.c === 0 ? 12 : Math.max(20, (b.c / max) * 100);
        const gap = b.c === 0;
        return (
          <div
            key={i}
            title={`${b.d}: ${b.c} snapshot${b.c === 1 ? "" : "s"}`}
            className={`w-[3px] rounded-sm ${gap
              ? "bg-muted-foreground/25"
              : breached ? "bg-destructive/70" : "bg-primary/80"}`}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
}

export function TenantBackupCadenceTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTenantBackupCadence);
  const upsertFn = useServerFn(upsertTenantBackupSla);
  const bulkFn = useServerFn(bulkUpsertTenantBackupSlas);
  const recordFn = useServerFn(recordTenantSnapshot);

  const q = useQuery({
    queryKey: ["platform-tenant-backup-cadence"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
  });

  const [filter, setFilter] = useState<"all" | "breached">("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TenantBackupRow | null>(null);
  const [form, setForm] = useState<{ sla: number; alerts: boolean; notes: string }>({
    sla: 26, alerts: true, notes: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState<{ sla: number; alerts: boolean; note: string }>({
    sla: 26, alerts: true, note: "",
  });


  const upsert = useMutation({
    mutationFn: (input: { tenant_id: string; sla: number; alerts: boolean; notes: string }) =>
      upsertFn({ data: {
        tenant_id: input.tenant_id,
        snapshot_sla_hours: input.sla,
        alerts_enabled: input.alerts,
        notes: input.notes || null,
      } }),
    onSuccess: () => {
      toast.success("SLA saved");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["platform-tenant-backup-cadence"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const record = useMutation({
    mutationFn: (tenant_id: string) => recordFn({ data: { tenant_id } }),
    onSuccess: () => {
      toast.success("Snapshot recorded");
      qc.invalidateQueries({ queryKey: ["platform-tenant-backup-cadence"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulk = useMutation({
    mutationFn: () => bulkFn({ data: {
      tenant_ids: Array.from(selected),
      snapshot_sla_hours: bulkForm.sla,
      alerts_enabled: bulkForm.alerts,
      change_note: bulkForm.note,
    } }),
    onSuccess: (r) => {
      toast.success(`Updated SLA for ${r.affected} tenant${r.affected === 1 ? "" : "s"}`);
      setBulkOpen(false);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["platform-tenant-backup-cadence"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const rows = q.data?.tenants ?? [];
  const platformSla = q.data?.platform_sla_hours ?? 26;
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "breached" && !r.sla_breached) return false;
      if (!s) return true;
      return r.name.toLowerCase().includes(s) || r.slug.toLowerCase().includes(s);
    });
  }, [rows, filter, search]);

  const breachedCount = rows.filter((r) => r.sla_breached).length;
  const failedTotal = rows.reduce((a, r) => a + r.failed_events_30d, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className={breachedCount > 0 ? "border-destructive/50 bg-destructive/5" : "border-primary/40 bg-primary/5"}>
          <CardHeader className="pb-2">
            <CardDescription>SLA violations</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {breachedCount > 0 ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <ShieldCheck className="h-5 w-5 text-primary" />}
              {breachedCount} / {rows.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Platform default SLA: <strong>{platformSla}h</strong>. Per-tenant overrides shown per row.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed backup / restore events (30d)</CardDescription>
            <CardTitle className="text-2xl">{failedTotal}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Across all tenants. Drill into each tenant to review event history.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Coverage</CardDescription>
            <CardTitle className="text-2xl">
              {rows.length === 0 ? "—" : `${Math.round(
                (rows.reduce((a, r) => a + r.snapshot_days_30d, 0) / (rows.length * 30)) * 100,
              )}%`}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Avg snapshot-day coverage over the last 30 days across all tenants.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DatabaseBackup className="h-4 w-4" /> Per-tenant backup cadence & SLA
            </CardTitle>
            <CardDescription>
              Latest snapshot age, 30-day cadence, and SLA status for every tenant. Rows in red
              violate the configured SLA (either no snapshot or older than threshold).
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search tenant…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="h-8 w-48"
            />
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
            <Button size="sm" variant={filter === "breached" ? "destructive" : "outline"} onClick={() => setFilter("breached")}>
              Breached only
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={selected.size === 0}
              onClick={() => {
                setBulkForm({ sla: platformSla, alerts: true, note: "" });
                setBulkOpen(true);
              }}
            >
              <Users className="mr-1 h-3.5 w-3.5" />
              Bulk edit SLA ({selected.size})
            </Button>
          </div>

        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <Checkbox
                      checked={filtered.length > 0 && filtered.every((r) => selected.has(r.tenant_id))}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) filtered.forEach((r) => next.add(r.tenant_id));
                        else filtered.forEach((r) => next.delete(r.tenant_id));
                        setSelected(next);
                      }}
                      aria-label="Select all filtered tenants"
                    />
                  </th>
                  <th className="px-4 py-2">Tenant</th>
                  <th className="px-4 py-2">Env</th>
                  <th className="px-4 py-2">Latest snapshot</th>
                  <th className="px-4 py-2">Age</th>
                  <th className="px-4 py-2">SLA</th>
                  <th className="px-4 py-2">30-day cadence</th>
                  <th className="px-4 py-2">Fails</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading && (<tr><td colSpan={10} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>)}
                {!q.isLoading && filtered.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-6 text-muted-foreground">No tenants match.</td></tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.tenant_id} className={`border-b ${r.sla_breached ? "bg-destructive/5" : ""}`}>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selected.has(r.tenant_id)}
                        onCheckedChange={(v) => {
                          const next = new Set(selected);
                          if (v) next.add(r.tenant_id); else next.delete(r.tenant_id);
                          setSelected(next);
                        }}
                        aria-label={`Select ${r.name}`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.slug}</div>
                    </td>
                    <td className="px-4 py-2"><Badge variant="outline">{r.environment}</Badge></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {r.latest_snapshot_at ? new Date(r.latest_snapshot_at).toLocaleString() : "—"}
                    </td>

                    <td className={`px-4 py-2 text-xs ${r.sla_breached ? "font-semibold text-destructive" : ""}`}>
                      {ageLabel(r.age_hours)}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {r.sla_hours}h {!r.alerts_enabled && <span className="ml-1 text-muted-foreground">(muted)</span>}
                    </td>
                    <td className="px-4 py-2 w-40">
                      <Sparkline data={r.cadence_30d} breached={r.sla_breached} />
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {r.snapshot_days_30d}/30 days
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {r.failed_events_30d > 0
                        ? <Badge variant="destructive">{r.failed_events_30d}</Badge>
                        : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-4 py-2">
                      {r.sla_breached
                        ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Breach</Badge>
                        : <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><ShieldCheck className="h-3 w-3" />OK</Badge>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => record.mutate(r.tenant_id)} title="Record snapshot now">
                        <PlusCircle className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        setEditing(r);
                        setForm({ sla: r.sla_hours, alerts: r.alerts_enabled, notes: r.notes ?? "" });
                      }}>
                        <Settings2 className="mr-1 h-3.5 w-3.5" /> SLA
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backup SLA — {editing?.name}</DialogTitle>
            <DialogDescription>
              Override the platform-wide {platformSla}h SLA for this tenant. Audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="sla">Snapshot SLA (hours)</Label>
              <Input id="sla" type="number" min={1} max={720} value={form.sla}
                onChange={(e) => setForm({ ...form, sla: Number(e.target.value) })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Alerts enabled</Label>
                <p className="text-xs text-muted-foreground">If off, breaches are computed but suppressed from summary counts.</p>
              </div>
              <Switch checked={form.alerts} onCheckedChange={(v) => setForm({ ...form, alerts: v })} />
            </div>
            <div>
              <Label htmlFor="n">Notes</Label>
              <Textarea id="n" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Regulated tenant — 12h SLA per MSA." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && upsert.mutate({
              tenant_id: editing.tenant_id,
              sla: form.sla,
              alerts: form.alerts,
              notes: form.notes,
            })} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save SLA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk edit SLA — {selected.size} tenant{selected.size === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Apply the same SLA and alert setting to every selected tenant. A single
              consolidated entry is written to the audit log with your change note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="bsla">Snapshot SLA (hours)</Label>
              <Input id="bsla" type="number" min={1} max={720} value={bulkForm.sla}
                onChange={(e) => setBulkForm({ ...bulkForm, sla: Number(e.target.value) })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Alerts enabled</Label>
                <p className="text-xs text-muted-foreground">Applied to every selected tenant.</p>
              </div>
              <Switch checked={bulkForm.alerts} onCheckedChange={(v) => setBulkForm({ ...bulkForm, alerts: v })} />
            </div>
            <div>
              <Label htmlFor="bnote">Change note (required, audit-logged)</Label>
              <Textarea id="bnote" value={bulkForm.note}
                onChange={(e) => setBulkForm({ ...bulkForm, note: e.target.value })}
                placeholder="e.g. Q3 SLA tightening — regulated tenants moved to 12h per MSA" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulk.mutate()}
              disabled={bulk.isPending || bulkForm.note.trim().length < 3 || selected.size === 0}
            >
              {bulk.isPending ? "Applying…" : `Apply to ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

