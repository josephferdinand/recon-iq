import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Play, Plus } from "lucide-react";
import {
  listReportingExports, upsertReportingExport, triggerReportingExport,
} from "@/lib/reporting-db.functions";

const DESTINATIONS = ["s3", "gcs", "azure", "snowflake", "redshift", "bigquery", "sftp"] as const;
const FORMATS = ["parquet", "csv", "jsonl"] as const;

export function ReportingDbTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listReportingExports);
  const upsert = useServerFn(upsertReportingExport);
  const trigger = useServerFn(triggerReportingExport);

  const [draft, setDraft] = useState({
    name: "", format: "parquet" as (typeof FORMATS)[number],
    destination_kind: "s3" as (typeof DESTINATIONS)[number], bucket: "", path: "", schedule: "",
  });

  const q = useQuery({
    queryKey: ["reporting-exports", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId } }),
    staleTime: 30_000,
  });

  const mUpsert = useMutation({
    mutationFn: () => upsert({ data: {
      tenant_id: tenantId, name: draft.name, format: draft.format,
      destination_kind: draft.destination_kind,
      destination_config: { bucket: draft.bucket, path: draft.path },
      scope: {}, schedule_cron: draft.schedule || null, is_enabled: true,
    } }),
    onSuccess: () => { toast.success("Export configured"); setDraft({ ...draft, name: "", bucket: "", path: "", schedule: "" }); qc.invalidateQueries({ queryKey: ["reporting-exports", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mTrigger = useMutation({
    mutationFn: (id: string) => trigger({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r: any) => { toast.success(`Queued — ${r.queued_rows} rows`); qc.invalidateQueries({ queryKey: ["reporting-exports", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Reporting database / BI export</CardTitle>
          <CardDescription>Stable BI-ready schema dropped to Parquet / CSV / JSONL — connect via ODBC/JDBC. Snowflake, Redshift, BigQuery, S3, GCS, Azure, SFTP.</CardDescription>
        </CardHeader>
        {canWrite ? (
          <CardContent className="space-y-3 border-t pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input placeholder="e.g. Demo Bank Nostro Breaks — 2026-Q2" value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              <Select value={draft.destination_kind} onValueChange={(v: any) => setDraft((d) => ({ ...d, destination_kind: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DESTINATIONS.map((k) => <SelectItem key={k} value={k}>{k.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={draft.format} onValueChange={(v: any) => setDraft((d) => ({ ...d, format: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FORMATS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="e.g. demo-bank-nostro-eod" value={draft.bucket}
                onChange={(e) => setDraft((d) => ({ ...d, bucket: e.target.value }))} />
              <Input placeholder="e.g. /demo-bank/nostro/usd/ or schema falcon_gl" value={draft.path}
                onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))} />
              <Input placeholder="e.g. 15 6 * * 1-5 — Demo Bank Nostro USD weekdays 06:15 UTC" value={draft.schedule}
                onChange={(e) => setDraft((d) => ({ ...d, schedule: e.target.value }))} />
            </div>
            <Button onClick={() => mUpsert.mutate()} disabled={!draft.name || mUpsert.isPending}>
              <Plus className="mr-2 h-4 w-4" /> Add export
            </Button>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th><th className="px-4 py-2">Destination</th>
                <th className="px-4 py-2">Format</th><th className="px-4 py-2">Schedule</th>
                <th className="px-4 py-2">Last run</th><th className="px-4 py-2">Enabled</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-xs"><Badge variant="outline">{r.destination_kind.toUpperCase()}</Badge></td>
                  <td className="px-4 py-2 text-xs">{r.format}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.schedule_cron ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.last_run_at ? `${new Date(r.last_run_at).toLocaleString()} · ${r.last_run_status}` : "—"}
                  </td>
                  <td className="px-4 py-2"><Switch checked={r.is_enabled} disabled /></td>
                  <td className="px-4 py-2 text-right">
                    {canWrite ? (
                      <Button size="sm" variant="outline" onClick={() => mTrigger.mutate(r.id)} disabled={mTrigger.isPending}>
                        <Play className="mr-1 h-3 w-3" /> Run now
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {q.data && q.data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No exports configured. Example: nightly export of Demo Bank Nostro USD breaks to S3 bucket demo-bank-recon-reports.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
