/**
 * D2 — Regulatory packs management page.
 *
 * Routes:
 *   /:slug/regulatory  → grid of available packs + installed packs list.
 *
 * On install: polls getInstallStatus every 2s for up to 60s, then surfaces
 * the setup checklist inline (links into the generated recon).
 */
import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  installRegulatoryPack,
  getInstallStatus,
  listInstalledPacks,
  listAvailablePacks,
} from "@/lib/regulatory-install.functions";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  ExternalLink,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/$slug/regulatory")({
  component: RegulatoryPage,
});

function RegulatoryPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/regulatory" });
  const qc = useQueryClient();
  const navigate = useNavigate();

  const lookupTenant = useServerFn(getTenantBySlug);
  const installs = useServerFn(listInstalledPacks);
  const available = useServerFn(listAvailablePacks);
  const install = useServerFn(installRegulatoryPack);
  const status = useServerFn(getInstallStatus);

  const tenantQ = useQuery({
    queryKey: ["tenant-by-slug", slug],
    queryFn: () => lookupTenant({ data: { slug } }),
  });
  const tenantId: string = (tenantQ.data as any)?.id ?? "";

  const availQ = useQuery({ queryKey: ["reg-available"], queryFn: () => available() });
  const instQ = useQuery({
    queryKey: ["reg-installs", tenantId],
    queryFn: () => installs({ data: { tenant_id: tenantId } }),
    enabled: !!tenantId,
    refetchInterval: 4000,
  });

  const [pollingId, setPollingId] = useState<string | null>(null);

  const installM = useMutation({
    mutationFn: (packCode: string) =>
      install({ data: { tenant_id: tenantId, pack_code: packCode } }),
    onSuccess: (r) => {
      toast.success(r.reused ? "Existing install reused" : "Install queued");
      setPollingId(r.installId);
      qc.invalidateQueries({ queryKey: ["reg-installs", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Install failed"),
  });

  // Poll a single install
  useEffect(() => {
    if (!pollingId || !tenantId) return;
    let attempts = 0;
    const t = setInterval(async () => {
      attempts++;
      const r = await status({ data: { tenant_id: tenantId, install_id: pollingId } });
      qc.invalidateQueries({ queryKey: ["reg-installs", tenantId] });
      if (r && r.status === "ready") {
        const id = pollingId;
        setPollingId(null);
        clearInterval(t);
        toast.success(
          `Pack ready — ${r.generated_process_count} artefact(s) generated.`,
        );
        navigate({
          to: "/$slug/regulatory/$installId",
          params: { slug, installId: id },
        });
        return;
      }
      if (r && r.status === "failed") {
        setPollingId(null);
        clearInterval(t);
        toast.error(`Install failed: ${r.error_message ?? "unknown error"}`);
        return;
      }
      if (attempts > 30) {
        setPollingId(null);
        clearInterval(t);
        toast.message(
          "Installation is still in progress. Refresh this page to check status.",
        );
      }
    }, 2000);
    return () => clearInterval(t);
  }, [pollingId, tenantId, status, qc, navigate, slug]);

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ScrollText className="h-5 w-5" /> Regulatory packs
        </h1>
        <p className="text-sm text-muted-foreground">
          Install a regulator-aligned pack to generate a working bundle: folder,
          data-prep pipelines, and a runnable reconciliation, pre-wired with the
          regulation's matching rules and tolerances.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">
          Available regulatory packs
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(availQ.data ?? []).map((p: any) => {
            const packCode = p.pack_code ?? p.code;
            const installedRow = (instQ.data ?? []).find(
              (i: any) => i.pack_id === p.id && i.status === "ready",
            );
            const busy =
              installM.isPending &&
              (installM.variables as string | undefined) === packCode;
            return (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm">{p.title}</CardTitle>
                      <CardDescription className="text-xs">
                        {p.regulation} · {p.jurisdiction} · v{p.version}
                      </CardDescription>
                    </div>
                    {installedRow ? (
                      <Badge className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Installed
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="line-clamp-3 text-xs text-muted-foreground">{p.summary}</p>
                  {Array.isArray(p.required_data_inputs) && p.required_data_inputs.length ? (
                    <div className="text-xs">
                      <div className="font-medium mb-1">Required inputs</div>
                      <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                        {p.required_data_inputs.map((i: any) => (
                          <li key={i.id}>
                            {i.name} <span className="text-foreground/80">({i.format})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={!tenantId || busy}
                      onClick={() => installM.mutate(packCode)}
                    >
                      {busy ? (
                        <>
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Installing…
                        </>
                      ) : installedRow ? (
                        <>
                          <Download className="mr-1 h-3.5 w-3.5" /> Re-install
                        </>
                      ) : (
                        <>
                          <Download className="mr-1 h-3.5 w-3.5" /> Install
                        </>
                      )}
                    </Button>
                    {p.install_runbook_url ? (
                      <Button asChild size="sm" variant="ghost">
                        <a
                          href={p.install_runbook_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={`Open ${p.title} install runbook`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">
          Installed packs
        </h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Pack</th>
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Processes</th>
                  <th className="px-4 py-2">Installed</th>
                  <th className="px-4 py-2 text-right">Setup</th>
                </tr>
              </thead>
              <tbody>
                {(instQ.data ?? []).map((i: any) => (
                  <tr key={i.id} className="border-b">
                    <td className="px-4 py-2">
                      {i.pack?.title ?? i.pack_code ?? i.pack_id}
                    </td>
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
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> {i.status}
                        </Badge>
                      )}
                      {i.error_message ? (
                        <div className="mt-1 text-destructive line-clamp-2">
                          {i.error_message}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-xs">{i.generated_process_count}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(i.installed_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {i.status === "ready" ? (
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to="/$slug/regulatory/$installId"
                            params={{ slug, installId: i.id }}
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Setup checklist
                          </Link>
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {instQ.data && instQ.data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-muted-foreground text-sm"
                    >
                      No packs installed yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
