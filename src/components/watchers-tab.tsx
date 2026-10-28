import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listWatchersPage,
  upsertWatcher,
  disableWatcher,
  evaluateWatcher,
} from "@/lib/watchers.functions";
import { listDataSources } from "@/lib/data-sources.functions";
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
import { Plus, PowerOff, Eye, RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { notifyUserError } from "@/lib/user-feedback";

const WATCH_TYPES = [
  "freshness",
  "raw_data",
  "row_count_delta",
  "schema_change",
  "dq_failure",
  "no_upload",
  "late_file",
  "duplicate_file",
  "filename_pattern",
  "control_total",
  "checksum_integrity",
] as const;
type WatchType = (typeof WATCH_TYPES)[number];

const WATCH_TYPE_LABELS: Record<WatchType, string> = {
  freshness: "Freshness",
  raw_data: "Raw-data volume",
  row_count_delta: "Row-count delta",
  schema_change: "Schema change",
  dq_failure: "Data-quality failure",
  no_upload: "No upload",
  late_file: "Late file",
  duplicate_file: "Duplicate file",
  filename_pattern: "Filename / sequence",
  control_total: "Control total",
  checksum_integrity: "Checksum integrity",
};

function defaultConfig(type: WatchType) {
  if (["freshness", "no_upload"].includes(type)) return { max_age_hours: 24, reminder_hours: 24 };
  if (type === "late_file")
    return {
      business_days: [1, 2, 3, 4, 5],
      cutoff_hour_utc: 18,
      grace_minutes: 0,
      holiday_dates: [],
      reminder_hours: 24,
    };
  if (type === "raw_data") return { min_rows: 1, reminder_hours: 24 };
  if (type === "row_count_delta") return { max_delta_pct: 25, reminder_hours: 24 };
  if (type === "schema_change") return { allow_added_columns: false, reminder_hours: 24 };
  if (type === "dq_failure") return { lookback_runs: 20, reminder_hours: 24 };
  if (type === "duplicate_file") return { lookback_uploads: 20, reminder_hours: 24 };
  if (type === "filename_pattern")
    return { pattern: "*.csv", sequence_increment: undefined, reminder_hours: 24 };
  if (type === "control_total")
    return { column: "amount", expected: 0, tolerance: 0, reminder_hours: 24 };
  return { require_sha256: true, reminder_hours: 24 };
}

function optionalNumber(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

function configObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(config: Record<string, unknown>, key: string): number | null {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatWatcherCondition(type: string, value: unknown): string {
  const config = configObject(value);
  const n = (key: string) => numberValue(config, key);
  const age = n("max_age_hours");
  switch (type) {
    case "freshness":
    case "no_upload":
      return age === null ? "Maximum age is not configured." : `Maximum age: ${age} hours.`;
    case "raw_data": {
      const limits = [
        n("min_rows") !== null ? `at least ${n("min_rows")} rows` : null,
        n("max_rows") !== null ? `at most ${n("max_rows")} rows` : null,
        n("min_bytes") !== null ? `at least ${n("min_bytes")} bytes` : null,
        n("max_bytes") !== null ? `at most ${n("max_bytes")} bytes` : null,
      ].filter(Boolean);
      return limits.length ? limits.join("; ") + "." : "No row-count or file-size limits are configured.";
    }
    case "row_count_delta": {
      const delta = n("max_delta_pct");
      return delta === null ? "Maximum row-count change is not configured." : `Maximum row-count change: ${delta}%.`;
    }
    case "schema_change": {
      const allowed = config.allow_added_columns;
      const columns = Array.isArray(config.expected_columns)
        ? config.expected_columns.filter((item): item is string => typeof item === "string")
        : [];
      const parts = [
        typeof allowed === "boolean" ? `Added columns ${allowed ? "are allowed" : "are not allowed"}` : null,
        columns.length ? `Expected columns: ${columns.join(", ")}` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(". ") + "." : "Schema change settings are not configured.";
    }
    case "dq_failure": {
      const runs = n("lookback_runs");
      return runs === null ? "DQ lookback is not configured." : `Checks the latest ${runs} data-quality runs.`;
    }
    case "late_file": {
      const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const days = Array.isArray(config.business_days)
        ? config.business_days.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6).map((day) => labels[day])
        : [];
      const cutoff = n("cutoff_hour_utc");
      const grace = n("grace_minutes");
      const parts = [
        days.length ? `Expected ${days.join(", ")}` : null,
        cutoff !== null ? `cutoff ${String(cutoff).padStart(2, "0")}:00 UTC` : null,
        grace !== null ? `${grace} minute${grace === 1 ? "" : "s"} grace` : null,
        Array.isArray(config.holiday_dates) && config.holiday_dates.length ? `${config.holiday_dates.length} configured holiday dates` : null,
      ].filter(Boolean);
      return parts.length ? parts.join("; ") + "." : "Late-file calendar settings are not configured.";
    }
    case "duplicate_file": {
      const lookback = n("lookback_uploads");
      return lookback === null ? "Duplicate-check lookback is not configured." : `Checks the latest ${lookback} uploads for duplicates.`;
    }
    case "filename_pattern": {
      const pattern = typeof config.pattern === "string" ? config.pattern : null;
      const increment = n("sequence_increment");
      return pattern ? `Filename pattern: ${pattern}${increment === null ? "." : `; expected sequence increment: ${increment}.`}` : "Filename pattern is not configured.";
    }
    case "control_total": {
      const column = typeof config.column === "string" ? config.column : null;
      const expected = n("expected");
      const tolerance = n("tolerance");
      const min = n("min");
      const max = n("max");
      if (!column) return "Control-total column is not configured.";
      if (expected !== null) return `Sum of ${column}: expected ${expected}${tolerance === null ? "" : ` (tolerance ${tolerance})`}.`;
      if (min !== null || max !== null) return `${column} total range: ${min ?? "no minimum"} to ${max ?? "no maximum"}.`;
      return `Control total uses column ${column}; limits are not configured.`;
    }
    case "checksum_integrity":
      if (typeof config.expected_sha256 === "string") return "Checks the incoming SHA-256 against a configured expected checksum.";
      return config.require_sha256 === false ? "A SHA-256 checksum is optional; no expected checksum is configured." : "A valid SHA-256 checksum is required; no expected value is configured.";
    default:
      return "Condition details are unavailable for this watcher type.";
  }
}

export function WatchersTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listWatchersPage);
  const upsert = useServerFn(upsertWatcher);
  const disable = useServerFn(disableWatcher);
  const evalFn = useServerFn(evaluateWatcher);
  const getAccessSummaries = useServerFn(getResourceAccessSummaries);
  const getActorSummaries = useServerFn(getResourceActorSummaries);
  const invalidateActorSummaries = () => qc.invalidateQueries({ queryKey: ["resource-actor-summary", tenantId, "file_watcher"] });
  const lds = useServerFn(listDataSources);
  const { confirm, ConfirmDialog } = useConfirm();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [publicIdSearch, setPublicIdSearch] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedThrough, setUpdatedThrough] = useState("");
  const [page, setPage] = useState(0);
  const [stateFilter, setStateFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sort, setSort] = useState("name_asc");
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
  const returnToViewAfterEditRef = useRef(false);
  const q = useQuery({
    queryKey: ["watchers", tenantId, debouncedSearch, stateFilter, typeFilter, severityFilter, sourceFilter, sort, page, publicIdSearch, updatedFrom, updatedThrough],
    queryFn: () => list({ data: {
      tenant_id: tenantId, page, page_size: 25, search: debouncedSearch,
      public_id_search: publicIdSearch || undefined,
      updated_from: updatedFrom || undefined,
      updated_through: updatedThrough || undefined,
      state: stateFilter as "all" | "ok" | "alert" | "unknown" | "disabled",
      watch_type: typeFilter === "all" ? undefined : typeFilter as WatchType,
      severity: severityFilter === "all" ? undefined : severityFilter as "info" | "warning" | "critical",
      source_id: sourceFilter === "all" ? undefined : sourceFilter,
      sort: sort as "name_asc" | "name_desc" | "last_check_desc" | "last_check_asc",
    } }),
  });
  const sources = useQuery({
    queryKey: ["data-sources", tenantId],
    queryFn: () => lds({ data: { tenant_id: tenantId } }),
  });

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(0), [debouncedSearch, stateFilter, typeFilter, severityFilter, sourceFilter, sort]);
  const watchers = q.data?.rows ?? [];
  const accessQ = useQuery({
    queryKey: ["resource-access-summary", tenantId, "file_watcher", watchers.map((row: any) => row.id)],
    queryFn: () => getAccessSummaries({ data: { resource_type: "file_watcher", resource_ids: watchers.map((row: any) => row.id) } }),
    enabled: watchers.length > 0,
  });
  const accessById = new Map((accessQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const actorQ = useQuery({
    queryKey: ["resource-actor-summary", tenantId, "file_watcher", watchers.map((row: any) => row.id)],
    queryFn: () => getActorSummaries({ data: { resource_type: "file_watcher", resource_ids: watchers.map((row: any) => row.id) } }),
    enabled: watchers.length > 0 && watchers.length <= 100,
  });
  const actorsById = new Map((actorQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const selected = watchers.find((watcher) => watcher.id === selectedId) ?? watchers[0] ?? null;
  const viewed = watchers.find((watcher) => watcher.id === viewId) ?? null;
  const pageCount = Math.max(1, Math.ceil((q.data?.total ?? 0) / 25));

  const save = useMutation({
    mutationFn: (v: any) => upsert({ data: v }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["watchers", tenantId] });
      void invalidateActorSummaries();
      setOpen(false);
    },
    onError: (error) => notifyUserError(error, "watcher_save"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => disable({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      toast.success("Watcher disabled; history retained");
      qc.invalidateQueries({ queryKey: ["watchers", tenantId] });
      void invalidateActorSummaries();
    },
  });
  const ev = useMutation({
    mutationFn: (id: string) => evalFn({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r) => {
      toast.success(`State: ${r.state}`);
      qc.invalidateQueries({ queryKey: ["watchers", tenantId] });
      void invalidateActorSummaries();
    },
    onError: (error) => notifyUserError(error, "watcher_evaluate"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Data watchers
          </CardTitle>
          <CardDescription>
            Freshness, volume, schema, DQ, duplicate, naming, control-total and checksum monitoring
            per data source.
          </CardDescription>
        </div>
        {canWrite ? (
          <Button
            onClick={() => {
              setDraft({
                tenant_id: tenantId,
                name: "",
                watch_type: "freshness",
                config: defaultConfig("freshness"),
                severity: "warning",
                enabled: true,
              });
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> New watcher
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="relative grid gap-4 p-4">
        <div className="min-w-0 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7">
            <div className="relative xl:col-span-3 2xl:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search watchers by name or source" className="pl-9" placeholder="Search watchers by name or source…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Select value={stateFilter} onValueChange={setStateFilter}><SelectTrigger aria-label="Filter by state"><SelectValue /></SelectTrigger><SelectContent>{[["all","All states"],["ok","OK"],["alert","Alert"],["unknown","Unknown"],["disabled","Disabled"]].map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger aria-label="Filter by type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{WATCH_TYPES.map((t)=><SelectItem key={t} value={t}>{WATCH_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger aria-label="Filter by severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severities</SelectItem>{["info","warning","critical"].map((v)=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}><SelectTrigger aria-label="Filter by source"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All sources</SelectItem>{(sources.data ?? []).map((s)=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            <Select value={sort} onValueChange={setSort}><SelectTrigger aria-label="Sort watchers"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name_asc">Name (A–Z)</SelectItem><SelectItem value="name_desc">Name (Z–A)</SelectItem><SelectItem value="last_check_desc">Last check (newest)</SelectItem><SelectItem value="last_check_asc">Last check (oldest)</SelectItem></SelectContent></Select>
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div><Label htmlFor="watcher-updated-from">Updated from (UTC)</Label><Input id="watcher-updated-from" type="date" aria-label="Updated from date (UTC)" value={updatedFrom} onChange={(event) => { setUpdatedFrom(event.target.value); setPage(0); }} /><p className="mt-1 text-[11px] text-muted-foreground">Includes this full UTC calendar day.</p></div>
            <div><Label htmlFor="watcher-updated-through">Updated through (UTC)</Label><Input id="watcher-updated-through" type="date" aria-label="Updated through date (UTC)" value={updatedThrough} onChange={(event) => { setUpdatedThrough(event.target.value); setPage(0); }} /><p className="mt-1 text-[11px] text-muted-foreground">Includes this full UTC calendar day.</p></div>
            <div><Label htmlFor="watcher-public-id">Public ID search</Label><Input id="watcher-public-id" aria-label="Search by Public ID" disabled={accessQ.data?.available !== true} placeholder={accessQ.data?.available === true ? "Search generated Public ID" : "Public ID search unavailable"} value={publicIdSearch} onChange={(event) => { setPublicIdSearch(event.target.value); setPage(0); }} /><p className="mt-1 text-[11px] text-muted-foreground" role={accessQ.data?.available === true ? undefined : "status"}>{accessQ.data?.available === true ? "Searches generated IDs across all watcher records." : "Ask an administrator to apply the resource identity migrations, then refresh to enable Public ID search."}</p></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Selected: {selected?.name ?? "No watcher selected"}</span>
            <Button ref={detailsToolbarRef} type="button" size="sm" variant="outline" aria-controls="watcher-inspector" aria-expanded={detailsVisible} onMouseEnter={showDetailsPreview} onMouseLeave={scheduleDetailsPreviewClose} onFocus={showDetailsPreview} onBlur={scheduleDetailsPreviewClose} onKeyDown={(event) => { if (event.key === "Escape") { clearDetailsPreviewClose(); setDetailsPinned(false); setDetailsPreview(false); } }} onClick={() => { showDetailsPreview(); setDetailsPinned((pinned) => !pinned); setDetailsPreview(false); }}>{detailsPinned ? "Hide details" : "Show details"}</Button>
          </div>
          {q.isError ? <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">Watcher list is unavailable. Refresh to try again.</p> : null}
          <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Public ID</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Business units</th><th className="px-4 py-2">User groups</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2">Last check</th>
                    <th className="fvi-sticky-view-cell px-4 py-2 text-right">View</th>
              </tr>
            </thead>
            <tbody>
              {watchers.map((w) => (
                <tr key={w.id} onClick={() => setSelectedId(w.id)} aria-selected={selected?.id === w.id} className={`cursor-pointer border-b ${selected?.id === w.id ? "fvi-selected-row" : ""}`}>
                  <td className="px-4 py-2 font-medium"><button type="button" aria-label={`Select watcher ${w.name}`} aria-pressed={selected?.id === w.id} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => { event.stopPropagation(); setSelectedId(w.id); }}>{w.name}</button></td>
                  <td className="px-4 py-2"><ResourceIdentitySummary section="identity" summary={accessById.get(w.id)} available={accessQ.data?.available === true} /></td>
                  <td className="px-4 py-2 text-xs">{w.data_source?.name ?? "—"}</td>
                  <td className="px-4 py-2"><ResourceIdentitySummary section="business-units" summary={accessById.get(w.id)} available={accessQ.data?.available === true} /></td><td className="px-4 py-2"><ResourceIdentitySummary section="user-groups" summary={accessById.get(w.id)} available={accessQ.data?.available === true} /></td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">
                      {WATCH_TYPE_LABELS[w.watch_type as WatchType] ?? w.watch_type}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">{w.severity}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="space-y-1">
                      <Badge variant={w.enabled && w.last_checked_at && w.last_state === "alert" ? "destructive" : "outline"}>
                        {!w.enabled ? "disabled" : !w.last_checked_at ? "unknown" : w.last_state === "ok" ? "OK" : w.last_state === "alert" ? "alert" : "unknown"}
                      </Badge>
                      {w.last_event?.outcome_code ? (
                        <p className="text-[10px] text-muted-foreground">
                          {w.last_event.outcome_code.replaceAll("_", " ")}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {w.last_checked_at ? <><span className="block">{new Date(w.last_checked_at).toLocaleString()}</span><ResourceActorSummaryView mode="updated-line" summary={actorsById.get(w.id)} available={actorQ.data?.available === true} /></> : "No check yet"}
                  </td>
                    <td className="fvi-sticky-view-cell px-4 py-2 text-right">
                    <Button size="sm" variant="outline" className="fvi-row-view-action" aria-label={`View ${w.name}`} aria-pressed={selected?.id === w.id} onClick={(event) => { event.stopPropagation(); viewTriggerRef.current = event.currentTarget; setSelectedId(w.id); setViewId(w.id); }}>
                      <Eye className="h-4 w-4" />
                      <span className="ml-1">View</span>
                    </Button>
                  </td>
                </tr>
              ))}
              {q.data && watchers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No watchers yet. Start with a freshness rule for a daily critical feed.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{q.data?.total ? `${page * 25 + 1}–${Math.min((page + 1) * 25, q.data.total)} of ${q.data.total}` : "0 watchers"}</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" aria-label="Previous page" disabled={page === 0 || q.isFetching} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button><span>Page {page + 1} of {pageCount}</span><Button size="sm" variant="outline" aria-label="Next page" disabled={page + 1 >= pageCount || q.isFetching} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
        </div>
        <Dialog open={Boolean(viewId)} onOpenChange={(isOpen) => { if (!isOpen) setViewId(null); }}>
          <DialogContent className="h-[min(92dvh,64rem)] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[min(96vw,88rem)] overflow-hidden gap-0 p-0" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); if (viewTransitionRef.current) { viewTransitionRef.current = false; return; } viewTriggerRef.current?.focus(); }}>
              {viewed ? <FviDetailDialogLayout
                railEyebrow="INGESTION"
                railTitle="FILE WATCHER"
                railStatus={<Badge variant="outline" className="border-[var(--fvi-gold)] text-[var(--fvi-gold-hi)]">{!viewed.enabled ? "Disabled" : !viewed.last_checked_at ? "Unknown" : viewed.last_state === "ok" ? "OK" : viewed.last_state === "alert" ? "Alert" : "Unknown"}</Badge>}
                railFields={[
                  { label: "Severity", value: viewed.severity },
                ]}
                title={viewed.name}
                description="Monitoring condition, latest state, and available actions."
                content={<div className="space-y-6">
                <section aria-label="Identity and access" className="space-y-3"><h3 className="text-base font-semibold">Identity and access</h3><ResourceIdentitySummary mode="detail" summary={accessById.get(viewed.id)} available={accessQ.data?.available === true} /><ResourceActorSummaryView mode="detail" summary={actorsById.get(viewed.id)} available={actorQ.data?.available === true} /></section>
                <section aria-label="Monitoring rule" className="space-y-3 border-y py-4"><h3 className="text-base font-semibold">Monitoring rule</h3><dl className="grid gap-3 text-sm"><div><dt className="text-xs font-medium text-muted-foreground">Source</dt><dd>{viewed.data_source?.name ?? "Source unavailable"}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Check type</dt><dd>{WATCH_TYPE_LABELS[viewed.watch_type as WatchType] ?? viewed.watch_type}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Condition</dt><dd>{formatWatcherCondition(viewed.watch_type, viewed.config)}</dd></div></dl></section>
                <section aria-label="Latest status and history" className="space-y-3"><h3 className="text-base font-semibold">Latest status and history</h3><dl className="grid gap-3 text-sm"><div><dt className="text-xs font-medium text-muted-foreground">Current status</dt><dd>{!viewed.enabled ? "Disabled. Scheduled checks are stopped." : !viewed.last_checked_at ? "No recent check is available. State is unknown until a check runs." : viewed.last_state === "ok" ? "Latest recorded check was OK." : viewed.last_state === "alert" ? "Latest recorded check raised an alert." : "Latest check did not establish a healthy or alert state."}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Last check</dt><dd>{viewed.last_checked_at ? new Date(viewed.last_checked_at).toLocaleString() : "No check has been executed yet."}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Latest history event</dt><dd>{viewed.last_event ? `${viewed.last_event.outcome_code.replaceAll("_", " ")} · ${new Date(viewed.last_event.occurred_at).toLocaleString()}` : "No recorded history event."}</dd></div></dl></section>
                </div>}
                actions={<><Button variant="outline" disabled={!canWrite} onClick={() => { viewTransitionRef.current = true; returnToViewAfterEditRef.current = true; setViewId(null); setDraft({ ...viewed, tenant_id: tenantId }); setOpen(true); }}>Edit</Button><Button disabled={!canWrite || !viewed.enabled || ev.isPending} onClick={() => ev.mutate(viewed.id)}><RefreshCw className="mr-2 h-4 w-4" />Evaluate</Button>{canWrite && viewed.enabled ? <Button variant="outline" disabled={remove.isPending} onClick={async () => { viewTransitionRef.current = true; setViewId(null); if (await confirm({ title: "Disable watcher?", description: "Scheduled evaluation stops, but configuration and audit history remain available." })) remove.mutate(viewed.id); viewTriggerRef.current?.focus(); }}><PowerOff className="mr-2 h-4 w-4" />Disable watcher</Button> : null}</>}
              /> : <p className="p-6 text-sm text-muted-foreground">This watcher is no longer on the current page. Close this view and locate it again.</p>}
          </DialogContent>
        </Dialog>
        {detailsVisible ? <aside id="watcher-inspector" aria-label="Selected watcher details" onMouseEnter={showDetailsPreview} onMouseLeave={scheduleDetailsPreviewClose} onFocus={showDetailsPreview} onKeyDown={(event) => { if (event.key === "Escape") { clearDetailsPreviewClose(); setDetailsPinned(false); setDetailsPreview(false); } }} style={{ top: detailsPanelTop ?? undefined }} className="fixed inset-x-2 bottom-2 top-auto z-40 max-h-[70dvh] overflow-y-auto rounded-lg border bg-background p-4 shadow-xl md:inset-y-4 md:left-auto md:right-4 md:top-auto md:w-80 md:max-h-[calc(100dvh-6rem)]">
          <Button type="button" variant="ghost" size="sm" className="mb-2 md:hidden" onClick={() => { setDetailsPinned(false); setDetailsPreview(false); }}>Hide details</Button>
          {selected ? <ResourceActorSummaryView mode="detail" summary={actorsById.get(selected.id)} available={actorQ.data?.available === true} /> : null}
          {selected ? <div className="space-y-4"><div><p className="text-xs uppercase text-muted-foreground">Selected watcher</p><h3 className="mt-1 break-words font-semibold">{selected.name}</h3><div className="mt-2 flex gap-2"><Badge variant={selected.severity === "critical" ? "destructive" : "outline"}>{selected.severity}</Badge><Badge variant="outline">{!selected.enabled ? "disabled" : !selected.last_checked_at ? "unknown" : selected.last_state === "ok" ? "OK" : selected.last_state === "alert" ? "alert" : "unknown"}</Badge></div></div><div className="space-y-3 border-y py-3 text-sm"><div><p className="text-xs font-medium text-muted-foreground">Source</p><p>{selected.data_source?.name ?? "Source unavailable"}</p></div><div><p className="text-xs font-medium text-muted-foreground">Check type</p><p>{WATCH_TYPE_LABELS[selected.watch_type as WatchType] ?? selected.watch_type}</p></div><div><p className="text-xs font-medium text-muted-foreground">Condition</p><p className="text-muted-foreground">{formatWatcherCondition(selected.watch_type, selected.config)}</p></div><div><p className="text-xs font-medium text-muted-foreground">Current status</p><p className="text-muted-foreground">{!selected.enabled ? "Disabled. Scheduled checks are stopped." : !selected.last_checked_at ? "No recent check is available. State is unknown until a check runs." : selected.last_state === "ok" ? "Latest recorded check was OK." : selected.last_state === "alert" ? "Latest recorded check raised an alert." : "Latest check did not establish a healthy or alert state."}</p></div><div><p className="text-xs font-medium text-muted-foreground">Last check</p><p className="text-muted-foreground">{selected.last_checked_at ? new Date(selected.last_checked_at).toLocaleString() : "No check has been executed yet."}</p></div>{selected.last_event ? <div><p className="text-xs font-medium text-muted-foreground">Latest history event</p><p>{selected.last_event.outcome_code.replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{new Date(selected.last_event.occurred_at).toLocaleString()}</p></div> : <p className="text-xs text-muted-foreground">No recorded history event.</p>}</div><div className="flex gap-2"><Button className="flex-1" variant="outline" disabled={!canWrite} onClick={() => { setDraft({ ...selected, tenant_id: tenantId }); setOpen(true); }}>Edit</Button><Button className="flex-1" disabled={!canWrite || !selected.enabled || ev.isPending} onClick={() => ev.mutate(selected.id)}><RefreshCw className="mr-2 h-4 w-4" />Evaluate</Button></div>{canWrite && selected.enabled ? <Button className="w-full" variant="ghost" disabled={remove.isPending} onClick={async () => { if (await confirm({ title: "Disable watcher?", description: "Scheduled evaluation stops, but configuration and audit history remain available." })) remove.mutate(selected.id); }}><PowerOff className="mr-2 h-4 w-4" />Disable watcher</Button> : null}</div> : <p className="text-sm text-muted-foreground">Select a watcher to inspect its source, condition, latest state and history.</p>}
        </aside> : null}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={(event) => { if (returnToViewAfterEditRef.current) { event.preventDefault(); returnToViewAfterEditRef.current = false; viewTriggerRef.current?.focus(); } }}>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit watcher" : "New watcher"}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Data source</Label>
                <Select
                  value={draft.data_source_id ?? ""}
                  onValueChange={(v) => setDraft({ ...draft, data_source_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(sources.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Watch type</Label>
                  <Select
                    value={draft.watch_type}
                    onValueChange={(v) =>
                      setDraft({ ...draft, watch_type: v, config: defaultConfig(v as WatchType) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WATCH_TYPES.map((k) => (
                        <SelectItem key={k} value={k}>
                          {WATCH_TYPE_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Severity</Label>
                  <Select
                    value={draft.severity}
                    onValueChange={(v) => setDraft({ ...draft, severity: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">info</SelectItem>
                      <SelectItem value="warning">warning</SelectItem>
                      <SelectItem value="critical">critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(["freshness", "no_upload"] as string[]).includes(draft.watch_type) ? (
                <div>
                  <Label>Max age (hours)</Label>
                  <Input
                    type="number"
                    min={0.01}
                    max={8760}
                    value={draft.config?.max_age_hours ?? 24}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...draft.config, max_age_hours: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              ) : null}
              {draft.watch_type === "late_file" ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Business calendar: Monday–Friday UTC. Holiday dates can be supplied through the
                    API.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Cutoff hour (UTC)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={draft.config?.cutoff_hour_utc ?? 18}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            config: { ...draft.config, cutoff_hour_utc: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Grace period (minutes)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={1440}
                        value={draft.config?.grace_minutes ?? 0}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            config: { ...draft.config, grace_minutes: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : null}
              {draft.watch_type === "raw_data" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Minimum rows</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.config?.min_rows ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          config: { ...draft.config, min_rows: optionalNumber(e.target.value) },
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Maximum rows</Label>
                    <Input
                      type="number"
                      min={1}
                      value={draft.config?.max_rows ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          config: { ...draft.config, max_rows: optionalNumber(e.target.value) },
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Minimum bytes</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.config?.min_bytes ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          config: { ...draft.config, min_bytes: optionalNumber(e.target.value) },
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Maximum bytes</Label>
                    <Input
                      type="number"
                      min={1}
                      value={draft.config?.max_bytes ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          config: { ...draft.config, max_bytes: optionalNumber(e.target.value) },
                        })
                      }
                    />
                  </div>
                </div>
              ) : null}
              {draft.watch_type === "row_count_delta" ? (
                <div>
                  <Label>Max delta %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10000}
                    value={draft.config?.max_delta_pct ?? 25}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...draft.config, max_delta_pct: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              ) : null}
              {draft.watch_type === "schema_change" ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label>Allow added columns</Label>
                  <Switch
                    checked={Boolean(draft.config?.allow_added_columns)}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, config: { ...draft.config, allow_added_columns: v } })
                    }
                  />
                </div>
              ) : null}
              {draft.watch_type === "dq_failure" ? (
                <div>
                  <Label>DQ run lookback</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.config?.lookback_runs ?? 20}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...draft.config, lookback_runs: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              ) : null}
              {draft.watch_type === "duplicate_file" ? (
                <div>
                  <Label>Upload lookback</Label>
                  <Input
                    type="number"
                    min={2}
                    max={100}
                    value={draft.config?.lookback_uploads ?? 20}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...draft.config, lookback_uploads: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              ) : null}
              {draft.watch_type === "filename_pattern" ? (
                <div className="space-y-3">
                  <div>
                    <Label>Filename pattern</Label>
                    <Input
                      value={draft.config?.pattern ?? "*.csv"}
                      placeholder="nostro_????????.csv"
                      onChange={(e) =>
                        setDraft({ ...draft, config: { ...draft.config, pattern: e.target.value } })
                      }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use * for any text and ? for one character. Regular expressions are not
                      accepted.
                    </p>
                  </div>
                  <div>
                    <Label>Expected sequence increment (optional)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={1000000}
                      value={draft.config?.sequence_increment ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          config: {
                            ...draft.config,
                            sequence_increment: optionalNumber(e.target.value),
                          },
                        })
                      }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Checks the final numeric group against the previous filename.
                    </p>
                  </div>
                </div>
              ) : null}
              {draft.watch_type === "control_total" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Numeric column</Label>
                    <Input
                      value={draft.config?.column ?? "amount"}
                      onChange={(e) =>
                        setDraft({ ...draft, config: { ...draft.config, column: e.target.value } })
                      }
                    />
                  </div>
                  <div>
                    <Label>Expected total</Label>
                    <Input
                      type="number"
                      value={draft.config?.expected ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          config: { ...draft.config, expected: optionalNumber(e.target.value) },
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Tolerance</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.config?.tolerance ?? 0}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          config: { ...draft.config, tolerance: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                </div>
              ) : null}
              {draft.watch_type === "checksum_integrity" ? (
                <div className="space-y-3">
                  <div>
                    <Label>Expected SHA-256 (optional)</Label>
                    <Input
                      value={draft.config?.expected_sha256 ?? ""}
                      maxLength={64}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          config: {
                            ...draft.config,
                            expected_sha256: e.target.value.trim() || undefined,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <Label>Require SHA-256</Label>
                    <Switch
                      checked={draft.config?.require_sha256 !== false}
                      onCheckedChange={(v) =>
                        setDraft({ ...draft, config: { ...draft.config, require_sha256: v } })
                      }
                    />
                  </div>
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>Quarantine source on alert</Label>
                  <p className="text-xs text-muted-foreground">
                    Marks the source as error; recovery does not silently clear another data issue.
                  </p>
                </div>
                <Switch
                  checked={Boolean(draft.config?.quarantine_on_alert)}
                  onCheckedChange={(v) =>
                    setDraft({ ...draft, config: { ...draft.config, quarantine_on_alert: v } })
                  }
                />
              </div>
              <div>
                <Label>Repeat alert after (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={draft.config?.reminder_hours ?? 24}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      config: { ...draft.config, reminder_hours: Number(e.target.value) },
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || !draft?.name || !draft?.data_source_id}
              onClick={() => save.mutate(draft)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
    </Card>
  );
}
