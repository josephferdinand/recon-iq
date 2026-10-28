import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CalendarCheck, RefreshCw, Activity } from "lucide-react";
import {
  computeAgeing,
  listEodSignoffs, prepareEodSignoff, approveEodSignoff,
} from "@/lib/batch-bc.functions";
import { SubstantiationDrawer } from "@/components/substantiation-drawer";

export function AgeingTab({ tenantId }: { tenantId: string; canWrite: boolean }) {
  const read = useServerFn(computeAgeing);
  const [page, setPage] = useState(0);
  const q = useQuery({ queryKey: ["ageing-backlog", tenantId, page],
    queryFn: () => read({ data: { tenant_id: tenantId, page } }), staleTime: 30_000 });
  const result = !q.isError && !q.isFetching ? q.data : undefined;
  return <section className="space-y-4" aria-label="Exception ageing">
    <Card><CardHeader className="flex flex-wrap flex-row justify-between gap-3"><div>
      <CardTitle>Exception ageing</CardTitle><CardDescription>All authorized open exceptions, including records older than the trend window. Counts follow current access rules.</CardDescription>
    </div><Button variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>Refresh</Button></CardHeader><CardContent>
      {q.isError ? <div role="alert"><p>{String(q.error?.message).startsWith("Forbidden:") ? "Your access does not allow exception ageing." : "Exception ageing could not be loaded. Try again."}</p><Button variant="outline" onClick={() => void q.refetch()}>Retry</Button></div>
      : !result ? <p role="status">Loading authorized backlog…</p>
      : <><p className="mb-4 text-sm"><strong>{result.total_open.toLocaleString()}</strong> authorized open exceptions · Observed {new Date(result.observed_at).toLocaleString()}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-left"><tr><th className="py-3">Age (complete days)</th><th>Exceptions</th><th>Share of authorized backlog</th></tr></thead><tbody>{result.buckets.map(bucket => <tr key={bucket.name} className="border-b"><th className="py-3 text-left font-medium">{bucket.name}</th><td>{bucket.count.toLocaleString()}</td><td>{result.total_open ? (100 * bucket.count / result.total_open).toFixed(1) : "0.0"}%</td></tr>)}</tbody></table></div>
      {result.total_open === 0 ? <p className="mt-4">No open exceptions are visible under your current access.</p> : null}
      <p className="mt-4 text-xs text-muted-foreground">Backlog counts use the server aggregate, independent of detail pagination. Amounts below are recorded per exception; currencies are never combined. Aggregate currency exposure is not yet available.</p></>}
    </CardContent></Card>
    {result && result.total_open > 0 ? <Card><CardHeader><CardTitle className="text-base">Investigate exceptions</CardTitle><CardDescription>Page {page + 1} · up to 50 authorized records. Separate reads may observe concurrent changes.</CardDescription></CardHeader><CardContent>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-left"><tr><th>Exception / run</th><th>Age</th><th>State / priority</th><th>Recorded amount</th></tr></thead><tbody>{result.rows.map(row => <tr key={row.id} className="border-b"><td className="py-3"><details><summary className="cursor-pointer break-all font-mono text-xs">{row.id}</summary><p className="text-xs">Run: {row.run_id ?? "Not recorded"}</p></details></td><td>{row.age_days === null ? "Unavailable" : `${row.age_days} days`}</td><td>{row.lifecycle_state ?? "Unavailable"} / {row.priority ?? "Unavailable"}</td><td>{row.currency ?? "Currency unavailable"} {row.amount ?? "Amount unavailable"}</td></tr>)}</tbody></table></div>
      <div className="mt-4 flex justify-between"><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" disabled={!result.has_more} onClick={() => setPage(page + 1)}>Next</Button></div>
    </CardContent></Card> : null}
  </section>;
}

export function EodSignoffTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listEodSignoffs);
  const prep = useServerFn(prepareEodSignoff);
  const dec = useServerFn(approveEodSignoff);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const q = useQuery({ queryKey: ["eod", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }), staleTime: 30_000 });
  const mPrep = useMutation({
    mutationFn: () => prep({ data: { tenant_id: tenantId, period_date: period, note } }),
    onSuccess: () => { toast.success("EOD prepared"); setNote(""); qc.invalidateQueries({ queryKey: ["eod", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mDec = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "rejected" }) =>
      dec({ data: { id: v.id, tenant_id: tenantId, decision: v.decision } }),
    onSuccess: () => { toast.success("Recorded"); qc.invalidateQueries({ queryKey: ["eod", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarCheck className="h-4 w-4" /> End-of-day sign-off</CardTitle>
          <CardDescription>Maker-checker period close. Preparer cannot approve their own sign-off.</CardDescription>
        </CardHeader>
        {canWrite ? (
          <CardContent className="space-y-3 border-t pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input type="date" value={period} onChange={(e) => setPeriod(e.target.value)} />
              <Input placeholder="e.g. Demo Bank EOD 2026-06-26 — all nostro accounts reconciled, 3 breaks deferred to T+1" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button onClick={() => mPrep.mutate()} disabled={mPrep.isPending}>Prepare sign-off</Button>
            </div>
          </CardContent>
        ) : null}
      </Card>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Period</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Prepared</th><th className="px-4 py-2">Approved</th><th className="px-4 py-2">Metrics</th><th className="px-4 py-2 text-right">Action</th></tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">{r.period_date}</td>
                  <td className="px-4 py-2"><Badge variant={r.status === "approved" ? "default" : "outline"}>{r.status}</Badge></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.prepared_at ? new Date(r.prepared_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.approved_at ? new Date(r.approved_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{JSON.stringify(r.metrics)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <SubstantiationDrawer signoffId={r.id} tenantId={tenantId} period={r.period_date} canWrite={canWrite} />
                      {canWrite && r.status === "prepared" ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => mDec.mutate({ id: r.id, decision: "rejected" })} disabled={mDec.isPending}>Reject</Button>
                          <Button size="sm" onClick={() => mDec.mutate({ id: r.id, decision: "approved" })} disabled={mDec.isPending}>Approve</Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {q.data && q.data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No sign-offs yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
