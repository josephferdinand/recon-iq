import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useParams } from "@tanstack/react-router";
import {
  listRegulatoryPacks,
  listTenantPackInstalls,
  installRegulatoryPack,
  rematerializeRegulatoryInstall,
} from "@/lib/regulatory.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ScrollText,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

type InstallRow = {
  id: string;
  pack_id: string;
  recon_id: string | null;
  installed_version: string | null;
  installed_at: string;
  status: "pending" | "materializing" | "ready" | "failed";
  materialization_error: string | null;
  materialized_at: string | null;
  materialized_artifacts: {
    reference_table_id?: string | null;
    pipeline_ids?: string[];
    recon_id?: string;
    field_count?: number;
    pipeline_count?: number;
  } | null;
  pack?: { code: string; title: string; regulation: string } | null;
};

export function RegulatoryTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = params?.slug;
  const fetchPacks = useServerFn(listRegulatoryPacks);
  const fetchInstalls = useServerFn(listTenantPackInstalls);
  const install = useServerFn(installRegulatoryPack);
  const remat = useServerFn(rematerializeRegulatoryInstall);

  const packsQ = useQuery({ queryKey: ["reg-packs"], queryFn: () => fetchPacks() });
  const instQ = useQuery({
    queryKey: ["reg-installs", tenantId],
    queryFn: () => fetchInstalls({ data: { tenant_id: tenantId } }),
  });

  const installM = useMutation({
    mutationFn: (pack_id: string) => install({ data: { tenant_id: tenantId, pack_id } }),
    onSuccess: (r) => {
      toast.success(
        `Pack installed and materialized — recon, ${r.pipeline_ids.length} pipeline(s), field dictionary ready.`,
      );
      qc.invalidateQueries({ queryKey: ["reg-installs", tenantId] });
      qc.invalidateQueries({ queryKey: ["recons", tenantId] });
      qc.invalidateQueries({ queryKey: ["reference-data-tables", tenantId] });
      qc.invalidateQueries({ queryKey: ["data-prep-pipelines", tenantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Install failed"),
  });

  const rematM = useMutation({
    mutationFn: (install_id: string) =>
      remat({ data: { install_id, tenant_id: tenantId } }),
    onSuccess: () => {
      toast.success("Re-materialized");
      qc.invalidateQueries({ queryKey: ["reg-installs", tenantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Re-materialize failed"),
  });

  const installsList = (instQ.data ?? []) as InstallRow[];
  const installedIds = new Set(installsList.map((i) => i.pack_id));
  const isInstallingFor = (packId: string) =>
    installM.isPending && (installM.variables as string | undefined) === packId;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" /> Regulatory template packs
          </CardTitle>
          <CardDescription>
            Install a pack to auto-generate a working bundle: reference field dictionary, data-prep pipelines, and a runnable rekon definition — pre-wired with the regulation's matching rules and tolerances.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(packsQ.data ?? []).map((p: any) => {
            const installed = installedIds.has(p.id);
            const busy = isInstallingFor(p.id);
            return (
              <Card key={p.id} className="border-muted">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm">{p.title}</CardTitle>
                      <CardDescription className="text-xs">
                        {p.regulation} · {p.jurisdiction} · v{p.version}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {p.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="line-clamp-3 text-xs text-muted-foreground">{p.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {(p.tags ?? []).map((t: string) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!canWrite || busy || installed}
                    onClick={() => installM.mutate(p.id)}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Generating bundle…
                      </>
                    ) : installed ? (
                      <>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Installed
                      </>
                    ) : (
                      <>
                        <Download className="mr-1 h-3.5 w-3.5" /> Install & generate
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
          {packsQ.data && packsQ.data.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">No packs published.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Installed in this tenant</CardTitle>
          <CardDescription>
            Each install materializes a reference table, data-prep pipelines, and a rekon definition. Use Re-materialize to recreate any missing artefact.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Pack</th>
                <th className="px-4 py-2">Regulation</th>
                <th className="px-4 py-2">Version</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Bundle</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {installsList.map((i) => {
                const a = i.materialized_artifacts ?? {};
                return (
                  <tr key={i.id} className="border-b align-top">
                    <td className="px-4 py-2">{i.pack?.title ?? i.pack_id}</td>
                    <td className="px-4 py-2 text-xs">{i.pack?.regulation ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{i.installed_version}</td>
                    <td className="px-4 py-2 text-xs">
                      {i.status === "ready" ? (
                        <Badge className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </Badge>
                      ) : i.status === "failed" ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" /> Failed
                        </Badge>
                      ) : i.status === "materializing" ? (
                        <Badge variant="outline" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Generating
                        </Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                      {i.materialization_error ? (
                        <div className="mt-1 text-destructive line-clamp-2">
                          {i.materialization_error}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {i.status === "ready" ? (
                        <span>
                          {a.field_count ?? 0} fields ·{" "}
                          {(a.pipeline_ids ?? []).length} pipeline(s) · 1 rekon
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {i.recon_id && slug ? (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              to="/$slug/workspace"
                              params={{ slug }}
                              search={{ tab: "recons", reconId: i.recon_id } as any}
                            >
                              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open recon
                            </Link>
                          </Button>
                        ) : null}
                        {canWrite ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={rematM.isPending}
                            onClick={() => rematM.mutate(i.id)}
                            title="Re-create any missing artefacts (idempotent)"
                          >
                            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-materialize
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {instQ.data && instQ.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Nothing installed yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
