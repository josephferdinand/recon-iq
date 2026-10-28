import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRuns } from "@/lib/recons.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { formatReconRunId } from "@/lib/recon-run-id";
import { useState } from "react";
import { ReconRunDetailWorkbench } from "@/components/recon-run-detail-dialog";
import { Button } from "@/components/ui/button";

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "—" : timestamp.toLocaleString();
}

function displayStatus(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase()) : "Status unavailable";
}

function statusVariant(value: string | null | undefined): "destructive" | "outline" | "default" | "secondary" {
  if (value === "failed") return "destructive";
  if (value === "running") return "outline";
  if (value === "completed") return "default";
  return "secondary";
}

export function RunHistoryTab({ tenantId }: { tenantId: string }) {
  const [selection, setSelection] = useState<{ definitionId: string; runId: string } | null>(null);
  const fn = useServerFn(listRuns);
  const q = useQuery({ queryKey: ["recon-runs", tenantId], queryFn: () => fn({ data: { tenant_id: tenantId } }) });
  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-2xl tracking-tight"><History className="h-5 w-5" /> Run History</CardTitle>
        <CardDescription>
          Showing up to 100 of the most recent runs in this workspace. Open a Run ID to inspect that exact result and view its reconciliation history over 24 hours or 7, 14, 30, or 90 days. Retention is configurable in Tenant → Features.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Run ID</th><th className="px-4 py-2">Reconciliation</th><th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Matched</th><th className="px-4 py-2">Exceptions</th>
              <th className="px-4 py-2">Input rows</th><th className="px-4 py-2">Started (local)</th><th className="px-4 py-2">Finished (local)</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending && !q.data ? <tr><td colSpan={8} role="status" className="px-4 py-8 text-center text-muted-foreground">Loading recent run history…</td></tr> : null}
            {q.isError ? (
              <tr><td colSpan={8} role="alert" className="px-4 py-6 text-center">
                <p className="text-sm font-medium text-destructive">{q.data ? "Run history could not be refreshed." : "Run history is temporarily unavailable."}</p>
                <p className="mt-1 text-sm text-muted-foreground">{q.data ? "Previously loaded runs are still shown." : "The service could not load recent runs. Try again shortly."}</p>
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
              </td></tr>
            ) : null}
            {(q.data ?? []).map((r: any) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-2"><button type="button" className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide underline underline-offset-2 focus-visible:outline focus-visible:outline-2" onClick={() => setSelection({ definitionId: r.definition_id, runId: r.id })} aria-label={`Open run ${formatReconRunId(r.run_uid, r.id)}`}>{formatReconRunId(r.run_uid, r.id)}</button></td>
                <td className="px-4 py-2">{r.definition?.name ?? "—"}</td>
                <td className="px-4 py-2">
                  <Badge variant={statusVariant(r.status)}>{displayStatus(r.status)}</Badge>
                </td>
                <td className="px-4 py-2 text-xs">{r.matched_count ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{r.exception_count ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{r.total_rows ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{formatTimestamp(r.started_at)}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{formatTimestamp(r.completed_at)}</td>
              </tr>
            ))}
            {!q.isPending && !q.isError && q.data?.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No runs are available in this workspace yet. Once a reconciliation runs, its results will appear here.</td></tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
      <ReconRunDetailWorkbench tenantId={tenantId} selection={selection} onClose={() => setSelection(null)} />
    </Card>
  );
}
