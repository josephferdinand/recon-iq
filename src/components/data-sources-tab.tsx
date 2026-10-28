import { useEffect, useRef, useState } from "react";
import { pageWithinLoadedResult } from "@/lib/list-pagination";
import { getResourceAccessSummaries } from "@/lib/resource-access-summaries.functions";
import { ResourceIdentitySummary } from "@/components/resource-identity-summary";
import { ResourceActorSummary as ResourceActorSummaryView } from "@/components/resource-actor-summary";
import { getResourceActorSummaries } from "@/lib/resource-actor-summaries.functions";
import { FviDetailDialogLayout } from "@/components/fvi-detail-dialog-layout";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getDataSource,
  listDataSourcesPage,
  createDataSource,
  deleteDataSource,
  registerUpload,
  updateDataSource,
} from "@/lib/data-sources.functions";
import { parseCsv, sha256Hex } from "@/lib/csv-parse";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  Plus,
  Trash2,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Archive,
  ChevronDown,
  ChevronUp,
  Search,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SourceType = "csv" | "xlsx" | "json" | "api" | "database" | "manual";
type DataSourceRow = {
  id: string;
  name: string;
  description: string | null;
  source_type: SourceType;
  status: "draft" | "ready" | "error" | "archived";
  row_count: number;
  inferred_schema: Array<{
    name: string;
    inferred_type: string;
    nullable: boolean | null;
  }> | null;
  created_at: string;
  updated_at: string;
};

function dataSourceWriteFailure(error: unknown, action: string, nextActionId: string, nextActionLabel: string): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definitelyRejected = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
  const category: UserMessageCategory = definitelyRejected ? mapped.category : "unknown_write_outcome";
  return formatUserMessage({
    ...mapped,
    category,
    action,
    code,
    status,
    availableActions: category === "unknown_write_outcome" || mapped.reason === "duplicate"
      ? [{ id: nextActionId, label: nextActionLabel }]
      : [],
  });
}

type DataSourceListSort = "recent" | "oldest" | "name_asc" | "name_desc";
const PAGE_SIZE = 25;
const MAX_UPLOAD_BYTES = 10_000_000;

const TYPE_LABELS: Record<SourceType, string> = {
  csv: "CSV file",
  xlsx: "Excel (xlsx)",
  json: "JSON",
  api: "REST API",
  database: "Database",
  manual: "Manual entry",
};

export function DataSourcesTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const list = useServerFn(listDataSourcesPage);
  const getDetails = useServerFn(getDataSource);
  const create = useServerFn(createDataSource);
  const del = useServerFn(deleteDataSource);
  const upload = useServerFn(registerUpload);
  const update = useServerFn(updateDataSource);
  const getAccessSummaries = useServerFn(getResourceAccessSummaries);
  const getActorSummaries = useServerFn(getResourceActorSummaries);
  const invalidateActorSummaries = () => qc.invalidateQueries({ queryKey: ["resource-actor-summary", tenantId, "data_source"] });

  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [publicIdSearch, setPublicIdSearch] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedThrough, setUpdatedThrough] = useState("");
  const [sourceType, setSourceType] = useState<SourceType | "all">("all");
  const [status, setStatus] = useState<"draft" | "ready" | "error" | "archived" | "all">("all");
  const [sort, setSort] = useState<DataSourceListSort>("recent");
  const [page, setPage] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [viewSourceId, setViewSourceId] = useState<string | null>(null);
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
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewTransitionRef = useRef(false);
  const pendingFilePickerRef = useRef<string | null>(null);

  useEffect(() => {
    return () => clearDetailsPreviewClose();
  }, []);
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchTerm(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    if (!detailsVisible) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDetailsPinned(false); setDetailsPreview(false); }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [detailsVisible]);

  const sortBy = sort === "name_asc" || sort === "name_desc" ? "name" : "updated_at";
  const sortDirection = sort === "oldest" || sort === "name_asc" ? "asc" : "desc";
  const q = useQuery({
    queryKey: ["data-sources-page", tenantId, page, searchTerm, sourceType, status, sortBy, sortDirection, publicIdSearch, updatedFrom, updatedThrough],
    queryFn: () => list({
      data: {
        tenant_id: tenantId,
        page,
        page_size: PAGE_SIZE,
        search: searchTerm || undefined,
        public_id_search: publicIdSearch || undefined,
        updated_from: updatedFrom || undefined,
        updated_through: updatedThrough || undefined,
        source_type: sourceType === "all" ? undefined : sourceType,
        status: status === "all" ? undefined : status,
        sort_by: sortBy,
        sort_direction: sortDirection,
      },
    }),
  });
  const rows = (q.data?.rows ?? []) as DataSourceRow[];
  const accessQ = useQuery({
    queryKey: ["resource-access-summary", tenantId, "data_source", rows.map((row) => row.id)],
    queryFn: () => getAccessSummaries({ data: { resource_type: "data_source", resource_ids: rows.map((row) => row.id) } }),
    enabled: rows.length > 0,
  });
  const accessById = new Map((accessQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const actorQ = useQuery({
    queryKey: ["resource-actor-summary", tenantId, "data_source", rows.map((row) => row.id)],
    queryFn: () => getActorSummaries({ data: { resource_type: "data_source", resource_ids: rows.map((row) => row.id) } }),
    enabled: rows.length > 0 && rows.length <= 100,
  });
  const actorsById = new Map((actorQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const selectedRow = rows.find((source) => source.id === selectedSourceId) ?? rows[0] ?? null;
  const viewSource = rows.find((source) => source.id === viewSourceId) ?? null;
  const detailQ = useQuery({
    queryKey: ["data-source-detail", tenantId, selectedRow?.id],
    queryFn: () => getDetails({ data: { id: selectedRow!.id, tenant_id: tenantId } }),
    enabled: Boolean(selectedRow?.id),
  });
  const hasFilters = Boolean(searchTerm || publicIdSearch || updatedFrom || updatedThrough || sourceType !== "all" || status !== "all");
  const total = q.data?.total ?? 0;
  const totalPages = q.data?.total_pages ?? 0;
  const firstVisible = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(page * PAGE_SIZE, total);

  useEffect(() => {
    const nextPage = pageWithinLoadedResult(page, totalPages, q.isSuccess);
    if (nextPage !== page) setPage(nextPage);
  }, [page, totalPages, q.isSuccess]);

  const [open, setOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(true);
  const [form, setForm] = useState<{ name: string; description: string; source_type: SourceType }>({
    name: "",
    description: "",
    source_type: "csv",
  });
  const [createFieldErrors, setCreateFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [actionMessage, setActionMessage] = useState<UserMessage | null>(null);
  const [actionMessageContext, setActionMessageContext] = useState<"create" | "workspace">("workspace");
  const [messageSourceId, setMessageSourceId] = useState<string | null>(null);

  function refreshSourceList() {
    void q.refetch();
  }

  function checkUploadHistory() {
    if (!messageSourceId) return;
    const dsId = messageSourceId;
    setSelectedSourceId(dsId);
    setViewSourceId(dsId);
    void qc.invalidateQueries({ queryKey: ["data-source-detail", tenantId, dsId] });
    void qc.invalidateQueries({ queryKey: ["data-sources-page", tenantId] });
  }

  function performMessageAction(id: string) {
    if (id === "refresh-sources") refreshSourceList();
    if (id === "check-upload-history") checkUploadHistory();
    if (id === "choose-file" && messageSourceId) fileRefs.current[messageSourceId]?.click();
  }

  const actionMessageView = actionMessage ? (
    <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p className="font-medium">{actionMessage.title}</p>
      <p className="mt-1">{actionMessage.humanMessage}</p>
      {actionMessageContext !== "create" ? Object.entries(actionMessage.fieldErrors).map(([field, copy]) => <p key={field} className="mt-1 text-destructive">{copy}</p>) : null}
      {actionMessage.nextActions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2 mr-2" onClick={() => performMessageAction(action.id)}>{action.label}</Button>)}
    </div>
  ) : null;

  const mCreate = useMutation({
    mutationFn: () =>
      create({
        data: {
          tenant_id: tenantId,
          name: form.name.trim(),
          description: form.description.trim() || null,
          source_type: form.source_type,
        },
      }),
    onSuccess: (created) => {
      setActionMessage(null);
      setCreateFieldErrors({});
      toast.success("Data source created");
      setOpen(false);
      setForm({ name: "", description: "", source_type: "csv" });
      setSelectedSourceId(created.id);
      qc.invalidateQueries({ queryKey: ["data-sources-page", tenantId] });
      void invalidateActorSummaries();
    },
    onError: (error) => {
      setActionMessageContext("create");
      setActionMessage(dataSourceWriteFailure(error, "create this data source", "refresh-sources", "Refresh data sources"));
    },
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: (_, id) => {
      setActionMessage(null);
      toast.success("Data source deleted");
      qc.invalidateQueries({ queryKey: ["data-sources-page", tenantId] });
      qc.removeQueries({ queryKey: ["data-source-detail", tenantId, id] });
      void invalidateActorSummaries();
      if (selectedSourceId === id) setSelectedSourceId(null);
    },
    onError: (error) => {
      setActionMessageContext("workspace");
      setActionMessage(dataSourceWriteFailure(error, "delete this data source", "refresh-sources", "Refresh data sources"));
    },
  });

  const mArchive = useMutation({
    mutationFn: (id: string) => update({ data: { id, tenant_id: tenantId, status: "archived" } }),
    onSuccess: () => {
      setActionMessage(null);
      toast.success("Data source archived");
      qc.invalidateQueries({ queryKey: ["data-sources-page", tenantId] });
      qc.invalidateQueries({ queryKey: ["data-source-detail", tenantId] });
      void invalidateActorSummaries();
    },
    onError: (error) => {
      setActionMessageContext("workspace");
      setActionMessage(dataSourceWriteFailure(error, "archive this data source", "refresh-sources", "Refresh data sources"));
    },
  });

  function submitCreate() {
    const name = form.name.trim();
    const fields = [];
    if (!name) fields.push({ field: "Name", issue: "required" as const });
    else if (name.length < 2) fields.push({ field: "Name", issue: "invalid_format" as const });
    else if (name.length > 80) fields.push({ field: "Name", issue: "too_long" as const, limit: 80 });
    if (form.description.length > 500) fields.push({ field: "Description", issue: "too_long" as const, limit: 500 });
    if (fields.length) {
      const formatted = formatUserMessage({ category: "input", action: "create this data source", fields });
      setActionMessageContext("create");
      setCreateFieldErrors(formatted.fieldErrors);
      setActionMessage(formatted);
      return;
    }
    setCreateFieldErrors({});
    setActionMessage(null);
    mCreate.mutate();
  }

  async function confirmDeleteSource(source: DataSourceRow) {
    const ok = await confirm({
      title: `Delete "${source.name}"?`,
      description: "All uploads tied to this data source will also be removed.",
      destructive: true,
      confirmText: "Delete",
    });
    if (ok) mDelete.mutate(source.id);
  }

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [pendingExcel, setPendingExcel] = useState<{
    dsId: string; file: File; sheets: string[]; selected: string;
  } | null>(null);

  async function handleFile(dsId: string, file: File, sheetName?: string) {
    setUploadingId(dsId);
    setMessageSourceId(dsId);
    let uploadStarted = false;
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        setActionMessageContext("workspace");
        setActionMessage(formatUserMessage({ category: "input", action: "upload this file", fields: [{ field: "File size in bytes", issue: "too_large", limit: MAX_UPLOAD_BYTES }] }));
        return;
      }
      const { getExcelSheetNames, parseAnyFile } = await import("@/lib/file-parse");
      if (!sheetName) {
        const sheets = await getExcelSheetNames(file);
        if (sheets.length > 1) {
          setPendingExcel({ dsId, file, sheets, selected: "" });
          return;
        }
      }
      const buf = await file.arrayBuffer();
      const parsed = await parseAnyFile(file, sheetName);
      const uploadName = sheetName ? `${file.name} [sheet: ${sheetName}]` : file.name;
      if (uploadName.length > 255) {
        const formatted = formatUserMessage({ category: "input", action: "upload this file", fields: [{ field: "Filename", issue: "too_long", limit: 255 }] });
        setActionMessageContext("workspace");
        setActionMessage(formatted);
        return;
      }
      if (parsed.columns.length === 0) {
        setActionMessageContext("workspace");
        setActionMessage(formatUserMessage({ category: "input", action: "upload this file", fields: [{ field: "File header row", issue: "required" }] }));
        return;
      }
      const sha = await sha256Hex(buf);
      uploadStarted = true;
      await upload({
        data: {
          data_source_id: dsId,
          tenant_id: tenantId,
          filename: uploadName,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          row_count: parsed.row_count,
          columns: parsed.columns,
          sample_rows: parsed.sample_rows,
          rows: parsed.rows.slice(0, 50000),
          content_sha256: sha,
        },
      });
      toast.success(
        `Ingested ${parsed.row_count.toLocaleString()} rows · ${parsed.columns.length} columns`,
      );
      setActionMessage(null);
      qc.invalidateQueries({ queryKey: ["data-sources-page", tenantId] });
      qc.invalidateQueries({ queryKey: ["data-source-detail", tenantId, dsId] });
      void invalidateActorSummaries();
      setPendingExcel(null);
    } catch (error) {
      if (uploadStarted) {
        setActionMessageContext("workspace");
        setActionMessage(dataSourceWriteFailure(error, "upload this file", "check-upload-history", "Refresh upload history"));
      } else {
        const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
        const code = typeof candidate.code === "string" ? candidate.code : undefined;
        const status = typeof candidate.status === "number" ? candidate.status : undefined;
        const mapped = mapKnownFailure(code, status);
        setActionMessageContext("workspace");
        setActionMessage(formatUserMessage({
          ...mapped,
          category: mapped.category === "input" ? "input" : "system",
          action: "read the selected file",
          fields: mapped.category === "input" ? [{ field: "File", issue: "invalid_format" }] : undefined,
          code,
          status,
          availableActions: [{ id: "choose-file", label: "Choose another file" }],
        }));
      }
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Database className="h-5 w-5" /> Data sources
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Manage file and connected sources, review detected schema, and inspect recorded uploads.
          </p>
        </div>
        {canWrite ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> New data source</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New data source</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="new-data-source-name">Name</Label>
                  <Input
                    id="new-data-source-name"
                    value={form.name}
                    aria-invalid={Boolean(createFieldErrors.Name)}
                    aria-describedby={createFieldErrors.Name ? "new-data-source-name-error" : "new-data-source-name-help"}
                    onChange={(e) => {
                      setForm({ ...form, name: e.target.value });
                      setCreateFieldErrors((current) => { const next = { ...current }; delete next.Name; return next; });
                      setActionMessage(null);
                    }}
                    placeholder="Bank statement — Demo Bank Nostro USD (Citi)"
                  />
                  <p id="new-data-source-name-help" className="mt-1 text-xs text-muted-foreground">Use 2–80 characters.</p>
                  {createFieldErrors.Name ? <p id="new-data-source-name-error" className="mt-1 text-xs text-destructive">{createFieldErrors.Name}</p> : null}
                </div>
                <div>
                  <Label htmlFor="new-data-source-description">Description</Label>
                  <Textarea
                    id="new-data-source-description"
                    value={form.description}
                    maxLength={500}
                    aria-invalid={Boolean(createFieldErrors.Description)}
                    aria-describedby={createFieldErrors.Description ? "new-data-source-description-error" : "new-data-source-description-help"}
                    onChange={(e) => {
                      setForm({ ...form, description: e.target.value });
                      setCreateFieldErrors((current) => { const next = { ...current }; delete next.Description; return next; });
                      setActionMessage(null);
                    }}
                    placeholder="Daily feed from your bank or source system."
                  />
                  <p id="new-data-source-description-help" className="mt-1 text-xs text-muted-foreground">Up to 500 characters.</p>
                  {createFieldErrors.Description ? <p id="new-data-source-description-error" className="mt-1 text-xs text-destructive">{createFieldErrors.Description}</p> : null}
                </div>
                <div>
                  <Label htmlFor="new-data-source-type">Source type</Label>
                  <Select
                    value={form.source_type}
                    onValueChange={(v) => setForm({ ...form, source_type: v as SourceType })}
                  >
                    <SelectTrigger id="new-data-source-type" aria-label="Source type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TYPE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={mCreate.isPending} onClick={submitCreate}>
                  {mCreate.isPending ? "Creating…" : "Create data source"}
                </Button>
              </DialogFooter>
              {open && actionMessageContext === "create" ? actionMessageView : null}
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {q.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span>
            {q.data
              ? "The source list could not be refreshed. The table shows the last loaded results."
              : "The source list is temporarily unavailable. No source count or empty state is shown until it can be loaded."}
          </span>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Try again</Button>
        </div>
      ) : null}

      {!open && actionMessageContext === "workspace" ? actionMessageView : null}

      <div className="relative grid min-w-0 gap-4">
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">File uploads and sources</CardTitle>
            <CardDescription>Search, filter, and sort the source records available in this workspace.</CardDescription>
            <div className="grid gap-3 pt-2 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_10rem_10rem_11rem]">
              <div className="relative">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label="Search data sources by name or description"
                  placeholder="Search by name or description"
                  className="pl-9"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                />
              </div>
              <Select value={sourceType} onValueChange={(value) => { setSourceType(value as SourceType | "all"); setPage(1); }}>
                <SelectTrigger aria-label="Filter by source type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {Object.entries(TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(value) => { setStatus(value as typeof status); setPage(1); }}>
                <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(value) => { setSort(value as DataSourceListSort); setPage(1); }}>
                <SelectTrigger aria-label="Sort data sources"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Recently updated</SelectItem>
                  <SelectItem value="oldest">Oldest updated</SelectItem>
                  <SelectItem value="name_asc">Name A–Z</SelectItem>
                  <SelectItem value="name_desc">Name Z–A</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <details className="mt-2 rounded-md border px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">Additional filters (unavailable)</summary>
              <p className="my-2 text-muted-foreground">Business unit and user group filters need authorized server-side list support. They remain unavailable so the current page is never mistaken for the full collection.</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Input disabled aria-label="Filter by business unit unavailable" placeholder="Business unit filter unavailable" />
                <Input disabled aria-label="Filter by user group unavailable" placeholder="User group filter unavailable" />
                <Input disabled aria-label="Filter by last updated by unavailable" placeholder="Editor filter unavailable" />
              </div>
            </details>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div><Label htmlFor="data-source-updated-from">Updated from (UTC)</Label><Input id="data-source-updated-from" type="date" aria-label="Updated from date (UTC)" value={updatedFrom} onChange={(event) => { setUpdatedFrom(event.target.value); setPage(1); }} /><p className="mt-1 text-[11px] text-muted-foreground">Includes this full UTC calendar day.</p></div>
              <div><Label htmlFor="data-source-updated-through">Updated through (UTC)</Label><Input id="data-source-updated-through" type="date" aria-label="Updated through date (UTC)" value={updatedThrough} onChange={(event) => { setUpdatedThrough(event.target.value); setPage(1); }} /><p className="mt-1 text-[11px] text-muted-foreground">Includes this full UTC calendar day.</p></div>
              <div className="xl:col-span-2"><Label htmlFor="data-source-public-id">Public ID search</Label><Input id="data-source-public-id" aria-label="Search by Public ID" disabled={accessQ.data?.available !== true} placeholder={accessQ.data?.available === true ? "Search generated Public ID" : "Public ID search unavailable"} value={publicIdSearch} onChange={(event) => { setPublicIdSearch(event.target.value); setPage(1); }} /><p className="mt-1 text-[11px] text-muted-foreground" role={accessQ.data?.available === true ? undefined : "status"}>{accessQ.data?.available === true ? "Searches generated IDs across the full source collection." : "Ask an administrator to apply the resource identity migrations, then refresh to enable Public ID search."}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Selected: {selectedRow?.name ?? "No source selected"}</span>
              <Button ref={detailsToolbarRef} type="button" size="sm" variant="outline" aria-controls="data-source-inspector" aria-expanded={detailsVisible} onMouseEnter={showDetailsPreview} onMouseLeave={scheduleDetailsPreviewClose} onFocus={showDetailsPreview} onBlur={scheduleDetailsPreviewClose} onKeyDown={(event) => { if (event.key === "Escape") { clearDetailsPreviewClose(); setDetailsPinned(false); setDetailsPreview(false); } }} onClick={() => { showDetailsPreview(); setDetailsPinned((pinned) => !pinned); setDetailsPreview(false); }}>{detailsPinned ? "Hide details" : "Show details"}</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {q.isPending ? (
              <div role="status" aria-live="polite" className="space-y-3 p-4">
                <span className="sr-only">Loading data sources…</span>
                {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 w-full" />)}
              </div>
            ) : q.isError && !q.data ? null : q.data?.rows.length === 0 ? (
              <div className="rounded-b-lg border-t border-dashed p-8 text-center">
                <FileSpreadsheet className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  {hasFilters ? "No sources match these filters" : "No data sources yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hasFilters
                    ? "Adjust or clear the search and filters to see other source records."
                    : "Create a data source, then upload a supported file to detect its schema."}
                </p>
                {hasFilters ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => {
                      setSearch("");
                      setSearchTerm("");
                      setPublicIdSearch("");
                      setUpdatedFrom("");
                      setUpdatedThrough("");
                      setSourceType("all");
                      setStatus("all");
                      setSort("recent");
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table aria-label="Data sources" className="min-w-[76rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Public ID</TableHead><TableHead className="min-w-64">Name</TableHead>
                        <TableHead>Format</TableHead><TableHead>Status</TableHead>
                        <TableHead className="text-right">Records</TableHead><TableHead className="text-right">Columns</TableHead>
                        <TableHead>Business units</TableHead><TableHead>User groups</TableHead><TableHead>Updated</TableHead>
                            <TableHead className="fvi-sticky-view-cell text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((source) => {
                        const isSelected = source.id === selectedRow?.id;
                        const columnCount = source.inferred_schema?.length;
                        return (
                          <TableRow
                            key={source.id}
                            aria-selected={isSelected}
                            data-testid="data-source-row"
                            className={isSelected ? "fvi-selected-row" : undefined}
                          >
                            <TableCell><ResourceIdentitySummary section="identity" summary={accessById.get(source.id)} available={accessQ.data?.available === true} /></TableCell>
                            <TableCell className="max-w-0">
                              <button
                                type="button"
                                aria-pressed={isSelected}
                                aria-label={`View details for ${source.name}`}
                                onClick={() => setSelectedSourceId(source.id)}
                                className="block max-w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <span className="block truncate font-medium">{source.name}</span>
                                {source.description ? (
                                  <span className="mt-1 block max-w-[24rem] truncate text-xs text-muted-foreground">
                                    {source.description}
                                  </span>
                                ) : null}
                              </button>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="uppercase text-[10px]">
                                {formatSourceType(source.source_type)}
                              </Badge>
                            </TableCell>
                            <TableCell><StatusBadge status={source.status} /></TableCell>
                            <TableCell className="text-right tabular-nums">
                              {Number.isFinite(source.row_count) ? source.row_count.toLocaleString() : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {columnCount === undefined ? "—" : columnCount.toLocaleString()}
                            </TableCell>
                            <TableCell><ResourceIdentitySummary section="business-units" summary={accessById.get(source.id)} available={accessQ.data?.available === true} /></TableCell>
                            <TableCell><ResourceIdentitySummary section="user-groups" summary={accessById.get(source.id)} available={accessQ.data?.available === true} /></TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              <span className="block">{formatTimestamp(source.updated_at)}</span>
                              <ResourceActorSummaryView mode="updated-line" summary={actorsById.get(source.id)} available={actorQ.data?.available === true} />
                            </TableCell>
                            <TableCell className="fvi-sticky-view-cell text-right">
                              <Button type="button" size="sm" variant="outline" className="fvi-row-view-action" aria-label={`View ${source.name}`} onClick={(event) => { viewTriggerRef.current = event.currentTarget; setSelectedSourceId(source.id); setViewSourceId(source.id); }}>
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {firstVisible}–{lastVisible} of {total} source{total === 1 ? "" : "s"}
                  </p>
                  {totalPages > 1 ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label="Previous page"
                        disabled={page <= 1 || q.isFetching}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="min-w-16 text-center text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label="Next page"
                        disabled={page >= totalPages || q.isFetching}
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {detailsVisible ? <aside id="data-source-inspector" aria-label="Selected data source details" onMouseEnter={showDetailsPreview} onMouseLeave={scheduleDetailsPreviewClose} onFocus={showDetailsPreview} onKeyDown={(event) => { if (event.key === "Escape") { clearDetailsPreviewClose(); setDetailsPinned(false); setDetailsPreview(false); } }} style={{ top: detailsPanelTop ?? undefined }} className="fixed inset-x-2 bottom-2 top-auto z-40 max-h-[70dvh] overflow-y-auto rounded-lg border bg-background p-2 shadow-xl md:inset-y-4 md:left-auto md:right-4 md:top-auto md:w-[26rem] md:max-h-[calc(100dvh-6rem)] md:p-0">
          <Button type="button" variant="ghost" size="sm" className="mb-2 md:hidden" onClick={() => { setDetailsPinned(false); setDetailsPreview(false); }}>Hide details</Button>
          {selectedRow ? (
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="break-words text-base">{selectedRow.name}</CardTitle>
                    {selectedRow.description ? (
                      <CardDescription className="mt-2">{selectedRow.description}</CardDescription>
                    ) : null}
                  </div>
                  <StatusBadge status={selectedRow.status} />
                </div>
                <ResourceActorSummaryView mode="detail" summary={actorsById.get(selectedRow.id)} available={actorQ.data?.available === true} />
                <div className="flex flex-wrap gap-2">
                  {canWrite && isFileSourceType(selectedRow.source_type) ? (
                    <>
                      <input
                        ref={(element) => { fileRefs.current[selectedRow.id] = element; }}
                        type="file"
                        aria-label={`Choose file for ${selectedRow.name}`}
                        accept=".csv,text/csv,application/json,.json,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            setPendingExcel(null);
                            void handleFile(selectedRow.id, file);
                          }
                          event.target.value = "";
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={uploadingId === selectedRow.id}
                        onClick={() => fileRefs.current[selectedRow.id]?.click()}
                      >
                        <Upload className="mr-2 h-3.5 w-3.5" />
                        {uploadingId === selectedRow.id ? "Ingesting…" : "Upload file"}
                      </Button>
                    </>
                  ) : null}
                  {canWrite && selectedRow.status !== "archived" ? (
                    <Button size="sm" variant="outline" disabled={mArchive.isPending} onClick={() => mArchive.mutate(selectedRow.id)}>
                      <Archive className="mr-2 h-3.5 w-3.5" /> Archive
                    </Button>
                  ) : null}
                  {canWrite ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" aria-label={`More actions for ${selectedRow.name}`}>
                          <MoreHorizontal className="mr-1.5 h-4 w-4" /> More actions
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => { void confirmDeleteSource(selectedRow); }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete data source
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                {!canWrite ? (
                  <p className="text-xs text-muted-foreground">
                    You can view source details. Contact a workspace administrator to upload, archive, or delete sources.
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <StatusBadge status={selectedRow.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {statusDescription(selectedRow.status, isFileSourceType(selectedRow.source_type))}
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Format</dt>
                    <dd className="mt-1">{TYPE_LABELS[selectedRow.source_type]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Records</dt>
                    <dd className="mt-1 tabular-nums">
                      {Number.isFinite(selectedRow.row_count) ? selectedRow.row_count.toLocaleString() : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Columns</dt>
                    <dd className="mt-1 tabular-nums">
                      {selectedRow.inferred_schema === null ? "—" : selectedRow.inferred_schema.length.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last updated</dt>
                    <dd className="mt-1 text-xs">{formatTimestamp(selectedRow.updated_at)}</dd>
                  </div>
                </dl>

                {pendingExcel?.dsId === selectedRow.id ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="space-y-1">
                      <Label htmlFor={`excel-sheet-${selectedRow.id}`}>Select a sheet from {pendingExcel.file.name}</Label>
                      <select
                        id={`excel-sheet-${selectedRow.id}`}
                        className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={pendingExcel.selected}
                        onChange={(event) => setPendingExcel({ ...pendingExcel, selected: event.target.value })}
                      >
                        <option value="">Choose a sheet…</option>
                        {pendingExcel.sheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={!pendingExcel.selected || uploadingId === selectedRow.id}
                        onClick={() => void handleFile(selectedRow.id, pendingExcel.file, pendingExcel.selected)}>
                        Import selected sheet
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingExcel(null)}>Cancel</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Only the selected sheet will be imported. Other sheets remain in the workbook.</p>
                  </div>
                ) : null}

                <section aria-labelledby="data-source-uploads-heading" className="border-t pt-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 id="data-source-uploads-heading" className="text-sm font-semibold">Recent uploaded files</h3>
                    {detailQ.isError ? (
                      <Button size="sm" variant="ghost" onClick={() => void detailQ.refetch()}>Try again</Button>
                    ) : null}
                  </div>
                  {detailQ.isError ? (
                    <p role="alert" className="mb-3 text-xs text-destructive">
                      {detailQ.data ? "Upload history could not be refreshed; showing the last loaded records." : "Upload history is temporarily unavailable."}
                    </p>
                  ) : null}
                  {detailQ.isPending ? (
                    <div role="status" aria-live="polite" className="space-y-2">
                      <span className="sr-only">Loading upload history…</span>
                      <Skeleton className="h-14 w-full" />
                    </div>
                  ) : detailQ.data ? detailQ.data.uploads.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">Most recent 50 upload records</p>
                      {detailQ.data.uploads.map((file) => (
                        <div key={file.id} className="rounded-md border p-3">
                          <p className="break-all text-sm font-medium">{file.filename}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {file.row_count.toLocaleString()} rows · {file.column_count === null ? "—" : file.column_count.toLocaleString()} columns
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatFileSize(file.size_bytes)} · {formatTimestamp(file.created_at)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No uploads have been recorded for this source.</p>
                  ) : null}
                </section>

                <section aria-labelledby="data-source-schema-heading" className="border-t pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 id="data-source-schema-heading" className="text-sm font-semibold">Schema</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedRow.inferred_schema === null
                          ? "Schema has not been detected."
                          : `${selectedRow.inferred_schema.length.toLocaleString()} detected columns`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-expanded={schemaOpen}
                      aria-controls="data-source-schema-table"
                      onClick={() => setSchemaOpen((current) => !current)}
                    >
                      {schemaOpen ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                      {schemaOpen ? "Hide" : "View"}
                    </Button>
                  </div>
                  {schemaOpen ? (
                    selectedRow.inferred_schema && selectedRow.inferred_schema.length > 0 ? (
                      <div id="data-source-schema-table" className="mt-3 max-h-72 overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                    <TableRow><TableHead>Column</TableHead><TableHead>Type</TableHead><TableHead>Nullable</TableHead></TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedRow.inferred_schema.map((column, index) => (
                              <TableRow key={`${column.name}-${index}`}>
                                <TableCell className="break-all font-mono text-xs">{column.name}</TableCell>
                                <TableCell><Badge variant="outline" className="text-[10px]">{column.inferred_type}</Badge></TableCell>
                                <TableCell className="text-xs">
                                  {column.nullable === null ? "—" : column.nullable ? "Yes" : "No"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p id="data-source-schema-table" className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                        No schema columns are available for this source yet.
                      </p>
                    )
                  ) : null}
                </section>
              </CardContent>
            </Card>
          ) : (
            <Card className="min-h-48">
              <CardContent className="flex h-full min-h-48 flex-col items-center justify-center p-6 text-center">
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Select a data source</p>
                <p className="mt-1 text-xs text-muted-foreground">Source status, upload history, and detected schema will appear here.</p>
              </CardContent>
            </Card>
          )}
        </aside> : null}
      </div>
      <Dialog open={Boolean(viewSourceId)} onOpenChange={(open) => { if (!open) setViewSourceId(null); }}>
        <DialogContent className="h-[min(92dvh,64rem)] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[min(96vw,88rem)] overflow-hidden gap-0 p-0" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); if (pendingFilePickerRef.current) { const id = pendingFilePickerRef.current; pendingFilePickerRef.current = null; viewTransitionRef.current = false; viewTriggerRef.current?.focus(); window.setTimeout(() => fileRefs.current[id]?.click(), 0); return; } if (viewTransitionRef.current) { viewTransitionRef.current = false; return; } viewTriggerRef.current?.focus(); }}>
          {viewSource ? <FviDetailDialogLayout
            railEyebrow="INGESTION"
            railTitle="DATA SOURCE"
            railStatus={<StatusBadge status={viewSource.status} />}
            railFields={[
              { label: "Format", value: TYPE_LABELS[viewSource.source_type] },
              { label: "Records", value: Number.isFinite(viewSource.row_count) ? viewSource.row_count.toLocaleString() : "Not available" },
              { label: "Last updated", value: formatTimestamp(viewSource.updated_at) },
            ]}
            title={viewSource.name}
            description={viewSource.description || "Source configuration, detected schema, and recorded uploads."}
            content={<div className="space-y-6">
            <section aria-label="Identity and access" className="space-y-3"><h3 className="text-base font-semibold">Identity and access</h3><ResourceIdentitySummary mode="detail" summary={accessById.get(viewSource.id)} available={accessQ.data?.available === true} /><ResourceActorSummaryView mode="detail" summary={actorsById.get(viewSource.id)} available={actorQ.data?.available === true} /></section>
            <section aria-label="Schema" className="space-y-2"><h3 className="text-base font-semibold">Schema</h3>{viewSource.inferred_schema?.length ? <div className="max-h-56 overflow-auto rounded border"><Table><TableHeader><TableRow><TableHead>Column</TableHead><TableHead>Type</TableHead><TableHead>Nullable</TableHead></TableRow></TableHeader><TableBody>{viewSource.inferred_schema.map((column, index) => <TableRow key={`${column.name}-${index}`}><TableCell className="break-all font-mono text-xs">{column.name}</TableCell><TableCell>{column.inferred_type}</TableCell><TableCell>{column.nullable === null ? "—" : column.nullable ? "Yes" : "No"}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-sm text-muted-foreground">No schema columns are available for this source yet.</p>}</section>
            <section aria-label="Recent upload history" className="space-y-2"><h3 className="text-base font-semibold">Recent uploaded files</h3>{detailQ.data?.uploads?.length ? <div className="space-y-2">{detailQ.data.uploads.map((file) => <div key={file.id} className="rounded border p-3 text-sm"><p className="break-all font-medium">{file.filename}</p><p className="text-xs text-muted-foreground">{file.row_count.toLocaleString()} rows · {file.column_count === null ? "—" : file.column_count.toLocaleString()} columns · {formatFileSize(file.size_bytes)} · {formatTimestamp(file.created_at)}</p></div>)}</div> : <p className="text-sm text-muted-foreground">{detailQ.isPending ? "Loading upload history…" : detailQ.isError ? "Upload history is temporarily unavailable." : "No uploads have been recorded for this source."}</p>}</section>
            {!canWrite ? <p className="text-xs text-muted-foreground">You can view source details. Contact a workspace administrator to upload, archive, or delete sources.</p> : null}
            </div>}
            actions={<>{canWrite && isFileSourceType(viewSource.source_type) ? <Button variant="outline" disabled={uploadingId === viewSource.id} onClick={() => { viewTransitionRef.current = true; pendingFilePickerRef.current = viewSource.id; setViewSourceId(null); }}><Upload className="mr-2 h-4 w-4" />{uploadingId === viewSource.id ? "Ingesting…" : "Upload file"}</Button> : null}{canWrite && viewSource.status !== "archived" ? <Button variant="outline" disabled={mArchive.isPending} onClick={() => mArchive.mutate(viewSource.id)}><Archive className="mr-2 h-4 w-4" />Archive</Button> : null}{canWrite ? <Button variant="destructive" disabled={mDelete.isPending} onClick={() => { viewTransitionRef.current = true; setViewSourceId(null); void confirmDeleteSource(viewSource).finally(() => viewTriggerRef.current?.focus()); }}><Trash2 className="mr-2 h-4 w-4" />Delete data source</Button> : null}</>}
          /> : <p className="p-6 text-sm text-muted-foreground">This source is no longer on the current page. Close this view and locate it again.</p>}
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
    </div>
  );
}

function formatSourceType(sourceType: SourceType) {
  return sourceType === "xlsx" ? "Excel" : sourceType.toUpperCase();
}

function isFileSourceType(sourceType: SourceType) {
  return sourceType === "csv" || sourceType === "xlsx" || sourceType === "json";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  const formatted = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "Size unavailable";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeBytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function statusDescription(status: DataSourceRow["status"], canUploadFile: boolean) {
  switch (status) {
    case "ready":
      return "This source is ready for reconciliation processing.";
    case "draft":
      return canUploadFile
        ? "Upload a supported file to detect its schema and prepare it for processing."
        : "This source is still in draft status.";
    case "error":
      return "The source is marked with an error. Technical details are not available here; contact a workspace administrator for help.";
    case "archived":
      return "This source is archived and is not available for new processing.";
  }
}

function StatusBadge({ status }: { status: DataSourceRow["status"] }) {
  if (status === "ready")
    return (
      <Badge className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </Badge>
    );
  if (status === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" /> Error
      </Badge>
    );
  if (status === "archived") return <Badge variant="secondary">Archived</Badge>;
  if (status === "draft") return <Badge variant="outline">Draft</Badge>;
  return <Badge variant="outline">Status unavailable</Badge>;
}
