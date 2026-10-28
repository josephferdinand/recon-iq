import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listLineageEdges, lineageEvidencePack } from "@/lib/lineage.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitMerge, FileDown, RefreshCw } from "lucide-react";
function safeActionErrorMessage(_: unknown) { return "The request could not be completed. Check access and retry."; }
function QueryErrorFeedback({ onRetry, resource }: { error: unknown; onRetry: () => unknown; resource: string }) {
  return <div role="alert"><p>{resource} could not be loaded. Check access and retry.</p><Button variant="outline" onClick={() => void onRetry()}>Retry</Button></div>;
}
import { toast } from "sonner";

export function LineageTab({ tenantId }: { tenantId: string }) {
  const fetchEdges = useServerFn(listLineageEdges);
  const exportFn = useServerFn(lineageEvidencePack);
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => { setTarget(""); setSearch(""); }, [tenantId]);
  const q = useQuery({ queryKey: ["lineage", tenantId], queryFn: () => fetchEdges({ data: { tenant_id: tenantId, limit: 500 } }) });
  const rows = !q.isError && !q.isFetching ? q.data : undefined;
  const targets = useMemo(() => {
    const map = new Map<string, NonNullable<typeof q.data>[number]>();
    for (const edge of rows ?? []) { const key = JSON.stringify([edge.target_kind, edge.target_ref]); if (!map.has(key)) map.set(key, edge); }
    return map;
  }, [rows]);
  const needle = search.trim().toLowerCase();
  const filtered = (rows ?? []).filter((edge) => (!target || JSON.stringify([edge.target_kind, edge.target_ref]) === target)
    && (!needle || [edge.source_label, edge.source_ref, edge.target_label, edge.target_ref, edge.transform].some((value) => value?.toLowerCase().includes(needle))));
  const selected = targets.get(target);
  const validTarget = !target || !!selected;
  const handleExport = async () => {
    if (!rows?.length || !validTarget || exporting) return;
    setExporting(true);
    try {
      const pack = await exportFn({ data: { tenant_id: tenantId, ...(selected ? { target_kind: selected.target_kind, target_ref: selected.target_ref } : {}) } });
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "recorded-lineage-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { toast.error(safeActionErrorMessage(error)); }
    finally { setExporting(false); }
  };
  return (
    <section className="space-y-4" aria-labelledby="lineage-heading">
      <Card><CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div><CardTitle id="lineage-heading" className="flex items-center gap-2 text-base"><GitMerge className="h-4 w-4" aria-hidden /> Recorded data lineage</CardTitle>
          <CardDescription>Inspect persisted source-to-target relationships, transformations and recording details visible to your account.</CardDescription></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" disabled={q.isFetching} onClick={() => { void q.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" aria-hidden />Refresh</Button>
          <Button variant="outline" size="sm" disabled={!rows?.length || !validTarget || exporting} onClick={() => { void handleExport(); }}><FileDown className="mr-2 h-4 w-4" aria-hidden />{exporting ? "Exporting…" : "Export recorded links"}</Button></div>
      </CardHeader><CardContent>
        {q.isError ? <QueryErrorFeedback error={q.error} onRetry={q.refetch} resource="Recorded lineage" /> : !rows ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading visible lineage records…</p> : rows.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No recorded lineage links are visible to your account. This does not prove that transformations or dependencies do not exist.</p> : <>
          <div className="flex flex-wrap gap-3 text-sm"><Badge variant="outline">{rows.length} loaded links</Badge><Badge variant="outline">{targets.size} recorded targets</Badge><Badge variant="outline">{filtered.length} links in this view</Badge></div>
          <p className="mt-3 text-sm text-muted-foreground">This is a bounded view of up to 500 RLS-visible recorded links. It does not certify complete provenance, a full multi-hop trace or regulatory compliance.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm"><span>Trace a recorded target</span><select className="h-10 w-full rounded-md border bg-background px-3" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">All loaded targets</option>{[...targets.entries()].map(([key, edge]) => <option key={key} value={key}>{edge.target_label ?? edge.target_ref} ({edge.target_kind})</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>Find a label, reference or transformation</span><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded records" /></label></div>
          <p className="mt-2 text-xs text-muted-foreground">Search narrows displayed records. Export performs a fresh authorized read for the selected target (or all targets), with its own timestamp and 500-link limit; arbitrary attributes are omitted.</p>
        </>}
      </CardContent></Card>
      {rows?.length ? <Card><CardHeader><CardTitle className="text-base">Direct recorded relationships</CardTitle><CardDescription>References identify recorded resources; their contents and further hops are not inferred.</CardDescription></CardHeader><CardContent>
        {!validTarget ? <p role="alert">The selected target is not present in the current loaded records. Choose a visible target.</p> : filtered.length === 0 ? <p>No loaded links match this filter. Clear the filter to inspect the visible records.</p> : <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="Recorded lineage relationships"><thead className="border-b text-left text-muted-foreground"><tr><th className="py-3 pr-3">Source</th><th className="py-3 pr-3">Recorded transformation</th><th className="py-3 pr-3">Target</th><th className="py-3">Recording details</th></tr></thead><tbody>{filtered.map((edge) => <tr key={edge.id} className="border-b align-top"><td className="py-3 pr-3"><p>{edge.source_label ?? edge.source_ref}</p><p className="text-xs text-muted-foreground">{edge.source_kind}</p><code className="break-all text-xs">{edge.source_ref}</code></td><td className="py-3 pr-3 whitespace-pre-wrap">{edge.transform ?? "Transformation not recorded"}</td><td className="py-3 pr-3"><p>{edge.target_label ?? edge.target_ref}</p><p className="text-xs text-muted-foreground">{edge.target_kind}</p><code className="break-all text-xs">{edge.target_ref}</code></td><td className="py-3"><details><summary className="cursor-pointer">Recorded details</summary><dl className="mt-2 space-y-2 text-xs"><dt>Relationship ID</dt><dd className="break-all">{edge.id}</dd><dt>Recorded at</dt><dd>{edge.recorded_at ?? "Not returned"}</dd><dt>Recorded by</dt><dd className="break-all">{edge.recorded_by ?? "Not returned"}</dd></dl></details></td></tr>)}</tbody></table></div>}
      </CardContent></Card> : null}
    </section>
  );
}
