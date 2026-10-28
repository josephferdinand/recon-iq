/**
 * SiloLadderPanel — Visual silo tier ladder for the Scale Console.
 * Renders tiers as a stacked ladder with isolation, cost band, RPO/RTO, and highlights the tenant's active tier.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, Layers, Shield } from "lucide-react";
import { listSiloTiers, listTenantSiloAssignments } from "@/lib/phase8-silo.functions";

type Tier = {
  code: string;
  name: string;
  description?: string | null;
  isolation_kind: string;
  enabled?: boolean;
};
type Assignment = {
  id: string;
  silo_tier_code: string;
  region?: string | null;
  status: string;
  requested_at?: string | null;
  activated_at?: string | null;
};

// Static ladder metadata — enrich real tier catalog with SLA/cost bands.
const TIER_META: Record<string, { rank: number; rpo: string; rto: string; costBand: string; guarantees: string[] }> = {
  shared: { rank: 1, rpo: "1h", rto: "4h", costBand: "$", guarantees: ["Shared cluster", "Row-level tenant isolation via RLS"] },
  schema: { rank: 2, rpo: "30m", rto: "2h", costBand: "$$", guarantees: ["Dedicated schema", "Per-tenant grants", "Backup isolation"] },
  dedicated_db: { rank: 3, rpo: "15m", rto: "1h", costBand: "$$$", guarantees: ["Dedicated Postgres cluster", "Independent scaling", "Per-tenant backups"] },
  dedicated_region: { rank: 4, rpo: "5m", rto: "30m", costBand: "$$$$", guarantees: ["Dedicated region", "Data residency compliance", "Regional failover"] },
  airgapped: { rank: 5, rpo: "0m", rto: "instant", costBand: "$$$$$", guarantees: ["Air-gapped enclave", "Customer-managed keys", "SOC 2 + IL5 posture"] },
};

export function SiloLadderPanel({ tenantId }: { tenantId: string }) {
  const lt = useServerFn(listSiloTiers);
  const la = useServerFn(listTenantSiloAssignments);
  const tiersQ = useQuery({ queryKey: ["silo-ladder-tiers"], queryFn: () => lt({ data: {} }) });
  const assignsQ = useQuery({ queryKey: ["silo-ladder-assigns", tenantId], queryFn: () => la({ data: { tenant_id: tenantId } }) });

  if (tiersQ.isLoading || assignsQ.isLoading) return <Skeleton className="h-64 w-full" />;
  const tiers = ((tiersQ.data ?? []) as Tier[]).slice().sort((a, b) => (TIER_META[a.code]?.rank ?? 99) - (TIER_META[b.code]?.rank ?? 99));
  const assigns = (assignsQ.data ?? []) as Assignment[];
  const active = assigns.find((a) => a.status === "active");
  const activeCode = active?.silo_tier_code ?? "shared";

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Isolation ladder</CardTitle>
          <CardDescription>Progression from shared multi-tenant to fully air-gapped. Your current tier is highlighted.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {tiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tier catalog empty — seed via <code>silo_tier_catalog</code> migration.</p>
          ) : tiers.map((t) => {
            const meta = TIER_META[t.code] ?? { rank: 99, rpo: "—", rto: "—", costBand: "?", guarantees: [] };
            const isActive = t.code === activeCode;
            return (
              <div
                key={t.code}
                className={`rounded-md border p-3 flex flex-col md:flex-row gap-3 items-start ${
                  isActive ? "border-emerald-500/60 bg-emerald-500/5" : ""
                }`}
              >
                <div className="flex items-center gap-2 min-w-[10rem]">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${isActive ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {meta.rank}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground"><Layers className="h-3 w-3 inline mr-0.5" />{t.isolation_kind}</p>
                  </div>
                </div>
                <div className="flex-1 text-xs">
                  <p className="text-muted-foreground">{t.description ?? "—"}</p>
                  <div className="flex gap-1 flex-wrap mt-1">
                    {meta.guarantees.map((g) => <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>)}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span><Clock className="h-3 w-3 inline mr-0.5" />RPO {meta.rpo}</span>
                  <span><Shield className="h-3 w-3 inline mr-0.5" />RTO {meta.rto}</span>
                  <Badge variant="secondary" className="font-mono">{meta.costBand}</Badge>
                  {isActive ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Active</Badge>
                  ) : (
                    <Button size="sm" variant="outline" disabled>Request upgrade</Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {assigns.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Assignment history</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Tier</th><th>Region</th><th>Status</th><th>Requested</th><th>Activated</th></tr></thead>
              <tbody>
                {assigns.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="py-1"><code>{a.silo_tier_code}</code></td>
                    <td>{a.region ?? "—"}</td>
                    <td><Badge variant={a.status === "active" ? "default" : "secondary"}>{a.status}</Badge></td>
                    <td>{a.requested_at ? new Date(a.requested_at).toLocaleDateString() : "—"}</td>
                    <td>{a.activated_at ? new Date(a.activated_at).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
