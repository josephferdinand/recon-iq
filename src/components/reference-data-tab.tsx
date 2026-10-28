import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Info,
  Plus,
  Upload,
  ArrowRight,
  Coins,
  Landmark,
  CalendarDays,
  BookOpen,
  Sparkles,
  Table as TableIcon,
  GitBranch,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from "lucide-react";
import {
  listReferenceTablesPage,
  upsertReferenceTable,
  listReferenceRows,
  listReferenceVersions,
  stageReferenceVersion,
  submitReferenceVersion,
  decideReferenceVersion,
  requestReferenceRollback,
} from "@/lib/reference-data.functions";
import { getResourceAccessSummaries } from "@/lib/resource-access-summaries.functions";
import { ResourceIdentitySummary } from "@/components/resource-identity-summary";
import { getResourceActorSummaries } from "@/lib/resource-actor-summaries.functions";
import { ResourceActorSummary } from "@/components/resource-actor-summary";
import { FviDetailDialogLayout } from "@/components/fvi-detail-dialog-layout";

type Template = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  keys: string;
  values: string;
  sampleCsv: string;
  icon: typeof Coins;
  accent: "primary" | "secondary" | "accent";
};

const TEMPLATES: Template[] = [
  {
    id: "fx_rates",
    name: "fx_spot_rates",
    displayName: "Foreign exchange spot rates",
    description: "Map currency pairs to EOD mid-market rates.",
    keys: "ccy_pair",
    values: "mid_rate, as_of_date",
    sampleCsv:
      "ccy_pair,mid_rate,as_of_date\nGBP/USD,1.2642,2026-07-04\nEUR/USD,1.0851,2026-07-04\nUSD/JPY,157.32,2026-07-04",
    icon: Coins,
    accent: "primary",
  },
  {
    id: "account_aliases",
    name: "falcon_account_aliases",
    displayName: "Account aliases",
    description: "Normalize varied source accounts to master GL IDs.",
    keys: "external_id",
    values: "internal_acc_num, business_unit",
    sampleCsv:
      "external_id,internal_acc_num,business_unit\nDEMO-BANK-USD-CITI,1001000,Cash Ops EMEA\nDEMO-BANK-GBP-HSBC,1001001,Cash Ops EMEA\nDEMO-BANK-EUR-BNP,1001002,Cash Ops EMEA",
    icon: Landmark,
    accent: "accent",
  },
  {
    id: "holiday_calendar",
    name: "settlement_holidays",
    displayName: "Settlement holidays",
    description: "Define non-business days for value-date logic.",
    keys: "calendar, holiday_date",
    values: "holiday_name",
    sampleCsv:
      "calendar,holiday_date,holiday_name\nUS,2026-07-03,Independence Day (obs)\nUS,2026-12-25,Christmas Day\nUK,2026-12-25,Christmas Day",
    icon: CalendarDays,
    accent: "secondary",
  },
];

const SEEDED_EXAMPLES: Array<{
  name: string;
  description: string;
  keys: string[];
  values: string[];
  rows: Array<Record<string, string>>;
}> = [
  {
    name: "falcon_nostro_fx_eod",
    description: "Daily closing rates for Demo Bank Nostro reconciliations.",
    keys: ["ccy_pair"],
    values: ["mid_rate"],
    rows: [
      { ccy_pair: "GBP/USD", mid_rate: "1.2642" },
      { ccy_pair: "EUR/USD", mid_rate: "1.0851" },
    ],
  },
  {
    name: "legal_entity_aliases",
    description: "Normalizing SWIFT BIC codes to internal entity names.",
    keys: ["swift_bic"],
    values: ["le_name"],
    rows: [
      { swift_bic: "CITIUS33", le_name: "Citibank NA — New York" },
      { swift_bic: "HSBCGB2L", le_name: "HSBC Bank plc — London" },
    ],
  },
];

function accentBg(a: Template["accent"]) {
  if (a === "primary") return "bg-primary/10 text-primary";
  if (a === "accent") return "bg-accent/40 text-accent-foreground";
  return "bg-secondary text-secondary-foreground";
}

function failureMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ReferenceDataTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listReferenceTablesPage);
  const upsert = useServerFn(upsertReferenceTable);
  const rowsFn = useServerFn(listReferenceRows);
  const versionsFn = useServerFn(listReferenceVersions);
  const stageVersion = useServerFn(stageReferenceVersion);
  const submitVersion = useServerFn(submitReferenceVersion);
  const decideVersion = useServerFn(decideReferenceVersion);
  const rollbackVersion = useServerFn(requestReferenceRollback);
  const getAccessSummaries = useServerFn(getResourceAccessSummaries);
  const getActorSummaries = useServerFn(getResourceActorSummaries);

  const emptyDraft = { name: "", description: "", keys: "", values: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [createOpen, setCreateOpen] = useState(false);
  const [seedCsv, setSeedCsv] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [publicIdSearch, setPublicIdSearch] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo, setUpdatedTo] = useState("");
  const [publicIdReadyFor, setPublicIdReadyFor] = useState<string | null>(null);
  const [tableType, setTableType] = useState("all");
  const [tableStatus, setTableStatus] = useState("all");
  const [sort, setSort] = useState("name_asc");
  const [page, setPage] = useState(0);
  const [csv, setCsv] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [changeNote, setChangeNote] = useState("Scheduled reference data update");
  const [decisionReason, setDecisionReason] = useState("");
  const [rollbackReason, setRollbackReason] = useState("Restore a previously approved reference version");
  const [rollbackEffectiveFrom, setRollbackEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const tQ = useQuery({
    queryKey: ["ref-tables", tenantId, search, publicIdSearch, updatedFrom, updatedTo, tableType, tableStatus, sort, page],
    queryFn: () => list({ data: {
      tenant_id: tenantId, page, page_size: 25, search,
      public_id_search: publicIdReadyFor === tenantId ? publicIdSearch : "",
      updated_from: updatedFrom, updated_to: updatedTo,
      type: tableType as "all" | "enrichment" | "validation",
      status: tableStatus as "all" | "active" | "inactive",
      sort: sort as "name_asc" | "name_desc" | "updated_desc" | "updated_asc",
    } }),
    staleTime: 30_000,
    enabled: !updatedFrom || !updatedTo || updatedFrom <= updatedTo,
  });

  const rQ = useQuery({
    queryKey: ["ref-rows", selected],
    queryFn: () =>
      rowsFn({ data: { tenant_id: tenantId, table_id: selected!, limit: 20 } }),
    enabled: !!selected,
    staleTime: 30_000,
  });

  const vQ = useQuery({
    queryKey: ["ref-versions", selected],
    queryFn: () => versionsFn({ data: { tenant_id: tenantId, table_id: selected!, limit: 25 } }),
    enabled: !!selected,
    staleTime: 10_000,
  });

  const tables = tQ.data?.rows ?? [];
  const accessQ = useQuery({
    queryKey: ["resource-access-summary", tenantId, "reference_table", tables.map((row: any) => row.id)],
    queryFn: () => getAccessSummaries({ data: { resource_type: "reference_table", resource_ids: tables.map((row: any) => row.id) } }),
    enabled: tables.length > 0,
  });
  useEffect(() => { if (accessQ.data?.available === true) setPublicIdReadyFor(tenantId); }, [accessQ.data?.available, tenantId]);
  const actorsQ = useQuery({
    queryKey: ["resource-actor-summary", tenantId, "reference_table", tables.map((row: any) => row.id)],
    queryFn: () => getActorSummaries({ data: { resource_type: "reference_table", resource_ids: tables.map((row: any) => row.id).slice(0, 100) } }),
    enabled: tables.length > 0,
  });
  const accessById = new Map((accessQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const actorsById = new Map((actorsQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const refreshActorSummaries = () => qc.invalidateQueries({ queryKey: ["resource-actor-summary", tenantId] });
  const [viewId, setViewId] = useState<string | null>(null);
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const createTableButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewedTable = tables.find((table: any) => table.id === viewId) ?? null;
  const totalTables = tQ.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalTables / 25));
  const hasTables = tables.length > 0;
  const hasListFilters = Boolean(search || publicIdSearch || updatedFrom || updatedTo || tableType !== "all" || tableStatus !== "all");
  const canSearchPublicId = publicIdReadyFor === tenantId || accessQ.data?.available === true;
  const updatedDateRangeError = Boolean(updatedFrom && updatedTo && updatedFrom > updatedTo);

  const previewTable = useMemo(() => {
    if (!selected) return tables[0] ?? null;
    return tables.find((t: any) => t.id === selected) ?? tables[0] ?? null;
  }, [selected, tables]);

  const previewSample = useMemo(() => {
    if (previewTable) {
      return {
        keys: (previewTable.key_columns ?? []) as string[],
        values: (previewTable.value_columns ?? []) as string[],
        rows: (rQ.data ?? []).slice(0, 3).map((r: any) => r.row_data ?? {}),
      };
    }
    return {
      keys: SEEDED_EXAMPLES[0].keys,
      values: SEEDED_EXAMPLES[0].values,
      rows: SEEDED_EXAMPLES[0].rows,
    };
  }, [previewTable, rQ.data]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => setPage(0), [search, tableType, tableStatus, sort]);
  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);
  useEffect(() => {
    if (selected && !tables.some((table: any) => table.id === selected)) setSelected(tables[0]?.id ?? null);
    else if (!selected && tables.length) setSelected(tables[0].id);
  }, [selected, tables]);

  const mUpsert = useMutation({
    mutationFn: (payload: {
      name: string;
      description: string;
      keys: string;
      values: string;
    }) =>
      upsert({
        data: {
          tenant_id: tenantId,
          name: payload.name,
          description: payload.description || null,
          key_columns: payload.keys
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          value_columns: payload.values
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          is_active: true,
        },
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["ref-tables", tenantId] });
      refreshActorSummaries();
      toast.success(seedCsv ? "Reference table created from template; sample rows remain examples until you stage a version." : "Table created");
      setDraft(emptyDraft);
      setSeedCsv(null);
      setCreateOpen(false);
      if (row?.id) setSelected(row.id);
    },
    onError: (error) => toast.error(failureMessage(error, "Failed to create table")),
  });

  const mLoad = useMutation({
    mutationFn: () => {
      const parsed = parseCsv(csv);
      if (!parsed.rows.length) throw new Error("No rows detected in CSV");
      return stageVersion({
        data: {
          tenant_id: tenantId,
          table_id: selected!,
          rows: parsed.rows,
          effective_from: effectiveFrom,
          effective_to: effectiveTo || null,
          change_note: changeNote,
        },
      });
    },
    onSuccess: (r) => {
      toast.success(`Draft version ${r.version_number} staged with ${r.row_count} rows`);
      setCsv("");
      setLoadOpen(false);
      qc.invalidateQueries({ queryKey: ["ref-versions", selected] });
      refreshActorSummaries();
    },
    onError: (error) => toast.error(failureMessage(error, "Failed to stage version")),
  });

  const refreshGovernance = () => {
    qc.invalidateQueries({ queryKey: ["ref-versions", selected] });
    qc.invalidateQueries({ queryKey: ["ref-tables", tenantId] });
    qc.invalidateQueries({ queryKey: ["ref-rows", selected] });
    refreshActorSummaries();
  };

  const mSubmit = useMutation({
    mutationFn: (versionId: string) => submitVersion({ data: { tenant_id: tenantId, version_id: versionId } }),
    onSuccess: () => { toast.success("Version submitted for independent approval"); refreshGovernance(); },
    onError: (error) => toast.error(failureMessage(error, "Failed to submit version")),
  });

  const mDecide = useMutation({
    mutationFn: ({ versionId, approve }: { versionId: string; approve: boolean }) => decideVersion({
      data: {
        tenant_id: tenantId,
        version_id: versionId,
        approve,
        reason: decisionReason || null,
      },
    }),
    onSuccess: (result) => {
      toast.success(result.status === "published" ? "Version published" : "Version rejected and retained");
      setDecisionReason("");
      refreshGovernance();
    },
    onError: (error) => toast.error(failureMessage(error, "Failed to decide version")),
  });

  const mRollback = useMutation({
    mutationFn: (sourceVersionId: string) => rollbackVersion({
      data: {
        tenant_id: tenantId,
        table_id: selected!,
        source_version_id: sourceVersionId,
        effective_from: rollbackEffectiveFrom,
        reason: rollbackReason,
      },
    }),
    onSuccess: (result) => {
      toast.success(`Rollback draft version ${result.version_number} created for review`);
      refreshGovernance();
    },
    onError: (error) => toast.error(failureMessage(error, "Failed to create rollback draft")),
  });

  const startFromTemplate = (t: Template) => {
    setDraft({
      name: t.name,
      description: t.description,
      keys: t.keys,
      values: t.values,
    });
    setSeedCsv(t.sampleCsv);
    setCreateOpen(true);
  };

  const startBlank = () => {
    setDraft(emptyDraft);
    setSeedCsv(null);
    setCreateOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header + How-it-works */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold tracking-tight">Reference data</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage lookup tables for the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              reference_lookup
            </code>{" "}
            matching rule. Use them to enrich data, map aliases, or validate
            values during reconciliation.
          </p>
        </div>
        <Card className="w-full max-w-sm border-primary/20 bg-primary/5">
          <CardContent className="flex gap-3 p-4">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="space-y-1 text-sm">
              <div className="font-medium text-foreground">How it works</div>
              <p className="text-muted-foreground">
                <strong className="text-foreground">Keys</strong> are what you
                match on (e.g. Currency).{" "}
                <strong className="text-foreground">Values</strong> are what
                gets returned (e.g. FX rate). Keys must be unique per table.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick-start templates */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quick-start templates
          </h3>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3 w-3" /> Governed tenant data
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => startFromTemplate(t)}
                className="group flex flex-col items-start rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-sm"
              >
                <div
                  className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${accentBg(t.accent)}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span className="font-medium">{t.displayName}</span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {t.description}
                </span>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded border bg-muted px-1.5 py-0.5 font-mono">
                    {t.keys}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="rounded border bg-muted px-1.5 py-0.5 font-mono">
                    {t.values.split(",")[0].trim()}
                    {t.values.includes(",") ? " …" : ""}
                  </span>
                </div>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  <Sparkles className="h-3 w-3" /> Use template
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main tables workspace */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/30 py-3">
          <div>
            <CardTitle className="text-base">Reference tables</CardTitle>
            <CardDescription className="text-xs">
              {totalTables.toLocaleString()} table{totalTables === 1 ? "" : "s"} in this
              tenant
            </CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button ref={createTableButtonRef} size="sm" onClick={startBlank}>
                <Plus className="mr-2 h-4 w-4" /> Create table
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {seedCsv ? "Create from template" : "Create reference table"}
                </DialogTitle>
                <DialogDescription>
                  Give the table a name, describe what it's for, then list the
                  key and value columns (comma-separated). Keys identify a row;
                  values are returned when matched.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input
                    placeholder="e.g. fx_spot_rates"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Description</Label>
                  <Input
                    placeholder="What is this table used for?"
                    value={draft.description}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, description: e.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">Key columns</Label>
                    <Input
                      placeholder="e.g. ccy_pair"
                      value={draft.keys}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, keys: e.target.value }))
                      }
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Comma-separated. Must be unique per row.
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs">Value columns</Label>
                    <Input
                      placeholder="e.g. mid_rate, as_of_date"
                      value={draft.values}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, values: e.target.value }))
                      }
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Returned when a key matches.
                    </p>
                  </div>
                </div>
                {seedCsv && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                    <div className="mb-1 flex items-center gap-1 font-medium text-primary">
                      <Sparkles className="h-3 w-3" /> Template schema selected
                    </div>
                    <p className="text-muted-foreground">
                      Example rows are shown only in the template preview. They are not stored in your tenant. Stage your own CSV to create a governed version.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={mUpsert.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => mUpsert.mutate(draft)}
                  disabled={
                    !draft.name.trim() ||
                    !draft.keys.trim() ||
                    mUpsert.isPending
                  }
                >
                  {mUpsert.isPending ? "Creating…" : "Create table"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent className="p-0">
          {tQ.isLoading && !updatedDateRangeError ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Loading tables…
            </div>
          ) : (
            <>
            <div className="grid gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative lg:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input aria-label="Search reference tables" className="pl-9" placeholder="Search tables…" value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(0); }} /></div>
              <Input type="search" aria-label="Search reference tables by Public ID" placeholder={canSearchPublicId ? "Search Public ID" : "Public ID search unavailable"} value={publicIdSearch} disabled={!canSearchPublicId} onChange={(event) => { setPublicIdSearch(event.target.value); setPage(0); }} />
              <Input type="date" aria-label="Updated from date (UTC)" value={updatedFrom} max={updatedTo || undefined} onChange={(event) => { setUpdatedFrom(event.target.value); setPage(0); }} />
              <Input type="date" aria-label="Updated through date (UTC)" value={updatedTo} min={updatedFrom || undefined} onChange={(event) => { setUpdatedTo(event.target.value); setPage(0); }} />
              <Select value={tableType} onValueChange={setTableType}><SelectTrigger aria-label="Filter by table type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem><SelectItem value="enrichment">Enrichment (keys and values)</SelectItem><SelectItem value="validation">Validation (keys only)</SelectItem></SelectContent></Select>
              <Select value={tableStatus} onValueChange={setTableStatus}><SelectTrigger aria-label="Filter by table status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select>
              <Select value={sort} onValueChange={setSort}><SelectTrigger aria-label="Sort reference tables"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name_asc">Name (A–Z)</SelectItem><SelectItem value="name_desc">Name (Z–A)</SelectItem><SelectItem value="updated_desc">Recently updated</SelectItem><SelectItem value="updated_asc">Least recently updated</SelectItem></SelectContent></Select>
            </div>
            {!canSearchPublicId ? <p role="status" className="px-4 pt-3 text-xs text-muted-foreground">Public ID search is disabled until authorized resource identity is available for a visible table. Business unit, user group, and actor filters are unavailable pending secure full-collection query support.</p> : <p className="px-4 pt-3 text-xs text-muted-foreground">Business unit, user group, and actor filters are unavailable pending secure full-collection query support.</p>}
            {updatedDateRangeError ? <p role="alert" className="p-8 text-center text-sm text-destructive">Updated-through date must be on or after updated-from date. Results are paused until the range is corrected.</p> : tQ.isError ? <div role="alert" className="p-8 text-center text-sm text-destructive">Reference tables are unavailable. Refresh to try again.</div> : hasTables ? <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/20 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3">Public ID</th>
                    <th className="px-6 py-3">Name & description</th>
                    <th className="px-6 py-3">Business units</th>
                    <th className="px-6 py-3">User groups</th>
                    <th className="px-6 py-3">Schema (key → value)</th>
                    <th className="px-6 py-3">Rows</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Updated</th>
                    <th className="fvi-sticky-view-cell px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tables.map((t: any) => {
                    const isSel = selected === t.id;
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setSelected(t.id)}
                        aria-selected={isSel}
                        className={`cursor-pointer transition-colors hover:bg-muted/40 ${isSel ? "fvi-selected-row" : ""}`}
                      >
                        <td className="px-6 py-4"><ResourceIdentitySummary section="identity" summary={accessById.get(t.id)} available={accessQ.data?.available === true} /></td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 font-medium">
                            <TableIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {t.name}
                          </div>
                          {t.description && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {t.description}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4"><ResourceIdentitySummary section="business-units" summary={accessById.get(t.id)} available={accessQ.data?.available === true} /></td>
                        <td className="px-6 py-4"><ResourceIdentitySummary section="user-groups" summary={accessById.get(t.id)} available={accessQ.data?.available === true} /></td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(t.key_columns ?? []).map((k: string) => (
                              <span
                                key={`k-${k}`}
                                className={`rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] ${isSel ? "text-[var(--fvi-selected-row-fg)]" : "text-primary"}`}
                              >
                                {k}
                              </span>
                            ))}
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            {(t.value_columns ?? []).map((v: string) => (
                              <span
                                key={`v-${v}`}
                                className={`rounded border border-accent/60 bg-accent/40 px-2 py-0.5 font-mono text-[11px] ${isSel ? "text-[var(--fvi-selected-row-fg)]" : "text-accent-foreground"}`}
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium">
                          {(t.row_count ?? 0).toLocaleString()} rows
                        </td>
                        <td className="px-6 py-4"><span className="rounded-full border px-2 py-0.5 text-xs">{t.is_active ? "Active" : "Inactive"}</span></td>
                        <td className="px-6 py-4 text-right text-xs text-muted-foreground">
                          <span className="block">{formatWhen(t.updated_at ?? t.created_at)}</span>
                          {actorsQ.isPending ? <span className="block" role="status">Loading editor…</span> : <ResourceActorSummary mode="updated-line" summary={actorsById.get(t.id)} available={actorsQ.data?.available === true} />}
                        </td>
                        <td className="fvi-sticky-view-cell px-6 py-4 text-right"><Button size="sm" variant="outline" className="fvi-row-view-action" onClick={(event) => { event.stopPropagation(); viewTriggerRef.current = event.currentTarget; setSelected(t.id); setViewId(t.id); }}>View detail</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div> : hasListFilters ? <div className="p-8 text-center text-sm text-muted-foreground">No tables match these search and filter settings.</div> : (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <TableIcon className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-base font-medium">
                  Start building your reference library
                </h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  This tenant has no saved tables yet. Start with a blank table or use a template for its schema; example values stay sample-only until you stage your own version.
                </p>
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={startBlank}>
                  <Plus className="mr-2 h-4 w-4" /> Blank table
                </Button>
                <Button
                  size="sm"
                  onClick={() => startFromTemplate(TEMPLATES[0])}
                >
                  <Sparkles className="mr-2 h-4 w-4" /> Use FX rates template
                </Button>
              </div>
            </div>
            )}
            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground"><span>{totalTables ? `${page * 25 + 1}–${Math.min((page + 1) * 25, totalTables)} of ${totalTables}` : "0 saved tables"}</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" aria-label="Previous reference tables page" disabled={page === 0 || tQ.isFetching} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button><span>Page {page + 1} of {pageCount}</span><Button size="sm" variant="outline" aria-label="Next reference tables page" disabled={page + 1 >= pageCount || tQ.isFetching} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
            </>
          )}
        </CardContent>

        {/* Sample row preview */}
        <div className="border-t bg-muted/20 p-6">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {previewTable ? `Table details & saved rows — ${previewTable.name}` : "Template example — not tenant data"}
            </h4>
            {selected && (
              <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Upload className="mr-2 h-3.5 w-3.5" /> Stage version (CSV)
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Stage a governed version</DialogTitle>
                    <DialogDescription>
                      Paste CSV with a header row that matches your key and
                      value columns. Published rows do not change until a
                      different tenant administrator approves this version.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label htmlFor="reference-effective-from" className="text-xs">Effective from</Label>
                      <Input
                        id="reference-effective-from"
                        type="date"
                        value={effectiveFrom}
                        onChange={(event) => setEffectiveFrom(event.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="reference-effective-to" className="text-xs">Effective to (optional)</Label>
                      <Input
                        id="reference-effective-to"
                        type="date"
                        min={effectiveFrom}
                        value={effectiveTo}
                        onChange={(event) => setEffectiveTo(event.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="reference-change-note" className="text-xs">Change note</Label>
                    <Input
                      id="reference-change-note"
                      value={changeNote}
                      maxLength={1000}
                      onChange={(event) => setChangeNote(event.target.value)}
                    />
                  </div>
                  <Textarea
                    rows={10}
                    className="font-mono text-xs"
                    placeholder="ccy_pair,mid_rate&#10;GBP/USD,1.2642&#10;EUR/USD,1.0851"
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                  />
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setLoadOpen(false)}
                      disabled={mLoad.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => mLoad.mutate()}
                      disabled={!csv.trim() || !effectiveFrom || changeNote.trim().length < 3 || mLoad.isPending}
                    >
                      {mLoad.isPending ? "Staging…" : "Stage version"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
          {previewTable ? <div className="mb-3 grid gap-3 rounded-md border bg-card p-3 text-xs sm:grid-cols-3"><div><p className="font-medium">Description</p><p className="mt-1 text-muted-foreground">{previewTable.description || "No description provided."}</p></div><div><p className="font-medium">Lookup schema</p><p className="mt-1 text-muted-foreground">Keys: {(previewTable.key_columns ?? []).join(", ") || "—"}</p><p className="text-muted-foreground">Values: {(previewTable.value_columns ?? []).join(", ") || "None"}</p></div><div><p className="font-medium">Table status</p><p className="mt-1 text-muted-foreground">{previewTable.is_active ? "Active" : "Inactive"} · {(previewTable.row_count ?? 0).toLocaleString()} saved rows</p><p className="text-muted-foreground">Updated {formatWhen(previewTable.updated_at ?? previewTable.created_at)}</p></div></div> : null}
          {tQ.isError ? <p role="alert" className="rounded-md border border-destructive/30 p-4 text-xs text-destructive">Reference data could not be loaded. Example rows are hidden until the table state is available.</p> : <div className="overflow-hidden rounded-md border bg-card">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  {previewSample.keys.map((k) => (
                    <th key={`ph-${k}`} className="px-3 py-2 text-left">
                      <span className="text-primary">key</span> · {k}
                    </th>
                  ))}
                  {previewSample.values.map((v) => (
                    <th key={`pv-${v}`} className="px-3 py-2 text-left">
                      <span className="text-accent-foreground">value</span> ·{" "}
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {previewTable && rQ.isLoading ? (
                  <tr><td colSpan={previewSample.keys.length + previewSample.values.length} className="px-3 py-4 text-center text-muted-foreground">Loading saved rows…</td></tr>
                ) : previewTable && rQ.isError ? (
                  <tr><td colSpan={previewSample.keys.length + previewSample.values.length} className="px-3 py-4 text-center text-destructive">Saved rows are unavailable. Sample rows are not substituted.</td></tr>
                ) : previewSample.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={
                        previewSample.keys.length + previewSample.values.length
                      }
                      className="px-3 py-4 text-center text-muted-foreground"
                    >
                      No rows yet — load a CSV to populate this table.
                    </td>
                  </tr>
                ) : (
                  previewSample.rows.map((r, i) => (
                    <tr key={`pr-${i}`}>
                      {previewSample.keys.map((k) => (
                        <td
                          key={`prk-${i}-${k}`}
                          className="px-3 py-2 font-mono"
                        >
                          {String((r as any)[k] ?? "")}
                        </td>
                      ))}
                      {previewSample.values.map((v) => (
                        <td
                          key={`prv-${i}-${v}`}
                          className="px-3 py-2 font-mono text-primary"
                        >
                          {String((r as any)[v] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>}
          {!previewTable && !tQ.isError && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              FX example rows are illustrative only and are not stored in this tenant.
            </p>
          )}
          {previewTable && rQ.isLoading ? <p className="mt-2 text-xs text-muted-foreground">Loading saved rows…</p> : null}
          {previewTable && rQ.isError ? <p role="alert" className="mt-2 text-xs text-destructive">Saved rows are unavailable; no sample values are shown in their place.</p> : null}
        </div>
      </Card>

      <Dialog open={!!viewId} onOpenChange={(open) => { if (!open) setViewId(null); }}>
        <DialogContent className="h-[min(92dvh,64rem)] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[min(96vw,88rem)] overflow-hidden gap-0 p-0" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); if (viewTriggerRef.current?.isConnected) viewTriggerRef.current.focus(); else createTableButtonRef.current?.focus(); }}>
          {viewedTable ? <FviDetailDialogLayout
            railEyebrow="REFERENCE DATA" railTitle="TABLE"
            railStatus={viewedTable.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}
            railFields={[
              { label: "Public ID", value: <ResourceIdentitySummary section="identity" summary={accessById.get(viewedTable.id)} available={accessQ.data?.available === true} /> },
              { label: "Created", value: new Date(viewedTable.created_at).toLocaleString() },
              { label: "Updated", value: new Date(viewedTable.updated_at).toLocaleString() },
              { label: "Saved rows", value: Number(viewedTable.row_count ?? 0).toLocaleString() },
            ]}
            title={viewedTable.name} description="Reference table definition, current access assignments, and saved-row preview."
            content={<div className="space-y-5"><ResourceIdentitySummary mode="detail" summary={accessById.get(viewedTable.id)} available={accessQ.data?.available === true} />{actorsQ.isPending ? <p role="status" className="text-xs text-muted-foreground">Loading actor attribution…</p> : <ResourceActorSummary mode="detail" summary={actorsById.get(viewedTable.id)} available={actorsQ.data?.available === true} />}<dl className="grid gap-4 border-t pt-5 text-sm sm:grid-cols-2"><div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Description</dt><dd className="mt-1">{viewedTable.description || "No description provided."}</dd></div><div><dt className="text-xs text-muted-foreground">Key columns</dt><dd className="mt-1 break-words">{(viewedTable.key_columns ?? []).join(", ") || "No keys"}</dd></div><div><dt className="text-xs text-muted-foreground">Value columns</dt><dd className="mt-1 break-words">{(viewedTable.value_columns ?? []).join(", ") || "No values"}</dd></div></dl></div>}
            actions={<Button variant="outline" onClick={() => { setSelected(viewedTable.id); setViewId(null); }}>View saved rows</Button>}
          /> : <FviDetailDialogLayout railEyebrow="REFERENCE DATA" railTitle="TABLE" railStatus={<Badge variant="outline">Unavailable</Badge>} railFields={[]} title="Reference table unavailable" description="This table is no longer on the current page." content={<p className="text-sm text-muted-foreground">Close this view and locate the table again.</p>} actions={null} />}
        </DialogContent>
      </Dialog>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4 text-primary" /> Version governance
            </CardTitle>
            <CardDescription>
              Immutable snapshots use four-eyes publication. The maker cannot approve or reject their own submission.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {vQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading version history…</p>
            ) : (vQ.data ?? []).length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No governed version exists yet. Stage a CSV version above; existing legacy rows remain published until approval.
              </p>
            ) : (
              <div className="space-y-3">
                {(vQ.data ?? []).map((version) => (
                  <div
                    key={version.id}
                    data-testid={`reference-version-${version.version_number}`}
                    data-status={version.status}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Version {version.version_number}</span>
                          <span className="rounded-full border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            {String(version.status).replace("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {version.row_count} rows · effective {version.effective_from}
                          {version.effective_to ? ` to ${version.effective_to}` : " onward"}
                        </p>
                        <p className="mt-1 text-sm">{version.change_note}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                          SHA-256 {version.content_sha256 ?? "pending"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {version.status === "draft" && (
                          <Button size="sm" onClick={() => mSubmit.mutate(version.id)} disabled={mSubmit.isPending}>
                            Submit for approval
                          </Button>
                        )}
                        {version.status === "pending_approval" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => mDecide.mutate({ versionId: version.id, approve: true })}
                              disabled={mDecide.isPending}
                            >
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => mDecide.mutate({ versionId: version.id, approve: false })}
                              disabled={decisionReason.trim().length < 3 || mDecide.isPending}
                            >
                              <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
                            </Button>
                          </>
                        )}
                        {(version.status === "published" || version.status === "superseded") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => mRollback.mutate(version.id)}
                            disabled={rollbackReason.trim().length < 3 || !rollbackEffectiveFrom || mRollback.isPending}
                          >
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Create rollback draft
                          </Button>
                        )}
                      </div>
                    </div>
                    {version.status === "pending_approval" && (
                      <div className="mt-3">
                        <Label htmlFor={`reference-decision-${version.id}`} className="text-xs">Decision reason</Label>
                        <Input
                          id={`reference-decision-${version.id}`}
                          value={decisionReason}
                          maxLength={1000}
                          placeholder="Required for rejection; retained in audit evidence"
                          onChange={(event) => setDecisionReason(event.target.value)}
                        />
                      </div>
                    )}
                    {(version.status === "published" || version.status === "superseded") && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <Label htmlFor={`reference-rollback-date-${version.id}`} className="text-xs">Rollback effective from</Label>
                          <Input
                            id={`reference-rollback-date-${version.id}`}
                            type="date"
                            value={rollbackEffectiveFrom}
                            onChange={(event) => setRollbackEffectiveFrom(event.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`reference-rollback-reason-${version.id}`} className="text-xs">Rollback reason</Label>
                          <Input
                            id={`reference-rollback-reason-${version.id}`}
                            value={rollbackReason}
                            maxLength={1000}
                            onChange={(event) => setRollbackReason(event.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Best practices */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Info className="h-4 w-4 text-primary" /> Keys vs values
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <p className="mb-2">
              <strong className="text-foreground">Keys</strong> are the columns
              from your source data that identify which row to look up. Use
              multiple columns for composite keys (e.g.{" "}
              <code className="rounded bg-muted px-1">calendar</code> +{" "}
              <code className="rounded bg-muted px-1">holiday_date</code>).
            </p>
            <p>
              <strong className="text-foreground">Values</strong> are what
              gets returned when a match is found — enriched data you can use
              in subsequent matching rules or reports.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-primary" /> Best practices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
              <li>Use <code className="rounded bg-muted px-1">snake_case</code> for table and column names so rules resolve reliably.</li>
              <li>Ensure keys are unique — duplicate keys make lookups ambiguous.</li>
              <li>Keep large datasets fresh via scheduled CSV uploads or the reference-data API.</li>
              <li>Version significant changes — every load is audit-logged.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function parseCsv(input: string): { header: string[]; rows: Record<string, string>[] } {
  const lines = input.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((ln) => {
    const cells = ln.split(",");
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = (cells[i] ?? "").trim()));
    return o;
  });
  return { header, rows };
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
