/**
 * ReconPacksPanel — Recon pack catalog + install status for the Vertical Console.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, PackageOpen, AlertCircle } from "lucide-react";
import { EmptyStateAction } from "@/components/console-header";
import { listRegulatoryPacks, listTenantPackInstalls } from "@/lib/regulatory.functions";

type Pack = {
  id: string;
  code: string;
  title: string;
  jurisdiction?: string | null;
  regulation?: string | null;
  version?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  install_count?: number | null;
};
type Install = {
  id: string;
  pack_id: string;
  installed_version?: string | null;
  installed_at: string;
  status: string;
  materialization_error?: string | null;
  materialized_at?: string | null;
  pack?: { code?: string; title?: string; regulation?: string } | null;
};

export function ReconPacksPanel({ tenantId }: { tenantId: string }) {
  const lp = useServerFn(listRegulatoryPacks);
  const li = useServerFn(listTenantPackInstalls);
  const packsQ = useQuery({ queryKey: ["packs-catalog"], queryFn: () => lp({ data: {} }) });
  const installsQ = useQuery({ queryKey: ["packs-installs", tenantId], queryFn: () => li({ data: { tenant_id: tenantId } }) });

  if (packsQ.isLoading || installsQ.isLoading) return <Skeleton className="h-64 w-full" />;
  const packs = (packsQ.data ?? []) as Pack[];
  const installs = (installsQ.data ?? []) as Install[];
  const installMap = new Map(installs.map((i) => [i.pack_id, i]));

  if (packs.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recon packs</CardTitle>
          <CardDescription>Prebuilt reconciliation templates per instrument, market, and regulation.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyStateAction
            title="Pack catalog is empty"
            description="No published regulatory packs are available. Ask your platform admin to seed the catalog via the regulatory packs migration."
            actions={[{ label: "Packs guide", href: "/docs/15_regulatory_packs.md" }]}
          />
        </CardContent>
      </Card>
    );
  }

  const failed = installs.filter((i) => i.status === "error" || i.status === "failed").length;
  const active = installs.filter((i) => i.status === "installed" || i.status === "materialized").length;

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Catalog" value={packs.length} />
        <Tile label="Installed" value={active} tone={active > 0 ? "positive" : "default"} />
        <Tile label="Failed installs" value={failed} tone={failed > 0 ? "danger" : "default"} />
        <Tile label="Total install events" value={installs.length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available packs</CardTitle>
          <CardDescription>Grouped by regulation. Install to materialize recon definitions, DQ rules, and mapping dictionaries.</CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          {packs.map((p) => {
            const install = installMap.get(p.id);
            const state = install?.status ?? "available";
            const stateBadge =
              state === "materialized" || state === "installed" ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Installed</Badge>
              ) : state === "error" || state === "failed" ? (
                <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Error</Badge>
              ) : state === "materializing" ? (
                <Badge variant="secondary">Materializing…</Badge>
              ) : (
                <Badge variant="outline"><PackageOpen className="h-3 w-3 mr-1" />Available</Badge>
              );
            return (
              <div key={p.id} className="rounded-md border p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{p.title}</span>
                      <Badge variant="outline" className="text-[10px]">{p.code}</Badge>
                      {p.jurisdiction && <Badge variant="outline" className="text-[10px]">{p.jurisdiction}</Badge>}
                    </div>
                    {p.regulation && <p className="text-xs text-muted-foreground mt-0.5">{p.regulation} · v{p.version ?? "1"}</p>}
                  </div>
                  {stateBadge}
                </div>
                {p.summary && <p className="text-xs text-muted-foreground line-clamp-2">{p.summary}</p>}
                {p.tags && p.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap pt-1">
                    {p.tags.slice(0, 5).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                  </div>
                )}
                {install?.materialization_error && (
                  <p className="text-xs text-rose-500 mt-1">{install.materialization_error}</p>
                )}
                {install?.installed_at && (
                  <p className="text-[11px] text-muted-foreground pt-1">Installed {new Date(install.installed_at).toLocaleDateString()}{install.installed_version && ` · v${install.installed_version}`}</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: "positive" | "warning" | "danger" | "default" }) {
  const toneClass = tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : tone === "warning" ? "text-amber-600 dark:text-amber-400" : tone === "danger" ? "text-rose-600 dark:text-rose-400" : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}
