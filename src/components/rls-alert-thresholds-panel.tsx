// Platform-admin UI for managing RLS-denial spike alert thresholds.
// Rows are per-tenant overrides; the row with tenant_id=NULL is the platform default.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, Bell, Plus, Play, Trash2 } from "lucide-react";
import {
  listRlsAlertThresholds, upsertRlsAlertThreshold,
  deleteRlsAlertThreshold, evaluateRlsAlertsNow, listTenantsLite,
} from "@/lib/rls-alerts.functions";

type Row = {
  id: string;
  tenant_id: string | null;
  window_minutes: number;
  threshold: number;
  cooldown_minutes: number;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
  resource_filter: string | null;
  last_triggered_at: string | null;
  last_triggered_count: number | null;
  tenant?: { id: string; name: string; slug: string } | null;
};

const empty = (): Partial<Row> => ({
  tenant_id: null,
  window_minutes: 15,
  threshold: 25,
  cooldown_minutes: 60,
  severity: "warning",
  enabled: true,
  resource_filter: "",
});

export function RlsAlertThresholdsPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listRlsAlertThresholds);
  const tenants = useServerFn(listTenantsLite);
  const upsert = useServerFn(upsertRlsAlertThreshold);
  const remove = useServerFn(deleteRlsAlertThreshold);
  const evalNow = useServerFn(evaluateRlsAlertsNow);

  const rowsQ = useQuery({ queryKey: ["rls-alert-thresholds"], queryFn: () => list({ data: {} }) });
  const tenantsQ = useQuery({ queryKey: ["tenants-lite"], queryFn: () => tenants({ data: {} }) });

  const [editing, setEditing] = useState<Partial<Row> | null>(null);

  const usedTenantIds = useMemo(
    () => new Set(((rowsQ.data ?? []) as any[]).map((r) => r.tenant_id).filter(Boolean) as string[]),
    [rowsQ.data],
  );

  const saveM = useMutation({
    mutationFn: (data: any) => upsert({ data }),
    onSuccess: () => {
      toast.success("Threshold saved");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["rls-alert-thresholds"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const delM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Threshold removed");
      qc.invalidateQueries({ queryKey: ["rls-alert-thresholds"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const runM = useMutation({
    mutationFn: () => evalNow({ data: {} }),
    onSuccess: (out: any) => {
      const fired = (out ?? []).filter((r: any) => r.alerted).length;
      toast.success(`Evaluation complete · ${fired} alert(s) fired`);
      qc.invalidateQueries({ queryKey: ["rls-alert-thresholds"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Evaluation failed"),
  });

  const rows = ((rowsQ.data ?? []) as any[]) as Row[];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-600" />
            RLS denial-spike alerts
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Background job runs every 5 minutes. When a tenant's
            <code className="mx-1">rls_denied</code> count in the configured window crosses the threshold,
            every platform admin is notified in-app and a security event is recorded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => runM.mutate()} disabled={runM.isPending}>
            <Play className="mr-1 h-3 w-3" /> Evaluate now
          </Button>
          <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setEditing(empty())}>
                <Plus className="mr-1 h-3 w-3" /> New override
              </Button>
            </DialogTrigger>
            <ThresholdEditor
              value={editing}
              tenants={(tenantsQ.data ?? []).filter((t: any) => !usedTenantIds.has(t.id) || t.id === editing?.tenant_id)}
              onCancel={() => setEditing(null)}
              onSave={(v) => saveM.mutate(v)}
              saving={saveM.isPending}
            />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Window</th>
                <th className="px-4 py-2">Threshold</th>
                <th className="px-4 py-2">Cooldown</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Resource filter</th>
                <th className="px-4 py-2">Last triggered</th>
                <th className="px-4 py-2">Enabled</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/10">
                  <td className="px-4 py-2 text-xs">
                    {r.tenant_id === null
                      ? <Badge>Platform default</Badge>
                      : <span>{r.tenant?.name ?? r.tenant_id.slice(0, 8)}</span>}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.window_minutes} min</td>
                  <td className="px-4 py-2 text-xs font-mono">{r.threshold}</td>
                  <td className="px-4 py-2 text-xs">{r.cooldown_minutes} min</td>
                  <td className="px-4 py-2 text-xs">
                    <Badge variant={r.severity === "critical" ? "destructive" : "outline"}>{r.severity}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono">{r.resource_filter ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    {r.last_triggered_at
                      ? (<span className="flex items-center gap-1 text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          {new Date(r.last_triggered_at).toLocaleString()} ({r.last_triggered_count})
                        </span>)
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.enabled ? "Yes" : "No"}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>
                      {r.tenant_id !== null && (
                        <Button size="sm" variant="outline" onClick={() => {
                          if (confirm("Remove this tenant override?")) delM.mutate(r.id);
                        }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No thresholds configured. Example: alert ReconIQ platform admins if RLS denials &gt; 20 in 5 min on falcon_nostro_usd_recon.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ThresholdEditor({
  value, tenants, onCancel, onSave, saving,
}: {
  value: Partial<Row> | null;
  tenants: { id: string; name: string }[];
  onCancel: () => void;
  onSave: (v: any) => void;
  saving: boolean;
}) {
  const [v, setV] = useState<Partial<Row>>(value ?? empty());
  // Re-sync when dialog opens with a new row
  useMemo(() => { if (value) setV(value); }, [value]);
  const isDefault = v.tenant_id === null;
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{v.id ? "Edit threshold" : "New tenant override"}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-xs">Tenant</Label>
          <Select
            value={v.tenant_id ?? "__default__"}
            onValueChange={(s) => setV({ ...v, tenant_id: s === "__default__" ? null : s })}
            disabled={!!v.id}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">Platform default (all tenants)</SelectItem>
              {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {isDefault && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Applies to every tenant without a specific override.
            </p>
          )}
        </div>
        <div>
          <Label className="text-xs">Window (minutes)</Label>
          <Input type="number" min={1} max={1440} value={v.window_minutes ?? 15}
            onChange={(e) => setV({ ...v, window_minutes: +e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Threshold (denials)</Label>
          <Input type="number" min={1} value={v.threshold ?? 25}
            onChange={(e) => setV({ ...v, threshold: +e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Cooldown (minutes)</Label>
          <Input type="number" min={1} max={1440} value={v.cooldown_minutes ?? 60}
            onChange={(e) => setV({ ...v, cooldown_minutes: +e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Severity</Label>
          <Select value={v.severity ?? "warning"} onValueChange={(s: any) => setV({ ...v, severity: s })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="warning">warning</SelectItem>
              <SelectItem value="critical">critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Resource filter (optional)</Label>
          <Input placeholder="e.g. agent_actions.update"
            value={v.resource_filter ?? ""}
            onChange={(e) => setV({ ...v, resource_filter: e.target.value })} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            When set, only denials whose <code>context.resource</code> matches exactly are counted.
          </p>
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <Switch checked={!!v.enabled} onCheckedChange={(b) => setV({ ...v, enabled: b })} />
          <Label className="text-xs">Enabled</Label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={saving}
          onClick={() => onSave({
            id: v.id,
            tenant_id: v.tenant_id ?? null,
            window_minutes: v.window_minutes ?? 15,
            threshold: v.threshold ?? 25,
            cooldown_minutes: v.cooldown_minutes ?? 60,
            severity: v.severity ?? "warning",
            resource_filter: (v.resource_filter ?? "").trim() || null,
            enabled: v.enabled ?? true,
          })}
        >
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
