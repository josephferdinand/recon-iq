import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listSchedulesPage,
  getScheduleForEdit,
  upsertSchedule,
  deleteSchedule,
  runScheduleNow,
  listScheduleRuns,
  connectorExecutionMode,
  CONNECTOR_TYPES,
  type ScheduleListInput,
} from "@/lib/connectors.functions";
import { listDataSourceOptions } from "@/lib/data-sources.functions";
import { getResourceAccessSummaries } from "@/lib/resource-access-summaries.functions";
import { getResourceActorSummaries } from "@/lib/resource-actor-summaries.functions";
import { ResourceIdentitySummary } from "@/components/resource-identity-summary";
import { ResourceActorSummary as ResourceActorSummaryView } from "@/components/resource-actor-summary";
import { FviDetailDialogLayout } from "@/components/fvi-detail-dialog-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Play, Clock, History, Zap, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";

const OPS = ["filter", "rename", "cast", "derive", "drop", "trim", "upper", "lower"] as const;

function defaultConfigFor(type: string): any {
  switch (type) {
    case "https":
    case "rest":
    case "http":
      return { url: "", method: "GET", headers: {} };
    case "sftp":
      return { agent_id: "", host: "", port: 22, remote_path: "/", file_pattern: "*.csv", credential_ref: "", host_key_sha256: "", format: "csv" };
    case "ftp":
      return { agent_id: "", host: "", port: 21, remote_path: "/", file_pattern: "*.csv", credential_ref: "", secure: true, format: "csv" };
    case "s3":
      return { bucket: "", prefix: "", region: "us-east-1", file_pattern: "*.csv", secret_key: "" };
    case "azure_blob":
      return { account: "", container: "", prefix: "", file_pattern: "*.csv", secret_key: "" };
    case "gcs":
      return { bucket: "", prefix: "", file_pattern: "*.csv", secret_key: "" };
    case "bigquery":
      return {
        project: "",
        dataset: "",
        query: "SELECT * FROM `project.dataset.table` LIMIT 10000",
        secret_key: "",
      };
    case "snowflake":
      return {
        account: "",
        warehouse: "",
        database: "",
        schema: "",
        query: "SELECT * FROM table LIMIT 10000",
        secret_key: "",
      };
    case "databricks":
      return {
        workspace_url: "",
        http_path: "",
        catalog: "",
        schema: "",
        query: "SELECT * FROM table LIMIT 10000",
        secret_key: "",
      };
    case "local":
      return { agent_id: "", root_alias: "local-inbox", relative_path: ".", file_pattern: "*.csv", format: "csv" };
    case "network_drive":
      return { agent_id: "", root_alias: "finance-share", relative_path: ".", file_pattern: "*.csv", format: "csv" };
    default:
      return {};
  }
}

function ConnectorConfig({ editing, setEditing }: { editing: any; setEditing: (v: any) => void }) {
  const t = editing.connector_type;
  const cfg = editing.config ?? {};
  const sensitiveUrlHidden = !!editing.sensitive_url_present;
  const set = (patch: Record<string, unknown>) =>
    setEditing({ ...editing, config: { ...cfg, ...patch } });

  if (t === "manual") {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Manual schedules do not pull automatically — users upload files directly to the data source.
      </div>
    );
  }

  if (t === "http" || t === "https" || t === "rest") {
    return (
      <div className="space-y-2 rounded-md border p-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          HTTPS / REST config
        </div>
        <div className="grid grid-cols-[100px_1fr] gap-2">
          <Select value={cfg.method ?? "GET"} onValueChange={(v) => set({ method: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["GET", "POST"].map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={cfg.url ?? ""}
            disabled={sensitiveUrlHidden}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://feeds.demo-bank.example/nostro/eod.json"
          />
        </div>
        {sensitiveUrlHidden && <p className="text-xs text-muted-foreground">The saved connection URL contains hidden credential material and cannot be changed here.</p>}
        <Label className="text-xs">Headers (JSON)</Label>
        <Textarea
          value={JSON.stringify(cfg.headers ?? {}, null, 2)}
          disabled={!!editing.id && !!editing.sensitive_headers_present}
          onChange={(e) => {
            try {
              set({ headers: JSON.parse(e.target.value) });
            } catch {
              /* ignore */
            }
          }}
          placeholder='{"Authorization": "Bearer ..."}'
          rows={3}
          className="font-mono text-xs"
        />
        {editing.id && editing.sensitive_headers_present && <p className="text-xs text-muted-foreground">Sensitive header values are hidden and retained unchanged; use the approved credential-management workflow to change them.</p>}
        {t === "rest" && (
          <>
            <Label className="text-xs">Pagination (optional)</Label>
            <Input
              value={cfg.pagination ?? ""}
              onChange={(e) => set({ pagination: e.target.value })}
              placeholder="e.g. ?page={page}&size=500&falcon_account=USD"
              className="font-mono text-xs"
            />
          </>
        )}
      </div>
    );
  }

  const FIELDS: Record<string, Array<[string, string, string?]>> = {
    sftp: [
      ["agent_id", "Agent ID", "site-a-agent-01"],
      ["host", "SFTP host", "sftp.example.com"],
      ["port", "Port", "22"],
      ["remote_path", "Remote path", "/outbound"],
      ["file_pattern", "File pattern", "*.csv"],
      ["host_key_sha256", "Host key SHA-256", "SHA256:..."],
    ],
    ftp: [
      ["agent_id", "Agent ID", "site-a-agent-01"],
      ["host", "FTPS host", "ftps.example.com"],
      ["port", "Port", "21"],
      ["remote_path", "Remote path", "/outbound"],
      ["file_pattern", "File pattern", "*.csv"],
    ],
    s3: [
      ["bucket", "Bucket", "fvi-prod-feeds"],
      ["prefix", "Key prefix", "incoming/"],
      ["region", "Region", "us-east-1"],
      ["file_pattern", "File pattern", "*.csv"],
    ],
    azure_blob: [
      ["account", "Storage account", "fvistorage"],
      ["container", "Container", "feeds"],
      ["prefix", "Prefix", "incoming/"],
      ["file_pattern", "File pattern", "*.csv"],
    ],
    gcs: [
      ["bucket", "Bucket", "fvi-prod-feeds"],
      ["prefix", "Prefix", "incoming/"],
      ["file_pattern", "File pattern", "*.csv"],
    ],
    bigquery: [
      ["project", "GCP project", "my-project"],
      ["dataset", "Dataset", "analytics"],
    ],
    snowflake: [
      ["account", "Account", "xy12345.us-east-1"],
      ["warehouse", "Warehouse", "COMPUTE_WH"],
      ["database", "Database", "ReconIQ"],
      ["schema", "Schema", "RAW"],
    ],
    databricks: [
      ["workspace_url", "Workspace URL", "https://adb-xxx.azuredatabricks.net"],
      ["http_path", "HTTP path", "/sql/1.0/warehouses/abc"],
      ["catalog", "Catalog", "main"],
      ["schema", "Schema", "fvi"],
    ],
    local: [
      ["agent_id", "Agent ID", "site-a-agent-01"],
      ["root_alias", "Approved root alias", "local-inbox"],
      ["relative_path", "Relative folder", "."],
      ["file_pattern", "File pattern", "*.csv"],
    ],
    network_drive: [
      ["agent_id", "Agent ID", "site-a-agent-01"],
      ["root_alias", "Approved root alias", "finance-share"],
      ["relative_path", "Relative folder", "."],
      ["file_pattern", "File pattern", "*.csv"],
    ],
  };

  const fields = FIELDS[t] ?? [];
  const isQueryType = t === "bigquery" || t === "snowflake" || t === "databricks";
  const needsRemoteCredential = t === "sftp" || t === "ftp";

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          {t.replace("_", " ")} config
        </div>
        <Badge variant="outline" className="text-[10px]">
          Credentials via tenant Secrets
        </Badge>
      </div>
      {sensitiveUrlHidden && <p className="text-xs text-muted-foreground">The saved connection URL contains hidden credential material and cannot be changed here.</p>}
      <div className="grid grid-cols-2 gap-2">
        {fields.map(([key, label, ph]) => (
          <div key={key} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input
              value={cfg[key] ?? ""}
              disabled={sensitiveUrlHidden && key.endsWith("url")}
              onChange={(e) => set({ [key]: e.target.value })}
              placeholder={ph}
              className="font-mono text-xs"
            />
          </div>
        ))}
      </div>
      {isQueryType && (
        <div className="space-y-1">
          <Label className="text-xs">Query</Label>
          <Textarea
            value={cfg.query ?? ""}
            onChange={(e) => set({ query: e.target.value })}
            rows={4}
            className="font-mono text-xs"
          />
        </div>
      )}
      {needsRemoteCredential && (
        <div className="space-y-1">
          <Label className="text-xs">Secret reference</Label>
          <Input
            value={cfg.credential_ref ?? ""}
            onChange={(e) => set({ credential_ref: e.target.value })}
            placeholder="e.g. bank-sftp"
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            This name resolves only inside the installed on-premises agent's service secret manager.
          </p>
        </div>
      )}
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-900 dark:text-amber-200">
        Remote gateways execute privately. On-premises sources use an outbound-poll agent with
        tenant-scoped API access, approved root aliases and no inbound port.
      </div>
    </div>
  );
}

function formatScheduleAttempt(schedule: { last_run_at?: string | null; last_status?: string | null }) {
  if (!schedule.last_run_at) return "No attempt timestamp is recorded.";
  const timestamp = new Date(schedule.last_run_at);
  if (!Number.isFinite(timestamp.getTime())) return "Attempt timestamp is unavailable.";
  return `${timestamp.toLocaleString()} · ${schedule.last_status ?? "status unavailable"}`;
}

function scheduleErrorMessage(schedule: { has_error?: boolean; last_run_at?: string | null }) {
  if (!schedule.has_error) return null;
  return schedule.last_run_at
    ? "A stored connection error is present. Review History for attempt context."
    : "A stored connection error is present; its attempt time is unavailable.";
}

export function ConnectorsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listSchedulesPage);
  const readForEdit = useServerFn(getScheduleForEdit);
  const upsert = useServerFn(upsertSchedule);
  const del = useServerFn(deleteSchedule);
  const run = useServerFn(runScheduleNow);
  const listSrc = useServerFn(listDataSourceOptions);
  const listRuns = useServerFn(listScheduleRuns);
  const getAccessSummaries = useServerFn(getResourceAccessSummaries);
  const getActorSummaries = useServerFn(getResourceActorSummaries);
  const invalidateActorSummaries = () => qc.invalidateQueries({ queryKey: ["resource-actor-summary", tenantId, "data_source_schedule"] });
  const { confirm, ConfirmDialog } = useConfirm();

  const [open, setOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState(false);
  const editRequestVersion = useRef(0);
  const [sourceSearch, setSourceSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [detailsPinned, setDetailsPinned] = useState(false);
  const [detailsPreview, setDetailsPreview] = useState(false);
  const detailsVisible = detailsPinned || detailsPreview;
  const detailsPreviewCloseTimer = useRef<number | null>(null);
  const detailsToolbarRef = useRef<HTMLButtonElement | null>(null);
  const [detailsPanelTop, setDetailsPanelTop] = useState<number | null>(null);
  const showDetailsPreview = () => {
    clearDetailsPreviewClose();
    const bounds = detailsToolbarRef.current?.getBoundingClientRect();
    if (bounds && window.matchMedia("(min-width: 768px)").matches) {
      setDetailsPanelTop(Math.max(16, Math.min(bounds.bottom + 8, window.innerHeight - 280)));
    } else {
      setDetailsPanelTop(null);
    }
    setDetailsPreview(true);
  };
  const clearDetailsPreviewClose = () => {
    if (detailsPreviewCloseTimer.current !== null) window.clearTimeout(detailsPreviewCloseTimer.current);
    detailsPreviewCloseTimer.current = null;
  };
  const scheduleDetailsPreviewClose = () => {
    clearDetailsPreviewClose();
    if (!detailsPinned) detailsPreviewCloseTimer.current = window.setTimeout(() => setDetailsPreview(false), 180);
  };
  useEffect(() => {
    return () => clearDetailsPreviewClose();
  }, []);
  useEffect(() => {
    if (!detailsVisible) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDetailsPinned(false); setDetailsPreview(false); }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [detailsVisible]);
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewTransitionRef = useRef(false);
  const returnToViewAfterRunsRef = useRef(false);
  const returnToViewAfterEditRef = useRef(false);
  const [filters, setFilters] = useState<Omit<ScheduleListInput, "tenant_id">>({
    search: "",
    connector_type: "all",
    state: "all",
    agent_required: "all",
    sort: "name_asc",
    page: 1,
    page_size: 25,
  });
  const updateFilters = (next: Partial<typeof filters>) => setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }));

  const q = useQuery({
    queryKey: ["schedules", tenantId, filters],
    queryFn: () => list({ data: { tenant_id: tenantId, ...filters } }),
  });
  const sources = useQuery({
    queryKey: ["data-source-options", tenantId, sourceSearch, editing?.data_source_id],
    queryFn: () => listSrc({ data: {
      tenant_id: tenantId,
      search: sourceSearch,
      selected_ids: editing?.data_source_id ? [editing.data_source_id] : [],
    } }),
  });
  const runs = useQuery({
    queryKey: ["schedule-runs", runsOpen],
    queryFn: () => listRuns({ data: { schedule_id: runsOpen! } }),
    enabled: !!runsOpen,
  });
  const pageRows = q.data?.rows ?? [];
  const accessQ = useQuery({
    queryKey: ["resource-access-summary", tenantId, "data_source_schedule", pageRows.map((row: any) => row.id)],
    queryFn: () => getAccessSummaries({ data: { resource_type: "data_source_schedule", resource_ids: pageRows.map((row: any) => row.id) } }),
    enabled: pageRows.length > 0,
  });
  const accessById = new Map((accessQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const actorQ = useQuery({
    queryKey: ["resource-actor-summary", tenantId, "data_source_schedule", pageRows.map((row: any) => row.id)],
    queryFn: () => getActorSummaries({ data: { resource_type: "data_source_schedule", resource_ids: pageRows.map((row: any) => row.id) } }),
    enabled: pageRows.length > 0 && pageRows.length <= 100,
  });
  const actorsById = new Map((actorQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const selected = pageRows.find((schedule) => schedule.id === selectedId) ?? pageRows[0] ?? null;
  const viewed = pageRows.find((schedule) => schedule.id === viewId) ?? null;

  const save = useMutation({
    mutationFn: (v: any) => upsert({ data: v }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["schedules", tenantId] });
      void invalidateActorSummaries();
      setOpen(false);
      setEditing(null);
    },
    onError: () => toast.error("Connection changes could not be saved. Please review the fields and try again."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["schedules", tenantId] });
      void invalidateActorSummaries();
      updateFilters({ page: 1 });
    },
  });
  const trigger = useMutation({
    mutationFn: (id: string) => run({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r) => toast.success(r.queued ? "Queued for the on-premises agent" : `Ingested ${r.rows} rows`),
    onError: () => toast.error("The connection run could not be started. Please try again or contact your administrator."),
    onSettled: () => {
      void invalidateActorSummaries();
      return qc.invalidateQueries({ queryKey: ["schedules", tenantId] });
    },
  });

  const startEdit = async (schedule: any) => {
    const requestVersion = ++editRequestVersion.current;
    setEditTarget(schedule);
    setEditing(null);
    setEditError(false);
    setEditLoading(true);
    setOpen(true);
    try {
      const details = await readForEdit({ data: { id: schedule.id, tenant_id: tenantId } });
      if (requestVersion === editRequestVersion.current) setEditing(details);
    } catch {
      if (requestVersion === editRequestVersion.current) setEditError(true);
    } finally {
      if (requestVersion === editRequestVersion.current) setEditLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Scheduled Connectors
          </CardTitle>
          <CardDescription>
            HTTP, HTTPS, and REST run directly. S3, Azure Blob, GCS, BigQuery, Snowflake, and
            Databricks run through the private remote gateway. SFTP, FTP, local, and network-drive
            sources require an approved on-premises agent.
          </CardDescription>
        </div>
        <Button
          size="sm"
          disabled={!canWrite}
          onClick={() => {
            editRequestVersion.current += 1;
            setEditTarget(null);
            setEditLoading(false);
            setEditError(false);
            setEditing({
              connector_type: "http",
              cron_expression: "0 * * * *",
              enabled: false,
              transformation: [],
              config: { url: "", method: "GET", headers: {} },
            });
            setOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> New schedule
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_repeat(4,minmax(8rem,auto))]">
          <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search connections" placeholder="Search connections…" className="pl-9" value={filters.search} onChange={(e) => updateFilters({ search: e.target.value })} /></div>
          <Select value={filters.connector_type} onValueChange={(v) => updateFilters({ connector_type: v as ScheduleListInput["connector_type"] })}><SelectTrigger aria-label="Filter by connector type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{CONNECTOR_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.state} onValueChange={(v) => updateFilters({ state: v as ScheduleListInput["state"] })}><SelectTrigger aria-label="Filter by state"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem><SelectItem value="enabled">Enabled</SelectItem><SelectItem value="paused">Paused</SelectItem></SelectContent></Select>
          <Select value={filters.agent_required} onValueChange={(v) => updateFilters({ agent_required: v as ScheduleListInput["agent_required"] })}><SelectTrigger aria-label="Filter agent requirement"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Agent: all</SelectItem><SelectItem value="yes">Agent required</SelectItem><SelectItem value="no">No agent required</SelectItem></SelectContent></Select>
          <Select value={filters.sort} onValueChange={(v) => updateFilters({ sort: v as ScheduleListInput["sort"] })}><SelectTrigger aria-label="Sort connections"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name_asc">Name (A–Z)</SelectItem><SelectItem value="name_desc">Name (Z–A)</SelectItem><SelectItem value="updated_desc">Recently updated</SelectItem><SelectItem value="attempt_desc">Latest attempt</SelectItem></SelectContent></Select>
        </div>
        <details className="rounded-md border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">Additional filters (unavailable)</summary>
          <p className="my-2 text-muted-foreground">Business unit and user group filters need authorized server-side list support. They remain unavailable so the current page is never mistaken for the full collection.</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Input disabled aria-label="Filter by business unit unavailable" placeholder="Business unit filter unavailable" />
            <Input disabled aria-label="Filter by user group unavailable" placeholder="User group filter unavailable" />
            <Input disabled aria-label="Filter by last updated by unavailable" placeholder="Editor filter unavailable" />
          </div>
        </details>
        <div className="grid gap-3 md:grid-cols-3">
          <div><Label htmlFor="connection-updated-from">Updated from (UTC)</Label><Input id="connection-updated-from" type="date" aria-label="Updated from date (UTC)" value={filters.updated_from ?? ""} onChange={(event) => updateFilters({ updated_from: event.target.value || undefined })} /><p className="mt-1 text-[11px] text-muted-foreground">Includes this full UTC calendar day.</p></div>
          <div><Label htmlFor="connection-updated-through">Updated through (UTC)</Label><Input id="connection-updated-through" type="date" aria-label="Updated through date (UTC)" value={filters.updated_through ?? ""} onChange={(event) => updateFilters({ updated_through: event.target.value || undefined })} /><p className="mt-1 text-[11px] text-muted-foreground">Includes this full UTC calendar day.</p></div>
          <div><Label htmlFor="connection-public-id">Public ID search</Label><Input id="connection-public-id" aria-label="Search by Public ID" disabled={accessQ.data?.available !== true} placeholder={accessQ.data?.available === true ? "Search generated Public ID" : "Public ID search unavailable"} value={filters.public_id_search ?? ""} onChange={(event) => updateFilters({ public_id_search: event.target.value || undefined })} /><p className="mt-1 text-[11px] text-muted-foreground" role={accessQ.data?.available === true ? undefined : "status"}>{accessQ.data?.available === true ? "Searches generated IDs across all connection schedules." : "Ask an administrator to apply the resource identity migrations, then refresh to enable Public ID search."}</p></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Selected: {selected?.name ?? "No connection selected"}</span>
          <Button ref={detailsToolbarRef} type="button" size="sm" variant="outline" aria-controls="connection-inspector" aria-expanded={detailsVisible} onMouseEnter={showDetailsPreview} onMouseLeave={scheduleDetailsPreviewClose} onFocus={showDetailsPreview} onBlur={scheduleDetailsPreviewClose} onKeyDown={(event) => { if (event.key === "Escape") { clearDetailsPreviewClose(); setDetailsPinned(false); setDetailsPreview(false); } }} onClick={() => { showDetailsPreview(); setDetailsPinned((pinned) => !pinned); setDetailsPreview(false); }}>{detailsPinned ? "Hide details" : "Show details"}</Button>
        </div>
        <div className="relative grid gap-4">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[1240px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="p-3">Public ID</th><th className="p-3">Connection</th><th className="p-3">Type</th><th className="p-3">Business units</th><th className="p-3">User groups</th><th className="p-3">Schedule (UTC)</th><th className="p-3">State</th><th className="p-3">Last attempt</th><th className="fvi-sticky-view-cell p-3 text-right">View</th></tr>
              </thead>
              <tbody>
                {pageRows.map((s: any) => {
                  const executionMode = connectorExecutionMode(s.connector_type);
                  const isSelected = selected?.id === s.id;
                  return (
                    <tr key={s.id} aria-selected={isSelected} className={`border-t ${isSelected ? "fvi-selected-row" : "hover:bg-muted/20"}`}>
                      <td className="p-3"><ResourceIdentitySummary section="identity" summary={accessById.get(s.id)} available={accessQ.data?.available === true} /></td>
                      <td className="p-3">
                        <button type="button" className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={isSelected} onClick={() => setSelectedId(s.id)}>{s.name}</button>
                        <div className="text-xs text-muted-foreground">{s.data_source?.name ?? "Source name unavailable"}</div>
                      </td>
                      <td className="p-3"><Badge variant="outline" className="uppercase">{s.connector_type}</Badge>{executionMode === "agent_required" && <div className="mt-1 text-xs text-muted-foreground">Agent required</div>}</td>
                      <td className="p-3"><ResourceIdentitySummary section="business-units" summary={accessById.get(s.id)} available={accessQ.data?.available === true} /></td><td className="p-3"><ResourceIdentitySummary section="user-groups" summary={accessById.get(s.id)} available={accessQ.data?.available === true} /></td>
                      <td className="p-3 font-mono text-xs"><Clock className="mr-1 inline h-3 w-3" />{s.cron_expression}</td>
                      <td className="p-3">{s.enabled ? <Badge className="bg-emerald-600">Enabled</Badge> : <Badge variant="secondary">Paused</Badge>}</td>
                      <td className="p-3 text-xs">{s.last_run_at ? <><div>{new Date(s.last_run_at).toLocaleString()}</div><div className={s.last_status === "success" ? "text-emerald-600" : "text-muted-foreground"}>{s.last_status ?? "Status unavailable"}{s.last_rows_ingested != null && ` · ${s.last_rows_ingested} rows`}</div><ResourceActorSummaryView mode="updated-line" summary={actorsById.get(s.id)} available={actorQ.data?.available === true} /></> : <span className="text-muted-foreground">No attempt recorded</span>}</td>
                      <td className="fvi-sticky-view-cell p-3 text-right"><Button size="sm" variant="outline" className="fvi-row-view-action" aria-label={`View ${s.name}`} onClick={(event) => { viewTriggerRef.current = event.currentTarget; setSelectedId(s.id); setViewId(s.id); }}>View</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {detailsVisible ? <aside id="connection-inspector" aria-label="Selected connection details" onMouseEnter={showDetailsPreview} onMouseLeave={scheduleDetailsPreviewClose} onFocus={showDetailsPreview} onKeyDown={(event) => { if (event.key === "Escape") { clearDetailsPreviewClose(); setDetailsPinned(false); setDetailsPreview(false); } }} style={{ top: detailsPanelTop ?? undefined }} className="fixed inset-x-2 bottom-2 top-auto z-40 max-h-[70dvh] overflow-y-auto rounded-lg border bg-background p-4 shadow-xl md:inset-y-4 md:left-auto md:right-4 md:top-auto md:w-[23rem] md:max-h-[calc(100dvh-6rem)]">
          <Button type="button" variant="ghost" size="sm" className="mb-2 md:hidden" onClick={() => { setDetailsPinned(false); setDetailsPreview(false); }}>Hide details</Button>
            {selected ? (() => {
              const executionMode = connectorExecutionMode(selected.connector_type);
              const runUnavailable = executionMode === "manual" || (executionMode === "agent_required" && !selected.agent_configured);
              return <div className="space-y-4">
                <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold">{selected.name}</h3><p className="text-sm text-muted-foreground">{selected.data_source?.name ?? "Scheduled data source"}</p></div><Badge variant="outline" className="uppercase">{selected.connector_type}</Badge></div>
                <ResourceActorSummaryView mode="detail" summary={actorsById.get(selected.id)} available={actorQ.data?.available === true} />
                <section aria-label="Schedule and execution" className="space-y-3 border-y py-3 text-sm">
                  <h4 className="font-medium">Schedule and execution</h4>
                  <div><div className="text-xs text-muted-foreground">Schedule (UTC)</div><div className="font-mono">{selected.cron_expression}</div></div>
                  <div className="grid grid-cols-2 gap-3"><div><div className="text-xs text-muted-foreground">State</div><div>{selected.enabled ? "Enabled" : "Paused"}</div></div><div><div className="text-xs text-muted-foreground">Agent required</div><div>{executionMode === "agent_required" ? "Yes" : "No"}</div></div></div>
                </section>
                <section aria-label="Last attempt" className="space-y-2 text-sm">
                  <h4 className="font-medium">Last attempt</h4>
                  <p>{formatScheduleAttempt(selected)}</p>
                  {selected.last_rows_ingested != null ? <p>{selected.last_rows_ingested} rows ingested</p> : null}
                  {scheduleErrorMessage(selected) ? <p role="status" className="text-destructive">{scheduleErrorMessage(selected)}</p> : null}
                </section>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => trigger.mutate(selected.id)} disabled={!canWrite || trigger.isPending || runUnavailable} title={!canWrite ? "A tenant writer role is required to run this connection" : runUnavailable ? (executionMode === "manual" ? "Manual upload schedules cannot run automatically" : "Set the approved on-premises Agent ID before running") : undefined}><Play className="mr-1 h-4 w-4" />Run now</Button>
                  <Button variant="outline" onClick={() => setRunsOpen(selected.id)}><History className="mr-1 h-4 w-4" />History</Button>
                  <Button variant="outline" disabled={!canWrite} onClick={() => void startEdit(selected)}>Edit</Button>
                  <Button variant="outline" disabled={!canWrite} onClick={() => confirm({ title: "Delete schedule?", description: selected.name }).then((ok) => ok && remove.mutate(selected.id))}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
                </div>
                {runUnavailable && <p className="text-xs text-muted-foreground">Run now is unavailable until this connector has a supported execution path and required agent configuration.</p>}
              </div>;
            })() : <p className="text-sm text-muted-foreground">Select a connection to view its schedule and available actions.</p>}
          </aside> : null}
          <Dialog open={Boolean(viewId)} onOpenChange={(isOpen) => { if (!isOpen) setViewId(null); }}>
            <DialogContent className="h-[min(92dvh,64rem)] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[min(96vw,88rem)] overflow-hidden gap-0 p-0" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); if (viewTransitionRef.current) { viewTransitionRef.current = false; return; } viewTriggerRef.current?.focus(); }}>
              {viewed ? (() => { const mode = connectorExecutionMode(viewed.connector_type); const unavailable = mode === "manual" || (mode === "agent_required" && !viewed.agent_configured); return <FviDetailDialogLayout
                railEyebrow="INGESTION"
                railTitle="CONNECTION"
                railStatus={<Badge variant="outline" className="border-[var(--fvi-gold)] text-[var(--fvi-gold-hi)]">{viewed.enabled ? "Enabled" : "Paused"}</Badge>}
                railFields={[
                  { label: "Type", value: viewed.connector_type.toUpperCase() },
                ]}
                title={viewed.name}
                description={viewed.data_source?.name ?? "Scheduled data source"}
                content={<div className="space-y-6">
                <section aria-label="Identity and access" className="space-y-3"><h3 className="text-base font-semibold">Identity and access</h3><ResourceIdentitySummary mode="detail" summary={accessById.get(viewed.id)} available={accessQ.data?.available === true} /><ResourceActorSummaryView mode="detail" summary={actorsById.get(viewed.id)} available={actorQ.data?.available === true} /></section>
                <section aria-label="Schedule and execution" className="space-y-3 border-y py-4"><h3 className="text-base font-semibold">Schedule and execution</h3><dl className="grid gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Schedule (UTC)</dt><dd className="font-mono">{viewed.cron_expression}</dd></div><div><dt className="text-xs text-muted-foreground">Agent required</dt><dd>{mode === "agent_required" ? "Yes" : "No"}</dd></div></dl></section>
                <section aria-label="Last attempt" className="space-y-2"><h3 className="text-base font-semibold">Last attempt</h3><p className="text-sm">{formatScheduleAttempt(viewed)}</p>{viewed.last_rows_ingested != null ? <p className="text-sm">{viewed.last_rows_ingested} rows ingested</p> : null}{scheduleErrorMessage(viewed) ? <p role="status" className="text-sm text-destructive">{scheduleErrorMessage(viewed)}</p> : null}</section>
                {unavailable ? <p className="text-xs text-muted-foreground">Run now is unavailable until this connector has a supported execution path and required agent configuration.</p> : null}
                </div>}
                actions={<><Button variant="outline" onClick={() => trigger.mutate(viewed.id)} disabled={!canWrite || trigger.isPending || unavailable}>Run now</Button><Button variant="outline" onClick={() => { viewTransitionRef.current = true; returnToViewAfterRunsRef.current = true; setViewId(null); setRunsOpen(viewed.id); }}>History</Button><Button variant="outline" disabled={!canWrite} onClick={() => { viewTransitionRef.current = true; returnToViewAfterEditRef.current = true; setViewId(null); void startEdit(viewed); }}>Edit</Button><Button variant="destructive" disabled={!canWrite || remove.isPending} onClick={() => { viewTransitionRef.current = true; setViewId(null); void confirm({ title: "Delete schedule?", description: viewed.name }).then((ok) => { if (ok) remove.mutate(viewed.id); }).finally(() => viewTriggerRef.current?.focus()); }}><Trash2 className="mr-1 h-4 w-4" />Delete</Button></>}
              />; })() : <p className="p-6 text-sm text-muted-foreground">This connection is no longer on the current page. Close this view and locate it again.</p>}
            </DialogContent>
          </Dialog>
        </div>
        {q.isError && <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">Connections could not be loaded. Refresh the page or try again.</div>}
        {!q.isLoading && !q.isError && (q.data?.rows ?? []).length === 0 && <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{filters.search || filters.connector_type !== "all" || filters.state !== "all" || filters.agent_required !== "all" ? "No connections match these filters." : "No scheduled connectors yet."}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><span>{q.isError ? "Connection count unavailable" : q.data?.count ? `Showing ${(filters.page - 1) * filters.page_size + 1}–${Math.min(filters.page * filters.page_size, q.data.count)} of ${q.data.count}` : q.isLoading ? "Loading connections…" : "Showing 0 of 0"}</span><div className="flex items-center gap-2"><Select value={String(filters.page_size)} onValueChange={(v) => updateFilters({ page_size: Number(v) as 10 | 25 | 50 })}><SelectTrigger aria-label="Rows per page" className="w-24"><SelectValue /></SelectTrigger><SelectContent>{[10, 25, 50].map((size) => <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" aria-label="Previous page" disabled={filters.page <= 1 || q.isLoading || q.isError} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}><ChevronLeft className="h-4 w-4" /></Button><span>{q.isError ? "Page unavailable" : `Page ${filters.page} of ${Math.max(1, Math.ceil((q.data?.count ?? 0) / filters.page_size))}`}</span><Button variant="outline" size="sm" aria-label="Next page" disabled={filters.page >= Math.ceil((q.data?.count ?? 0) / filters.page_size) || q.isLoading || q.isError} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}><ChevronRight className="h-4 w-4" /></Button></div></div>
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            editRequestVersion.current += 1;
            setEditing(null);
            setEditTarget(null);
            setEditLoading(false);
            setEditError(false);
            save.reset();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { if (returnToViewAfterEditRef.current) { event.preventDefault(); returnToViewAfterEditRef.current = false; viewTriggerRef.current?.focus(); } }}>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit" : "New"} scheduled connector</DialogTitle>
          </DialogHeader>
          {editLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading protected connection settings…</p>}
          {editError && editTarget && <div role="alert" className="space-y-3 py-8 text-center text-sm"><p>Connection settings could not be loaded. Your access and the saved settings were left unchanged.</p><Button variant="outline" onClick={() => void startEdit(editTarget)}>Try again</Button></div>}
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input
                    value={editing.name ?? ""}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Demo Bank Nostro USD — hourly feed"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Data source</Label>
                  <Input
                    aria-label="Search data sources"
                    value={sourceSearch}
                    onChange={(e) => setSourceSearch(e.target.value)}
                    placeholder="Search data sources"
                  />
                  <Select
                    value={editing.data_source_id ?? ""}
                    onValueChange={(v) => setEditing({ ...editing, data_source_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="e.g. Demo Bank Nostro USD (Citi MT940)" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {[...(sources.data?.rows ?? []), ...(sources.data?.selected ?? [])]
                        .filter((s, i, all) => all.findIndex((candidate) => candidate.id === s.id) === i)
                        .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sources.data?.truncated ? <p className="text-xs text-muted-foreground">Showing the first {sources.data.limit} results; search by name to narrow the list.</p> : null}
                  {sources.isError ? <p role="alert" className="text-xs text-destructive">Data source choices could not be loaded.</p> : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Connector type</Label>
                  <Select
                    value={editing.connector_type}
                    disabled={!!editing.id}
                    onValueChange={(v) =>
                      setEditing({ ...editing, connector_type: v, config: defaultConfigFor(v) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="https">HTTPS / REST</SelectItem>
                      <SelectItem value="rest">REST API (paged)</SelectItem>
                      <SelectItem value="http">HTTP (legacy)</SelectItem>
                      <SelectItem value="sftp">SFTP</SelectItem>
                      <SelectItem value="ftp">FTP</SelectItem>
                      <SelectItem value="s3">Amazon S3</SelectItem>
                      <SelectItem value="azure_blob">Azure Blob Storage</SelectItem>
                      <SelectItem value="gcs">Google Cloud Storage</SelectItem>
                      <SelectItem value="bigquery">Google BigQuery</SelectItem>
                      <SelectItem value="snowflake">Snowflake</SelectItem>
                      <SelectItem value="databricks">Databricks</SelectItem>
                      <SelectItem value="local">Local folder</SelectItem>
                      <SelectItem value="network_drive">Network drive (SMB/NFS)</SelectItem>
                      <SelectItem value="manual">Manual upload only</SelectItem>
                    </SelectContent>
                  </Select>
                  {editing.id && <p className="text-xs text-muted-foreground">To change connector type, create a new schedule. Saved connection settings will remain unchanged.</p>}
                </div>
                <div className="space-y-1">
                  <Label>Cron (UTC, 5 fields)</Label>
                  <Input
                    value={editing.cron_expression}
                    onChange={(e) => setEditing({ ...editing, cron_expression: e.target.value })}
                    placeholder="e.g. 0 6 * * 1-5 — Demo Bank Nostro USD weekdays 06:00 UTC"
                    className="font-mono"
                  />
                </div>
              </div>
              <ConnectorConfig editing={editing} setEditing={setEditing} />
              {editing.sensitive_config_present && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                  Existing sensitive connection values are hidden and retained unchanged when you save. Changing or rotating them requires the approved credential-management workflow.
                </div>
              )}

              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Transformation pipeline
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        transformation: [
                          ...(editing.transformation ?? []),
                          { op: "trim", column: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-1 h-3 w-3" /> Step
                  </Button>
                </div>
                {(editing.transformation ?? []).length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    No steps — rows ingested as-is.
                  </div>
                )}
                {(editing.transformation ?? []).map((step: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select
                      value={step.op}
                      onValueChange={(v) => {
                        const t = [...editing.transformation];
                        t[idx] = { ...t[idx], op: v };
                        setEditing({ ...editing, transformation: t });
                      }}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPS.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder={step.op === "rename" ? "from" : "column"}
                      value={step.column ?? step.from ?? ""}
                      onChange={(e) => {
                        const t = [...editing.transformation];
                        t[idx] = {
                          ...t[idx],
                          [step.op === "rename" ? "from" : "column"]: e.target.value,
                        };
                        setEditing({ ...editing, transformation: t });
                      }}
                      className="flex-1 font-mono text-xs"
                    />
                    {step.op === "rename" && (
                      <Input
                        placeholder="e.g. falcon_canonical_account"
                        value={step.to ?? ""}
                        onChange={(e) => {
                          const t = [...editing.transformation];
                          t[idx] = { ...t[idx], to: e.target.value };
                          setEditing({ ...editing, transformation: t });
                        }}
                        className="flex-1 font-mono text-xs"
                      />
                    )}
                    {step.op === "cast" && (
                      <Select
                        value={step.to ?? "string"}
                        onValueChange={(v) => {
                          const t = [...editing.transformation];
                          t[idx] = { ...t[idx], to: v };
                          setEditing({ ...editing, transformation: t });
                        }}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["string", "number", "date", "boolean"].map((x) => (
                            <SelectItem key={x} value={x}>
                              {x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {step.op === "filter" && (
                      <Input
                        placeholder="e.g. amount > 1000000 or currency = 'USD'"
                        value={step.expr ?? ""}
                        onChange={(e) => {
                          const t = [...editing.transformation];
                          t[idx] = { ...t[idx], expr: e.target.value };
                          setEditing({ ...editing, transformation: t });
                        }}
                        className="flex-1 font-mono text-xs"
                      />
                    )}
                    {step.op === "derive" && (
                      <Input
                        placeholder="e.g. falcon_account || '-' || currency"
                        value={step.expression ?? ""}
                        onChange={(e) => {
                          const t = [...editing.transformation];
                          t[idx] = { ...t[idx], expression: e.target.value };
                          setEditing({ ...editing, transformation: t });
                        }}
                        className="flex-1 font-mono text-xs"
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Remove step"
                      onClick={() => {
                        const t = [...editing.transformation];
                        t.splice(idx, 1);
                        setEditing({ ...editing, transformation: t });
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="text-sm font-medium">Enabled</div>
                <Switch
                  checked={!!editing.enabled}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={save.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editing) return;
                const mutation = save.mutateAsync({ ...editing, tenant_id: tenantId });
                void mutation.then(() => save.reset(), () => save.reset());
              }}
              disabled={save.isPending || !editing || editLoading || editError}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!runsOpen} onOpenChange={(v) => !v && setRunsOpen(null)}>
        <DialogContent className="max-w-2xl" onCloseAutoFocus={(event) => { if (returnToViewAfterRunsRef.current) { event.preventDefault(); returnToViewAfterRunsRef.current = false; viewTriggerRef.current?.focus(); } }}>
          <DialogHeader>
            <DialogTitle>Run history</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Started</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Rows</th>
                  <th className="text-left p-2">Run detail</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2 text-xs">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="p-2">
                      <Badge variant={r.status === "success" ? "default" : "destructive"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{r.rows_ingested ?? "—"}</td>
                    <td className="p-2 text-xs text-destructive">
                      {r.has_error ? "This run reported an error. Review protected logs or contact your administrator." : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
    </Card>
  );
}
