import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRetentionPolicies, setRetentionOverride, listArchiveLedger } from "@/lib/retention.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Archive, ShieldCheck, Trash2, Save } from "lucide-react";

export function RetentionTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listRetentionPolicies);
  const setOv = useServerFn(setRetentionOverride);
  const listLedger = useServerFn(listArchiveLedger);

  const q = useQuery({
    queryKey: ["retention", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId } }),
  });
  const ledger = useQuery({
    queryKey: ["retention-ledger", tenantId],
    queryFn: () => listLedger({ data: { tenant_id: tenantId, limit: 50 } }),
  });
  const [draft, setDraft] = useState<Record<string, { days: string; reason: string }>>({});

  const m = useMutation({
    mutationFn: (v: { table_name: string; retention_days: number | null; reason?: string }) =>
      setOv({ data: { tenant_id: tenantId, ...v } }),
    onSuccess: () => {
      toast.success("Retention updated");
      qc.invalidateQueries({ queryKey: ["retention", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rows = q.data?.tables ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Data retention</CardTitle>
          <CardDescription>
            Platform defaults follow regulatory minimums (SOX, SOC 2, GDPR). You may set a longer per-table retention for your tenant; you cannot reduce below the platform default. <code>audit_log</code> is regulatory append-only and never auto-purged.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Table</th>
                <th className="px-4 py-2">Platform default</th>
                <th className="px-4 py-2">Your override (days)</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Effective</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const d = draft[r.table_name] ?? { days: r.override_days ?? "", reason: r.override_reason ?? "" };
                const eff = r.override_days ?? r.default_days;
                return (
                  <tr key={r.table_name} className="border-b align-top">
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.table_name}
                      {!r.purgeable && <Badge variant="outline" className="ml-2">Append-only</Badge>}
                      {r.basis && <div className="text-[10px] text-muted-foreground">{r.basis}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs">{r.default_days ?? "—"} d</td>
                    <td className="px-4 py-2">
                      <Input
                        type="number"
                        min={r.default_days ?? 1}
                        max={3650}
                        disabled={!canWrite || !r.purgeable}
                        value={String(d.days)}
                        onChange={(e) => setDraft({ ...draft, [r.table_name]: { ...d, days: e.target.value } })}
                        className="h-8 w-24"
                        placeholder="(default)"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        disabled={!canWrite || !r.purgeable}
                        value={d.reason}
                        onChange={(e) => setDraft({ ...draft, [r.table_name]: { ...d, reason: e.target.value } })}
                        className="h-8"
                        placeholder="e.g. internal audit requirement"
                      />
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <Badge variant={r.override_days ? "default" : "outline"}>{eff ?? "—"} d</Badge>
                    </td>
                    <td className="px-4 py-2 text-right space-x-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canWrite || !r.purgeable || m.isPending}
                        onClick={() => {
                          const n = parseInt(String(d.days), 10);
                          if (!Number.isFinite(n)) return toast.error("Enter days");
                          if (r.default_days && n < r.default_days) return toast.error(`Cannot reduce below platform default (${r.default_days}d)`);
                          m.mutate({ table_name: r.table_name, retention_days: n, reason: d.reason });
                        }}
                      >
                        <Save className="mr-1 h-3 w-3" /> Save
                      </Button>
                      {r.override_days && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canWrite || m.isPending}
                          onClick={() => m.mutate({ table_name: r.table_name, retention_days: null })}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {q.isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Archive className="h-4 w-4" /> Archive ledger</CardTitle>
          <CardDescription>Cold-storage archives created before purge. Each row is SHA-256 anchored for tamper evidence.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th><th className="px-4 py-2">Table</th>
                <th className="px-4 py-2">Rows</th><th className="px-4 py-2">Range</th>
                <th className="px-4 py-2">Status</th><th className="px-4 py-2">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {(ledger.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.table_name}</td>
                  <td className="px-4 py-2 text-xs">{r.row_count}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.earliest_ts ? new Date(r.earliest_ts).toLocaleDateString() : "—"} → {r.latest_ts ? new Date(r.latest_ts).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2 text-xs"><Badge variant="outline">{r.status}</Badge></td>
                  <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{(r.sha256_hex ?? "").slice(0, 16)}…</td>
                </tr>
              ))}
              {ledger.data && ledger.data.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Nothing To Display Yet — there are currently no archives. Audit events older than 90 days are archived to cold storage with SHA-256 anchoring once the storage connector is approved.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
