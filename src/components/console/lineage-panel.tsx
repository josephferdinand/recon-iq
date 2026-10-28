/**
 * LineagePanel — Data lineage graph summary for the Domain Console.
 * Renders source→target edges grouped by kind, with a click-to-drill
 * dialog that shows the underlying edges + audit trail for that pair.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowRight, ChevronRight } from "lucide-react";
import { EmptyStateAction } from "@/components/console-header";
import { listLineageEdges } from "@/lib/lineage.functions";
import { listLineageForKindPair } from "@/lib/domain-console.functions";
import { DomainAuditTrail } from "@/components/console/domain-audit-trail";

type Edge = {
  id: string;
  source_kind: string;
  source_ref: string;
  source_label?: string | null;
  target_kind: string;
  target_ref: string;
  target_label?: string | null;
  transform?: string | null;
  recorded_at: string;
};

export function LineagePanel({ tenantId }: { tenantId: string }) {
  const [drillPair, setDrillPair] = useState<{ source_kind: string; target_kind: string } | null>(null);
  const lst = useServerFn(listLineageEdges);
  const q = useQuery({
    queryKey: ["lineage-panel", tenantId],
    queryFn: () => lst({ data: { tenant_id: tenantId, limit: 500 } }),
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  const edges = (q.data ?? []) as Edge[];

  if (edges.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Data lineage</CardTitle>
          <CardDescription>Source → landing → staging → recon → GL — audit-grade provenance.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyStateAction
            title="No lineage edges recorded yet"
            description="Lineage is captured automatically as ERP connectors ingest data and as recons run. Trigger a recon or run an ERP sync to populate."
            actions={[
              { label: "ERP connectors", href: "../erp-connectors", variant: "default" },
              { label: "Lineage guide", href: "/docs/architecture/00_README.md" },
            ]}
          />
        </CardContent>
      </Card>
    );
  }

  // Aggregate by kind pair
  const kindPairs: Record<string, { count: number; sample: Edge }> = {};
  const nodes = new Set<string>();
  edges.forEach((e) => {
    const key = `${e.source_kind}→${e.target_kind}`;
    kindPairs[key] = kindPairs[key] ?? { count: 0, sample: e };
    kindPairs[key].count += 1;
    nodes.add(`${e.source_kind}:${e.source_ref}`);
    nodes.add(`${e.target_kind}:${e.target_ref}`);
  });
  const pairsSorted = Object.entries(kindPairs).sort((a, b) => b[1].count - a[1].count);

  const sourceKinds = new Set(edges.map((e) => e.source_kind));
  const targetKinds = new Set(edges.map((e) => e.target_kind));

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Edges" value={edges.length} />
        <Tile label="Nodes" value={nodes.size} />
        <Tile label="Source kinds" value={sourceKinds.size} />
        <Tile label="Target kinds" value={targetKinds.size} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flow map</CardTitle>
          <CardDescription>Click a pair to open its underlying edges + audit trail.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {pairsSorted.map(([key, v]) => {
            const [src, tgt] = key.split("→");
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDrillPair({ source_kind: src, target_kind: tgt })}
                className="flex w-full items-center gap-3 rounded-md border p-2 text-sm hover:bg-muted/40 text-left"
              >
                <Badge variant="outline" className="min-w-[6rem] justify-center">{src}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline" className="min-w-[6rem] justify-center">{tgt}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">{v.count.toLocaleString()} edge{v.count === 1 ? "" : "s"}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent edges</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">When</th><th>Source</th><th>Target</th><th>Transform</th>
              </tr>
            </thead>
            <tbody>
              {edges.slice(0, 20).map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-1 whitespace-nowrap">{new Date(e.recorded_at).toLocaleDateString()}</td>
                  <td><Badge variant="outline" className="text-[10px]">{e.source_kind}</Badge> <code>{e.source_label ?? e.source_ref}</code></td>
                  <td><Badge variant="outline" className="text-[10px]">{e.target_kind}</Badge> <code>{e.target_label ?? e.target_ref}</code></td>
                  <td className="text-muted-foreground truncate max-w-[16rem]">{e.transform ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <DomainAuditTrail tenantId={tenantId} resourceType="data_lineage_edges" />

      <LineageDrillDialog
        tenantId={tenantId}
        pair={drillPair}
        onClose={() => setDrillPair(null)}
      />
    </div>
  );
}

function LineageDrillDialog({
  tenantId,
  pair,
  onClose,
}: {
  tenantId: string;
  pair: { source_kind: string; target_kind: string } | null;
  onClose: () => void;
}) {
  const fn = useServerFn(listLineageForKindPair);
  const q = useQuery({
    enabled: !!pair,
    queryKey: ["lineage-pair", tenantId, pair?.source_kind, pair?.target_kind],
    queryFn: () => fn({
      data: { tenant_id: tenantId, source_kind: pair!.source_kind, target_kind: pair!.target_kind, limit: 100 },
    }),
  });
  const edges = ((q.data as { edges: Edge[] } | undefined)?.edges ?? []) as Edge[];
  const pairKey = pair ? `${pair.source_kind}→${pair.target_kind}` : "";

  return (
    <Dialog open={!!pair} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="outline">{pair?.source_kind}</Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant="outline">{pair?.target_kind}</Badge>
          </DialogTitle>
          <DialogDescription>
            {edges.length} edge{edges.length === 1 ? "" : "s"} · hash-anchored provenance for regulatory evidence.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <ScrollArea className="h-[520px] pr-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">When</th><th>Source ref</th><th>Target ref</th><th>Transform</th><th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {edges.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No edges under RLS visibility.</td></tr>
                  )}
                  {edges.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="py-1 whitespace-nowrap">{new Date(e.recorded_at).toLocaleString()}</td>
                      <td><code>{e.source_label ?? e.source_ref}</code></td>
                      <td><code>{e.target_label ?? e.target_ref}</code></td>
                      <td className="text-muted-foreground truncate max-w-[14rem]">{e.transform ?? "—"}</td>
                      <td><code className="text-[10px]">{((e as unknown as { evidence_hash?: string }).evidence_hash ?? "").slice(0, 10) || "—"}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <div>
              <p className="text-sm font-medium mb-2">Audit trail for this pair</p>
              <ScrollArea className="h-[520px] pr-3">
                <DomainAuditTrail
                  tenantId={tenantId}
                  resourceType="data_lineage_edges"
                  resourceId={pairKey}
                  compact
                />
              </ScrollArea>
            </div>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}
