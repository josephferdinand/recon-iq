import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  UploadCloud, Plug, Eye, ArrowRight, ShieldCheck, Workflow, Zap, FileScan,
  Database, Cloud, HardDrive, Globe, Server, Layers,
} from "lucide-react";
import { listDataSources } from "@/lib/data-sources.functions";
import { listSchedules } from "@/lib/connectors.functions";
import { listWatchers } from "@/lib/watchers.functions";
import { NativeParserPanel } from "@/components/native-parser-panel";

const CONNECTOR_CATALOG = [
  { key: "sftp", label: "SFTP", icon: Server, group: "File transfer" },
  { key: "ftp", label: "FTP", icon: Server, group: "File transfer" },
  { key: "local", label: "Local folder", icon: HardDrive, group: "File transfer" },
  { key: "network_drive", label: "Network drive", icon: HardDrive, group: "File transfer" },
  { key: "s3", label: "Amazon S3", icon: Cloud, group: "Object storage" },
  { key: "azure_blob", label: "Azure Blob", icon: Cloud, group: "Object storage" },
  { key: "gcs", label: "Google Cloud Storage", icon: Cloud, group: "Object storage" },
  { key: "bigquery", label: "BigQuery", icon: Database, group: "Warehouse" },
  { key: "snowflake", label: "Snowflake", icon: Database, group: "Warehouse" },
  { key: "databricks", label: "Databricks", icon: Database, group: "Warehouse" },
  { key: "https", label: "HTTPS pull", icon: Globe, group: "API" },
  { key: "rest", label: "REST API", icon: Globe, group: "API" },
] as const;

export function IngestionHub({ tenantId, slug }: { tenantId: string; slug: string }) {
  const ds = useServerFn(listDataSources);
  const sc = useServerFn(listSchedules);
  const wt = useServerFn(listWatchers);

  const sources = useQuery({ queryKey: ["data-sources", tenantId], queryFn: () => ds({ data: { tenant_id: tenantId } }) });
  const schedules = useQuery({ queryKey: ["schedules", tenantId], queryFn: () => sc({ data: { tenant_id: tenantId } }) });
  const watchers = useQuery({ queryKey: ["watchers", tenantId], queryFn: () => wt({ data: { tenant_id: tenantId } }) });

  const sourceCount = sources.data?.length ?? 0;
  const scheduleCount = schedules.data?.length ?? 0;
  const enabledSchedules = (schedules.data ?? []).filter((s: any) => s.enabled).length;
  const watcherCount = watchers.data?.length ?? 0;

  const groups = Array.from(new Set(CONNECTOR_CATALOG.map((c) => c.group)));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-gradient-to-br from-primary/5 via-background to-background p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5"><Layers className="h-5 w-5 text-primary" /></div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Data Ingestion</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              One place to land data into ReconIQ — drop a file, schedule a pull from any enterprise system,
              or watch a folder for arrivals. Everything is hash-stamped, lineage-tracked, and ready to
              feed Data Prep and the recon engine.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HubCard
          to={`/${slug}/workspace`} page="data" icon={UploadCloud}
          title="File uploads"
          description="CSV, Excel, JSON, fixed-width. Auto schema detection with SHA-256 audit stamps."
          stat={sources.isError ? "Unavailable" : `${sourceCount} source${sourceCount === 1 ? "" : "s"}`}
        />
        <HubCard
          to={`/${slug}/workspace`} page="connectors" icon={Plug}
          title="Connections"
          description="Scheduled pulls from SFTP, S3, Azure, GCS, BigQuery, Snowflake, Databricks & REST."
          stat={schedules.isError ? "Unavailable" : `${enabledSchedules}/${scheduleCount} active`}
          accent="text-emerald-600"
        />
        <HubCard
          to={`/${slug}/workspace`} page="watchers" icon={Eye}
          title="File watchers"
          description="Watch SFTP/S3/local/network paths and trigger ingestion the moment files land."
          stat={watchers.isError ? "Unavailable" : `${watcherCount} watcher${watcherCount === 1 ? "" : "s"}`}
        />
      </div>

      {sources.isError || schedules.isError || watchers.isError ? (
        <div role="alert" aria-live="assertive" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">Ingestion summary could not be fully loaded. Unavailable counts are not zero.</p>
          {sources.isError ? <div className="flex flex-wrap items-center gap-2"><span>Data source count is unavailable.</span><Button type="button" size="sm" variant="outline" onClick={() => void sources.refetch()}>Refresh data sources</Button></div> : null}
          {schedules.isError ? <div className="flex flex-wrap items-center gap-2"><span>Connection schedule count is unavailable.</span><Button type="button" size="sm" variant="outline" onClick={() => void schedules.refetch()}>Refresh schedules</Button></div> : null}
          {watchers.isError ? <div className="flex flex-wrap items-center gap-2"><span>File watcher count is unavailable.</span><Button type="button" size="sm" variant="outline" onClick={() => void watchers.refetch()}>Refresh file watchers</Button></div> : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Plug className="h-4 w-4" /> Connector library</CardTitle>
          <CardDescription>
            12 enterprise connectors out of the box. Credentials are stored in tenant Secrets;
            all data flows are RLS-scoped and recorded in the hash-chained audit log.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {CONNECTOR_CATALOG.filter((c) => c.group === g).map((c) => (
                  <Link
                    key={c.key}
                    to="/$slug/workspace"
                    params={{ slug }}
                    search={{ page: "connectors" }}
                    className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition hover:border-primary/40 hover:bg-accent/40"
                  >
                    <div className="rounded-md bg-muted p-2 transition group-hover:bg-primary/10">
                      <c.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{c.label}</div>
                      <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">{c.key}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <NativeParserPanel tenantId={tenantId} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">

        <NextStepCard icon={Workflow} title="Shape with Data Prep"
          description="Filter, cast, derive and validate before recon." page="prep" slug={slug} />
        <NextStepCard icon={FileScan} title="Extract with AIDP"
          description="Review PDFs and process text documents; image OCR is unavailable." page="aidp" slug={slug} />
        <NextStepCard icon={Zap} title="Run a rekon"
          description="Match feeds 1:1, 1:N, N:M with confidence." page="recons" slug={slug} />
      </div>

      <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
        <div>
          All ingestion paths inherit tenant RLS, PII redaction (when enabled), data-residency pinning, and
          per-tenant retention. Watchers and schedules execute under service-role context, never in the browser.
        </div>
      </div>
    </div>
  );
}

function HubCard({ to, page, icon: Icon, title, description, stat, accent }: {
  to: string; page: string; icon: any; title: string; description: string; stat: string; accent?: string;
}) {
  const slug = to.split("/")[1];
  return (
    <Link
      to="/$slug/workspace"
      params={{ slug }}
      search={{ page }}
      className="group block rounded-xl border bg-card p-5 transition hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <div className="rounded-lg bg-primary/10 p-2"><Icon className="h-4 w-4 text-primary" /></div>
        <Badge variant="outline" className={accent}>{stat}</Badge>
      </div>
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-3 inline-flex items-center text-xs font-medium text-primary opacity-0 transition group-hover:opacity-100">
        Open <ArrowRight className="ml-1 h-3 w-3" />
      </div>
    </Link>
  );
}

export function NextStepCard({ icon: Icon, title, description, page, slug }: {
  icon: any; title: string; description: string; page: string; slug: string;
}) {
  return (
    <Link
      to="/$slug/workspace"
      params={{ slug }}
      search={{ page }}
      aria-label={`Open ${title}`}
      className="group block cursor-pointer rounded-xl border bg-card shadow-sm transition-colors hover:border-primary/60 hover:bg-primary/5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-primary/10"
    >
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-md bg-muted p-2 transition-colors group-hover:bg-primary/10"><Icon className="h-4 w-4" /></div>
        <div className="flex-1">
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <ArrowRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
      </CardContent>
    </Link>
  );
}
