import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatReconRunId } from "@/lib/recon-run-id";
import {
  getReconRunDetail,
  listReconDefinitionRuns,
  type ReconRunResultExceptionItem,
} from "@/lib/recon-run-detail.functions";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Selection = { definitionId: string; runId?: string } | null;
type SideMembers = Record<string, Array<Record<string, unknown>>>;
type RecordStatus =
  | "match"
  | "partial"
  | "missing"
  | "duplicate"
  | "invalid_key"
  | "other"
  | "unavailable";
type StatusFilter = RecordStatus | "all";

const STATUS_LABELS: Record<RecordStatus, string> = {
  match: "Match",
  partial: "Partial",
  missing: "Missing",
  duplicate: "Duplicate",
  invalid_key: "Invalid key",
  other: "Other exception",
  unavailable: "Status unavailable",
};

function groupMembers(value: unknown): SideMembers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([side, rows]) => [
      side,
      Array.isArray(rows)
        ? rows.filter(
            (row): row is Record<string, unknown> =>
              !!row && typeof row === "object" && !Array.isArray(row),
          )
        : [],
    ]),
  );
}

function statusBucket(value: unknown): RecordStatus {
  return typeof value === "string" && Object.hasOwn(STATUS_LABELS, value)
    ? (value as RecordStatus)
    : "unavailable";
}

function cellValue(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}

function fieldCue(values: unknown[], sideCount: number): string {
  if (sideCount < 2) return "Single side";
  if (values.some((value) => value === null || value === undefined || value === ""))
    return "Missing value";
  return new Set(values.map(cellValue)).size === 1 ? "Same value" : "Different values";
}

function displayCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "N/A";
}

function timestampLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString(undefined, { timeZone: "UTC" });
}

function Records({ value }: { value: unknown }) {
  const rows = Array.isArray(value)
    ? value
    : value && (typeof value !== "object" || Object.keys(value).length)
      ? [value]
      : [];
  if (!rows.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="rounded border p-2 text-xs break-words">
          {row && typeof row === "object"
            ? Object.entries(row).map(([key, field]) => (
                <div key={key}>
                  <span className="font-medium">{key}:</span>{" "}
                  {field !== null && typeof field === "object"
                    ? JSON.stringify(field)
                    : String(field ?? "—")}
                </div>
              ))
            : String(row)}
        </div>
      ))}
    </div>
  );
}

function exceptionPayloadDetails(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const payload = value as Record<string, unknown>;
  return payload.row ?? payload.sides ?? payload;
}

export function ReconRunDetailWorkbench({
  tenantId,
  selection,
  onClose,
}: {
  tenantId: string;
  selection: Selection;
  onClose: () => void;
}) {
  const [days, setDays] = useState<1 | 7 | 14 | 30 | 90>(7);
  const [historyPage, setHistoryPage] = useState(0);
  const [detailPage, setDetailPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null);
  const [caseCopyMessage, setCaseCopyMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"results" | "overview" | "history">(() =>
    selection?.runId ? "results" : "overview",
  );
  const definitionId = selection?.definitionId;
  const runId = selectedRunId ?? selection?.runId;
  const historyFn = useServerFn(listReconDefinitionRuns);
  const detailFn = useServerFn(getReconRunDetail);
  const history = useQuery({
    queryKey: ["recon-definition-runs", tenantId, definitionId, days, historyPage],
    enabled: !!definitionId,
    queryFn: () =>
      historyFn({
        data: { tenant_id: tenantId, definition_id: definitionId!, days, page: historyPage },
      }),
  });
  const overview = useQuery({
    queryKey: ["recon-definition-runs", tenantId, definitionId, days, 0],
    enabled: !!definitionId,
    queryFn: () =>
      historyFn({ data: { tenant_id: tenantId, definition_id: definitionId!, days, page: 0 } }),
  });
  const detail = useQuery({
    queryKey: ["recon-run-detail", tenantId, runId, detailPage, statusFilter],
    enabled: !!runId,
    queryFn: () =>
      detailFn({
        data: { tenant_id: tenantId, run_id: runId!, page: detailPage, status: statusFilter },
      }),
  });
  const run = detail.data?.run;
  const snapshot = run?.definition_snapshot as
    | {
        name?: string;
        sides?: Array<{ side_id: string; label?: string }>;
        sources?: Array<{ side_id: string; name?: string; source_type?: string }>;
      }
    | null
    | undefined;
  const sides = snapshot?.sides ?? [];
  const sideIds = sides.map((side) => side.side_id);
  const resultRows = (detail.data?.results ?? []) as Array<Record<string, any>>;
  const matches = resultRows.filter((item) => item.kind === "match");
  const exceptions = resultRows.filter((item) => item.kind === "exception");
  const latestCompleted = overview.data?.completedRuns?.[0];
  const trendData = [...(overview.data?.completedRuns ?? [])].reverse().map((item) => ({
    run: formatReconRunId(item.run_uid, item.id),
    startedAt: timestampLabel(item.started_at),
    matchedGroups: typeof item.matched_count === "number" ? item.matched_count : null,
    exceptionItems: typeof item.exception_count === "number" ? item.exception_count : null,
  }));
  const serverCounts = detail.data?.statusCounts;
  const statusCount = (key: RecordStatus): number | null => {
    if (key === "match")
      return typeof serverCounts?.match_groups === "number" ? serverCounts.match_groups : null;
    const counts = serverCounts?.exception_buckets as Record<string, unknown> | null | undefined;
    const bucket = key === "invalid_key" ? "invalid_key" : key;
    return typeof counts?.[bucket] === "number" ? (counts[bucket] as number) : null;
  };
  const totalRunResults =
    typeof serverCounts?.match_groups === "number" &&
    typeof serverCounts?.exception_items === "number"
      ? serverCounts.match_groups + serverCounts.exception_items
      : null;
  const visibleMatches = statusFilter === "all" || statusFilter === "match" ? matches : [];
  const visibleExceptions = statusFilter === "match" ? [] : exceptions;
  const fields = [
    ...new Set([
      ...(detail.data?.fieldNames ?? []).filter(
        (field): field is string => typeof field === "string",
      ),
      ...matches.flatMap((match) =>
        Object.values(groupMembers(match.members)).flatMap((rows) =>
          rows.flatMap((row) => Object.keys(row)),
        ),
      ),
      ...exceptions.flatMap((item) =>
        Object.values(groupMembers(item.members)).flatMap((rows) =>
          rows.flatMap((row) => Object.keys(row)),
        ),
      ),
    ]),
  ];
  const selectRun = (id: string) => {
    setSelectedRunId(id);
    setDetailPage(0);
    setExpandedMatchId(null);
    setSelectedExceptionId(null);
    setActiveTab("results");
  };
  const copyPublicCaseId = async (caseId: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(caseId);
      setCaseCopyMessage("Public case ID copied. Search for it in Exceptions to open the case.");
    } catch {
      setCaseCopyMessage("Could not copy the public case ID. Select and copy it manually.");
    }
  };
  useEffect(() => {
    setDays(7);
    setHistoryPage(0);
    setDetailPage(0);
    setStatusFilter("all");
    setSelectedRunId(null);
    setExpandedMatchId(null);
    setSelectedExceptionId(null);
    setActiveTab(selection?.runId ? "results" : "overview");
  }, [selection?.definitionId, selection?.runId]);
  useEffect(() => {
    setExpandedMatchId(null);
    setSelectedExceptionId(null);
  }, [runId, detailPage, statusFilter]);
  if (!selection) return null;
  return (
    <section
      aria-label="Reconciliation run workbench"
      className="mt-4 max-h-[90vh] space-y-4 overflow-y-auto rounded-lg border bg-background p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="text-lg font-semibold">
            {run ? (snapshot?.name ?? "Reconciliation run") : "Reconciliation run workbench"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {run
              ? `Run ID ${formatReconRunId(run.run_uid, run.id)}`
              : "Review persisted run history, then open an exact Run ID to inspect processed results."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSelectedRunId(null);
            onClose();
          }}
        >
          Close results
        </Button>
      </header>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Run history period">
        {([1, 7, 14, 30, 90] as const).map((period) => (
          <Button
            key={period}
            size="sm"
            variant={days === period ? "default" : "outline"}
            aria-pressed={days === period}
            onClick={() => {
              setDays(period);
              setHistoryPage(0);
            }}
          >
            {period === 1 ? "Last 24 hours" : `${period} days`}
          </Button>
        ))}
      </div>
      {run && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded border p-3">
            <p className="text-xs text-muted-foreground">Input rows · all sides</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {displayCount(run.total_rows)}
            </p>
          </div>
          <div className="rounded border p-3">
            <p className="text-xs text-muted-foreground">Matched groups</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {displayCount(serverCounts?.match_groups)}
            </p>
          </div>
          <div className="rounded border p-3">
            <p className="text-xs text-muted-foreground">Exception items</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {displayCount(serverCounts?.exception_items)}
            </p>
          </div>
        </div>
      )}
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === "results" || value === "overview" || value === "history")
            setActiveTab(value);
        }}
        className="space-y-4"
      >
        <TabsList className="grid w-full grid-cols-3 sm:w-auto">
          <TabsTrigger value="results" disabled={!runId}>
            Results
          </TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          {overview.isError && (
            <div role="alert" className="rounded border border-destructive/30 p-3 text-sm">
              <p className="font-medium text-destructive">
                Run overview is temporarily unavailable.
              </p>
              <p className="mt-1 text-muted-foreground">
                The service could not load the selected period summary. Try again shortly.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => overview.refetch()}
              >
                Try again
              </Button>
            </div>
          )}
          {overview.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading run overview…
            </p>
          )}
          {overview.data && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Period overview · {days === 1 ? "Last 24 hours" : `Last ${days} days`}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded border p-3">
                      <p className="text-xs text-muted-foreground">Completed runs in period</p>
                      <p className="mt-1 text-2xl font-semibold">
                        {displayCount(overview.data.completedCount)}
                      </p>
                    </div>
                    <div className="rounded border p-3">
                      <p className="text-xs text-muted-foreground">
                        Latest completed input rows · all sides
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {displayCount(latestCompleted?.total_rows)}
                      </p>
                    </div>
                    <div className="rounded border p-3">
                      <p className="text-xs text-muted-foreground">
                        Latest completed matched groups
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {displayCount(latestCompleted?.matched_count)}
                      </p>
                    </div>
                    <div className="rounded border p-3">
                      <p className="text-xs text-muted-foreground">
                        Latest completed exception items
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {displayCount(latestCompleted?.exception_count)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Matched groups count persisted groups. Matched input-row memberships:{" "}
                    {displayCount(latestCompleted?.matched_input_memberships)}; distinct matched
                    input rows: N/A because persisted results do not carry stable source-record
                    identities.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Matched groups and exception items · latest completed runs in period
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {trendData.length ? (
                    <div
                      role="img"
                      aria-label={`Trend of matched groups and exception items across ${trendData.length} latest completed runs in the selected period`}
                      className="h-64 w-full"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={trendData}
                          margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="startedAt" tick={{ fontSize: 11 }} minTickGap={24} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <Tooltip
                            labelFormatter={(_label, payload) =>
                              payload?.[0]?.payload?.run ?? "Run"
                            }
                          />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="matchedGroups"
                            name="Matched groups"
                            stroke="var(--primary)"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            connectNulls={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="exceptionItems"
                            name="Exception items"
                            stroke="var(--warning)"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            connectNulls={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="rounded border p-4 text-center text-sm text-muted-foreground">
                      No completed runs in this period. Choose a longer period to include older
                      completed runs.
                    </p>
                  )}
                  {!!trendData.length && (
                    <div className="mt-3 overflow-x-auto rounded border">
                      <table className="w-full min-w-[620px] text-left text-xs">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="p-2">Run ID</th>
                            <th className="p-2">Started (UTC)</th>
                            <th className="p-2">Matched groups</th>
                            <th className="p-2">Exception items</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...(overview.data.completedRuns ?? [])].map((item) => (
                            <tr key={item.id} className="border-b">
                              <td className="p-2 font-mono">
                                {formatReconRunId(item.run_uid, item.id)}
                              </td>
                              <td className="p-2">{timestampLabel(item.started_at)}</td>
                              <td className="p-2">{displayCount(item.matched_count)}</td>
                              <td className="p-2">{displayCount(item.exception_count)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Counts are per completed run. Input rows are summed across configured sides;
                    exception items are not unique input-record counts.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Process context</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Configured sides</p>
                    {snapshot?.sides?.length ? (
                      <ul className="mt-1 list-disc pl-5 text-sm">
                        {snapshot.sides.map((side) => (
                          <li key={side.side_id}>
                            {side.side_id}: {side.label ?? `Side ${side.side_id}`}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        N/A · no immutable run configuration snapshot is available.
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Latest source submissions
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      N/A · submission timestamps are not recorded in the run snapshot.
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Definition version</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      N/A · the run snapshot does not record a version identifier.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
        <TabsContent value="history" className="space-y-4">
          {history.isError && (
            <div role="alert" className="rounded border border-destructive/30 p-3 text-sm">
              <p className="font-medium text-destructive">
                Run history is temporarily unavailable.
              </p>
              <p className="mt-1 text-muted-foreground">
                The service could not load this period. Try again shortly.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => history.refetch()}
              >
                Try again
              </Button>
            </div>
          )}
          {history.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading run history…
            </p>
          )}
          {history.data && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Run history · {history.data.count.toLocaleString()} runs in period
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-56 overflow-auto rounded border">
                  <table className="w-full min-w-[650px] text-left text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="p-2">Run ID</th>
                        <th className="p-2">Started (UTC)</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Input rows</th>
                        <th className="p-2">Matched groups</th>
                        <th className="p-2">Exception items</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.rows.map((item) => (
                        <tr key={item.id} className="border-b">
                          <td className="p-2">
                            <button
                              type="button"
                              className="font-mono underline underline-offset-2 focus-visible:outline focus-visible:outline-2"
                              aria-label={`Open run ${formatReconRunId(item.run_uid, item.id)}`}
                              aria-current={runId === item.id ? "true" : undefined}
                              onClick={() => selectRun(item.id)}
                            >
                              {formatReconRunId(item.run_uid, item.id)}
                            </button>
                          </td>
                          <td className="p-2">{timestampLabel(item.started_at)}</td>
                          <td className="p-2">
                            <Badge
                              variant={
                                item.status === "failed"
                                  ? "destructive"
                                  : item.status === "running"
                                    ? "outline"
                                    : "secondary"
                              }
                            >
                              {item.status}
                            </Badge>
                          </td>
                          <td className="p-2">{displayCount(item.total_rows)}</td>
                          <td className="p-2">{displayCount(item.matched_count)}</td>
                          <td className="p-2">{displayCount(item.exception_count)}</td>
                        </tr>
                      ))}
                      {!history.data.rows.length && (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-muted-foreground">
                            No runs started in this period. Choose a longer period to see older
                            runs.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-end gap-2 p-3 text-sm">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={historyPage === 0}
                    onClick={() => setHistoryPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span>Page {historyPage + 1}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(historyPage + 1) * history.data.pageSize >= history.data.count}
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="results" className="space-y-4">
          {runId && (
            <section className="space-y-4" aria-label="Processed run">
              {detail.isPending && (
                <p className="text-sm text-muted-foreground">Loading processed records…</p>
              )}
              {detail.isError && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive"
                >
                  <p>Processed records are unavailable. Try again shortly.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => detail.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {detail.data &&
                (typeof serverCounts?.match_groups !== "number" ||
                  typeof serverCounts?.exception_items !== "number") && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Whole-run status counts are unavailable; status filters show N/A until the count
                    service can be reached.
                  </p>
                )}
              {detail.data === null && (
                <p role="alert" className="text-sm text-muted-foreground">
                  This run is unavailable in the current workspace.
                </p>
              )}
              {run && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">
                      {snapshot?.name ?? "Reconciliation"} · {formatReconRunId(run.run_uid, run.id)}
                    </h3>
                    <Badge variant={run.status === "failed" ? "destructive" : "outline"}>
                      {run.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {displayCount(run.total_rows)} input rows ·{" "}
                      {displayCount(serverCounts?.match_groups)} matched groups ·{" "}
                      {displayCount(serverCounts?.exception_items)} exception items
                    </span>
                  </div>
                  {!snapshot && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      This older run has no immutable configuration snapshot. Side labels and
                      definition name are unavailable for this run.
                    </p>
                  )}
                  {!!snapshot?.sources?.length && (
                    <p className="text-xs text-muted-foreground">
                      Run sources:{" "}
                      {snapshot.sources
                        .map(
                          (source) => `${source.side_id}: ${source.name ?? "Source unavailable"}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                  <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
                    <nav
                      aria-label="Run result status filter"
                      className="space-y-1 rounded border p-2"
                    >
                      <p className="px-2 py-1 text-xs text-muted-foreground">Whole-run counts</p>
                      <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                        Match counts groups; other statuses count exception items. Workflow status
                        is separate.
                      </p>
                      <Button
                        size="sm"
                        variant={statusFilter === "all" ? "secondary" : "ghost"}
                        className="w-full justify-between"
                        onClick={() => {
                          setStatusFilter("all");
                          setDetailPage(0);
                        }}
                      >
                        All results{" "}
                        <span className="text-right text-[10px]">
                          {totalRunResults === null
                            ? "N/A"
                            : `${serverCounts?.match_groups} groups · ${serverCounts?.exception_items} exceptions`}
                        </span>
                      </Button>
                      {(Object.keys(STATUS_LABELS) as RecordStatus[]).map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant={statusFilter === status ? "secondary" : "ghost"}
                          className="w-full justify-between"
                          onClick={() => {
                            setStatusFilter(status);
                            setDetailPage(0);
                          }}
                        >
                          {STATUS_LABELS[status]} <span>{statusCount(status) ?? "N/A"}</span>
                        </Button>
                      ))}
                    </nav>
                    <div
                      className={`grid min-w-0 gap-4 ${selectedExceptionId ? "xl:grid-cols-[minmax(0,1fr)_20rem]" : "grid-cols-1"}`}
                    >
                      <div className="min-w-0 space-y-4">
                        {(visibleMatches.length > 0 || visibleExceptions.length > 0) && (
                          <div className="space-y-2">
                            <h4 className="font-medium">Run results</h4>
                            <p className="text-xs text-muted-foreground">
                              Each row is one persisted match group or a related exception group.
                              Every field stacks values by source and preserves all members. Result
                              classification is separate from exception workflow state.
                            </p>
                            <div className="overflow-auto rounded border">
                              <table className="w-full min-w-[650px] text-left text-sm">
                                <thead>
                                  <tr className="border-b bg-muted/40">
                                    <th className="p-2">Result</th>
                                    {fields.map((field) => (
                                      <th key={field} className="p-2">
                                        {field}
                                      </th>
                                    ))}
                                    <th className="p-2">Rule / reason</th>
                                    <th className="p-2">Workflow</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibleMatches.map((match) => {
                                    const members = groupMembers(match.members);
                                    const allSides = [
                                      ...new Set([...sideIds, ...Object.keys(members)]),
                                    ];
                                    const expanded = expandedMatchId === match.id;
                                    const groupNumber =
                                      detailPage * (detail.data?.pageSize ?? 50) +
                                      resultRows.indexOf(match) +
                                      1;
                                    return (
                                      <Fragment key={`match-${match.id}`}>
                                        <tr className="border-b align-top">
                                          <td className="p-2 font-mono text-xs">
                                            <button
                                              type="button"
                                              className="text-left underline underline-offset-2"
                                              aria-expanded={expanded}
                                              aria-label={`${expanded ? "Hide" : "Show"} full records for group ${groupNumber}`}
                                              onClick={() =>
                                                setExpandedMatchId(expanded ? null : match.id)
                                              }
                                            >
                                              Group {groupNumber}
                                              <span className="block text-muted-foreground">
                                                {match.cardinality}
                                              </span>
                                            </button>
                                            <span className="block text-xs">Match</span>
                                          </td>
                                          {fields.map((field) => {
                                            const values = allSides.flatMap((sideId) =>
                                              (members[sideId]?.length
                                                ? members[sideId]
                                                : [{}]
                                              ).map((row) => row[field]),
                                            );
                                            return (
                                              <td key={field} className="p-2">
                                                <div className="space-y-1">
                                                  {allSides.flatMap((sideId) => {
                                                    const rows = members[sideId]?.length
                                                      ? members[sideId]
                                                      : [{}];
                                                    const sideLabel = sides.find(
                                                      (side) => side.side_id === sideId,
                                                    )?.label;
                                                    return rows.map((row, index) => (
                                                      <div
                                                        key={`${sideId}-${index}`}
                                                        className="flex gap-2 text-xs"
                                                      >
                                                        <span
                                                          className="shrink-0 font-semibold"
                                                          title={sideLabel ?? `Side ${sideId}`}
                                                        >
                                                          {sideId}
                                                          {rows.length > 1 ? index + 1 : ""}
                                                        </span>
                                                        <span
                                                          className={
                                                            row[field] === undefined ||
                                                            row[field] === null
                                                              ? "text-muted-foreground"
                                                              : ""
                                                          }
                                                        >
                                                          {cellValue(row[field])}
                                                        </span>
                                                      </div>
                                                    ));
                                                  })}
                                                  <span className="text-[11px] text-muted-foreground">
                                                    {fieldCue(values, allSides.length)}
                                                  </span>
                                                </div>
                                              </td>
                                            );
                                          })}
                                          <td className="p-2 text-xs">{match.rule_id || "—"}</td>
                                          <td className="p-2">—</td>
                                        </tr>
                                        {expanded && (
                                          <tr className="border-b bg-muted/20">
                                            <td colSpan={fields.length + 3} className="p-3">
                                              <div className="grid gap-3 md:grid-cols-3">
                                                {allSides.map((sideId) => (
                                                  <section key={sideId}>
                                                    <h5 className="mb-1 text-sm font-medium">
                                                      {sides.find((side) => side.side_id === sideId)
                                                        ?.label ?? `Side ${sideId}`}{" "}
                                                      ({sideId})
                                                    </h5>
                                                    <Records value={members[sideId]} />
                                                  </section>
                                                ))}
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                  {visibleExceptions.map((item) => {
                                    const memberRows = groupMembers(item.members);
                                    const allSides = [
                                      ...new Set([...sideIds, ...Object.keys(memberRows)]),
                                    ];
                                    const status = statusBucket(item.status_bucket);
                                    const childItems = Array.isArray(item.exception_items)
                                      ? (item.exception_items as Array<Record<string, any>>)
                                      : [];
                                    const selected = selectedExceptionId === item.id;
                                    const reasons = [
                                      ...new Set(
                                        childItems.map((child) => child.reason).filter(Boolean),
                                      ),
                                    ];
                                    const workflows = [
                                      ...new Set(
                                        childItems.map((child) => child.status).filter(Boolean),
                                      ),
                                    ];
                                    return (
                                      <tr
                                        key={`exception-${item.id}`}
                                        className={`border-b align-top ${selected ? "fvi-selected-row" : ""}`}
                                        aria-selected={selected}
                                      >
                                        <td className="p-2 text-xs">
                                          <button
                                            type="button"
                                            className="text-left underline underline-offset-2"
                                            aria-label={`Inspect ${STATUS_LABELS[status]} exception group`}
                                            onClick={() => setSelectedExceptionId(item.id)}
                                          >
                                            {STATUS_LABELS[status]}
                                            <span className="block">
                                              {childItems.length} exception item
                                              {childItems.length === 1 ? "" : "s"}
                                            </span>
                                          </button>
                                        </td>
                                        {fields.map((field) => (
                                          <td key={field} className="p-2">
                                            <div className="space-y-1">
                                              {allSides.flatMap((sideId) => {
                                                const rows = memberRows[sideId]?.length
                                                  ? memberRows[sideId]
                                                  : [{}];
                                                return rows.map((row, index) => (
                                                  <div
                                                    key={`${sideId}-${index}`}
                                                    className="flex gap-2 text-xs"
                                                  >
                                                    <span className="font-semibold">
                                                      {sideId}
                                                      {rows.length > 1 ? index + 1 : ""}
                                                    </span>
                                                    <span>{cellValue(row[field])}</span>
                                                  </div>
                                                ));
                                              })}
                                            </div>
                                          </td>
                                        ))}
                                        <td className="p-2 text-xs">
                                          {reasons.join(" · ") || "Reason unavailable"}
                                        </td>
                                        <td className="p-2 text-xs">
                                          {workflows.join(", ") || "Unavailable"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                      {selectedExceptionId && (
                        <aside
                          aria-label="Selected result details"
                          className="h-fit rounded border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-medium">Selected exception details</h4>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label="Close selected result details"
                              onClick={() => setSelectedExceptionId(null)}
                            >
                              ×
                            </Button>
                          </div>
                          {(() => {
                            const item = exceptions.find(
                              (candidate) => candidate.id === selectedExceptionId,
                            );
                            const children = Array.isArray(item?.exception_items)
                              ? (item.exception_items as ReconRunResultExceptionItem[])
                              : [];
                            return item ? (
                              <div className="mt-2 space-y-3">
                                {children.map((child, index) => (
                                  <section key={child.id ?? index} className="rounded border p-2">
                                    <p className="text-sm">
                                      Exception item {index + 1} ·{" "}
                                      {child.side || "Side unavailable"} ·{" "}
                                      {child.status || "Workflow status unavailable"}
                                    </p>
                                    {child.public_case_id ? (
                                      <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-xs">
                                          {child.public_case_id}
                                        </span>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          onClick={() =>
                                            void copyPublicCaseId(child.public_case_id!)
                                          }
                                        >
                                          Copy case ID
                                        </Button>
                                      </div>
                                    ) : (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        Public case ID unavailable in this run result.
                                      </p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                      {child.reason || "Reason unavailable"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Recorded (UTC):{" "}
                                      {child.created_at
                                        ? timestampLabel(child.created_at)
                                        : "time unavailable"}
                                    </p>
                                    <Records value={exceptionPayloadDetails(child.payload)} />
                                  </section>
                                ))}
                                {caseCopyMessage && (
                                  <p role="status" className="text-xs text-muted-foreground">
                                    {caseCopyMessage}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  Source arrival timestamps and record-level ingest lineage are
                                  unavailable in the run-results service.
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Workflow actions are not available from this read-only run-results
                                  service. Search by public case ID in Exceptions to use its
                                  permission-checked case workflow.
                                </p>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                This result is no longer on the current page.
                              </p>
                            );
                          })()}
                        </aside>
                      )}
                      {!visibleMatches.length && !visibleExceptions.length && (
                        <p className="rounded border p-4 text-center text-sm text-muted-foreground">
                          No{" "}
                          {statusFilter === "all"
                            ? "results"
                            : STATUS_LABELS[statusFilter].toLowerCase() + " records"}{" "}
                          on page {detailPage + 1} of this run. Use Next records to continue through
                          the exact run.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 text-sm">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={detailPage === 0}
                      onClick={() => setDetailPage((p) => p - 1)}
                    >
                      Previous records
                    </Button>
                    <span>Page {detailPage + 1}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!detail.data?.hasNext}
                      onClick={() => setDetailPage((p) => p + 1)}
                    >
                      Next records
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
