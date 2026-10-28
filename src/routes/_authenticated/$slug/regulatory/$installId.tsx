/**
 * D2 — Regulatory pack setup checklist.
 *
 * After a pack install reaches `ready`, the user is redirected here. The
 * page lists every generated data-prep pipeline (with a "Configure data
 * source" deep-link) and the root reconciliation (with an "Open recon"
 * deep-link), so the operator can finish wiring data sources without
 * hunting through navigation.
 */
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getInstallStatus } from "@/lib/regulatory-install.functions";
import { getTenantBySlug } from "@/lib/tenants.functions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronRight,
  ScrollText,
  Database,
  Workflow,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/$slug/regulatory/$installId")({
  component: SetupChecklistPage,
});

function SetupChecklistPage() {
  const { slug, installId } = useParams({
    from: "/_authenticated/$slug/regulatory/$installId",
  });

  const lookupTenant = useServerFn(getTenantBySlug);
  const status = useServerFn(getInstallStatus);

  const tenantQ = useQuery({
    queryKey: ["tenant-by-slug", slug],
    queryFn: () => lookupTenant({ data: { slug } }),
  });
  const tenantId: string = (tenantQ.data as any)?.id ?? "";

  const instQ = useQuery({
    queryKey: ["reg-install", tenantId, installId],
    queryFn: () => status({ data: { tenant_id: tenantId, install_id: installId } }),
    enabled: !!tenantId,
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.status;
      return s === "ready" || s === "failed" ? false : 3000;
    },
  });

  const row: any = instQ.data;
  const artefacts = row?.materialized_artifacts ?? {};
  const pipelineIds: string[] = Array.isArray(artefacts.pipeline_ids)
    ? artefacts.pipeline_ids
    : [];
  const reconId: string | null =
    artefacts.recon_id ?? row?.tenant_root_process_id ?? null;
  const folder: string = artefacts.folder ?? row?.pack?.title ?? "Regulatory pack";

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/$slug/regulatory" params={{ slug }} className="hover:underline">
            Regulatory packs
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Setup checklist</span>
        </div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ScrollText className="h-5 w-5" /> {folder} — Setup checklist
        </h1>
        <p className="text-sm text-muted-foreground">
          Finish wiring data sources to each generated pipeline, then open the
          recon to run your first match.
        </p>
        <div className="pt-2">
          {row?.status === "ready" ? (
            <Badge className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Ready
            </Badge>
          ) : row?.status === "failed" ? (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" /> Failed: {row?.error_message}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> {row?.status ?? "loading"}
            </Badge>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Workflow className="h-4 w-4" /> Data-prep pipelines
          </CardTitle>
          <CardDescription>
            One pipeline per data input. Open each one to point it at your data
            source and validate the schema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {pipelineIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pipelines generated yet.</p>
          ) : (
            pipelineIds.map((pid, idx) => (
              <div
                key={pid}
                className="flex items-center justify-between rounded border px-3 py-2"
              >
                <div className="flex items-center gap-2 text-sm">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Pipeline #{idx + 1}</span>
                  <span className="font-mono text-xs text-muted-foreground">{pid}</span>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link
                    to="/$slug/workspace"
                    params={{ slug }}
                    search={{ tab: "data-prep", pipelineId: pid } as any}
                  >
                    Configure data source
                  </Link>
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Root reconciliation
          </CardTitle>
          <CardDescription>
            The pack's matching rules and tolerances are already wired. Open
            the recon to review and run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reconId ? (
            <Button asChild>
              <Link
                to="/$slug/workspace"
                params={{ slug }}
                search={{ tab: "recons", reconId } as any}
              >
                Open recon
              </Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">No recon generated yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
