import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getTenantBySlug } from "@/lib/tenants.functions";
import {
  listReconEvidencePacks,
  getReconEvidencePack,
  verifyReconEvidenceChain,
  exportReconEvidencePack,
  generateReconEvidencePack,
} from "@/lib/recon-evidence.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Download, ShieldCheck, RefreshCw, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { formatReconRunId } from "@/lib/recon-run-id";

export const Route = createFileRoute("/_authenticated/$slug/recon/evidence")({
  component: ReconEvidencePage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">Failed to load: {error instanceof Error ? error.message : "An unexpected error occurred."}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

function ReconEvidencePage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/recon/evidence" });
  const qc = useQueryClient();
  const getTenant = useServerFn(getTenantBySlug);
  const listPacks = useServerFn(listReconEvidencePacks);
  const getPack = useServerFn(getReconEvidencePack);
  const verifyChain = useServerFn(verifyReconEvidenceChain);
  const exportPack = useServerFn(exportReconEvidencePack);
  const generatePack = useServerFn(generateReconEvidencePack);

  const [runFilter, setRunFilter] = useState("");
  const [openPackId, setOpenPackId] = useState<string | null>(null);

  const tenantQ = useQuery({
    queryKey: ["tenant-by-slug", slug],
    queryFn: () => getTenant({ data: { slug } }),
  });
  const tenantId = tenantQ.data?.id as string | undefined;

  const packsQ = useQuery({
    enabled: !!tenantId,
    queryKey: ["recon-evidence-packs", tenantId, runFilter],
    queryFn: () =>
      listPacks({ data: { tenantId: tenantId!, runId: runFilter || undefined, limit: 200 } }),
  });

  const verifyMut = useMutation({
    mutationFn: () => verifyChain({ data: { tenantId: tenantId! } }),
    onSuccess: (r) => {
      if (r.tampered.length === 0) {
        toast.success(`Chain verified — ${r.verified}/${r.total} packs intact`);
      } else {
        toast.error(`Tamper detected on ${r.tampered.length} pack(s)`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Verify failed"),
  });

  const regenMut = useMutation({
    mutationFn: (runId: string) => generatePack({ data: { tenantId: tenantId!, runId } }),
    onSuccess: () => {
      toast.success("New evidence pack generated");
      qc.invalidateQueries({ queryKey: ["recon-evidence-packs", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Generate failed"),
  });

  const detailQ = useQuery({
    enabled: !!openPackId && !!tenantId,
    queryKey: ["recon-evidence-pack", openPackId],
    queryFn: () => getPack({ data: { tenantId: tenantId!, packId: openPackId! } }),
  });

  const handleDownload = async (packId: string) => {
    try {
      const r = await exportPack({ data: { tenantId: tenantId!, packId } });
      const blob = new Blob([r.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = r.filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/$slug" params={{ slug }}>
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <FileCheck2 className="h-6 w-6 text-primary" />
              Reconciliation Evidence Packs
            </h1>
            <p className="text-sm text-muted-foreground">
              Immutable, hash-chained audit packs auto-generated for every reconciliation run.
              Captures definition version, match summary, exception closure rationale, and lineage.
            </p>
          </div>
        </div>
        <Button onClick={() => verifyMut.mutate()} disabled={verifyMut.isPending || !tenantId}>
          <ShieldCheck className="h-4 w-4 mr-1" />
          {verifyMut.isPending ? "Verifying…" : "Verify chain"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Input
            placeholder="Filter by recon run id (uuid)…"
            value={runFilter}
            onChange={(e) => setRunFilter(e.target.value.trim())}
            className="max-w-md"
          />
          {runFilter && (
            <Button
              variant="secondary"
              onClick={() => regenMut.mutate(runFilter)}
              disabled={regenMut.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Regenerate pack
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Packs ({packsQ.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {packsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !packsQ.data?.length ? (
            <p className="text-sm text-muted-foreground">No evidence packs yet for this tenant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-border">
                    <th className="py-2 pr-3">Generated</th>
                    <th className="py-2 pr-3">Run</th>
                    <th className="py-2 pr-3">Version</th>
                    <th className="py-2 pr-3">Matches</th>
                    <th className="py-2 pr-3">Exceptions</th>
                    <th className="py-2 pr-3">Closed</th>
                    <th className="py-2 pr-3">Row hash</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {packsQ.data.map((p: any) => (
                    <tr key={p.id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-2 pr-3 whitespace-nowrap">{new Date(p.generated_at).toLocaleString()}</td>
                      <td className="py-2 pr-3"><span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide">{p.run_uid ? formatReconRunId(p.run_uid, p.run_id) : "Run ID unavailable"}</span></td>
                      <td className="py-2 pr-3"><Badge variant="secondary">v{p.pack_version}</Badge></td>
                      <td className="py-2 pr-3">{p.match_count}</td>
                      <td className="py-2 pr-3">{p.exception_count}</td>
                      <td className="py-2 pr-3">{p.closure_count}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{p.row_hash_hex?.slice(0, 12)}…</td>
                      <td className="py-2 pr-3 text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => setOpenPackId(p.id)}>View</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDownload(p.id)}>
                          <Download className="h-3 w-3 mr-1" /> JSON
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openPackId} onOpenChange={(o) => !o && setOpenPackId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Evidence pack detail</DialogTitle>
          </DialogHeader>
          {detailQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : detailQ.data ? (
            <ScrollArea className="h-[60vh]">
              <pre className="text-xs bg-muted/40 p-3 rounded">
                {JSON.stringify(detailQ.data.payload, null, 2)}
              </pre>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
