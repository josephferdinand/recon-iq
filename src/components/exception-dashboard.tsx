import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Inbox,
  RefreshCw,
  ShieldAlert,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getExceptionDashboard } from "@/lib/exception-dashboard.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatUserMessage, mapKnownFailure, type UserMessageCategory } from "@/lib/user-message";

type WindowDays = 7 | 30 | 90;

type NamedCount = { name: string; count: number };

type ExceptionDashboardData = {
  as_of: string;
  window_days: number;
  totals: {
    total: number;
    open: number;
    resolved: number;
    high_priority: number;
    unassigned: number;
    older_than_30_days: number;
    oldest_open_days: number;
  };
  by_severity: NamedCount[];
  by_status: NamedCount[];
  ageing: NamedCount[];
  trend: { date: string; created: number; still_open: number }[];
  by_reconciliation: {
    id: string | null;
    name: string;
    open: number;
    high_priority: number;
    oldest_open_days: number;
  }[];
};

const WINDOWS: WindowDays[] = [7, 30, 90];
const CHART_COLOURS = [
  "var(--brand-gold)",
  "var(--fvi-cyan)",
  "var(--fvi-violet)",
  "var(--fvi-emerald)",
  "var(--fvi-amber)",
  "var(--fvi-crimson)",
];

const numberFormat = new Intl.NumberFormat("en-US");

function count(value: number) {
  return numberFormat.format(value);
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for focused formatting regression tests.
export function formatPercentage(value: number, total: number) {
  if (total <= 0 || value === 0) return "0%";
  if (value === total) return "100%";

  const result = (value / total) * 100;
  if (result > 0 && result < 0.1) return "<0.1%";
  const oneDecimal = result.toFixed(1);
  if (result < 100 && oneDecimal === "100.0") return ">99.9%";
  if (result > 100 && oneDecimal === "100.0") return ">100%";
  if (result < 1 || result > 99) return `${result.toFixed(1)}%`;
  return `${Math.round(result)}%`;
}

const STATUS_LABELS: Record<string, { short: string; full: string }> = {
  new: { short: "New", full: "New" },
  assigned: { short: "Assigned", full: "Assigned" },
  investigating: { short: "Investigating", full: "Investigating" },
  pending_counterparty: { short: "Pending CP", full: "Pending counterparty" },
  resolved: { short: "Resolved", full: "Resolved" },
  written_off: { short: "Written off", full: "Written off" },
};

// eslint-disable-next-line react-refresh/only-export-components -- exported for focused formatting regression tests.
export function formatStatusLabel(value: string, short = false) {
  const known = STATUS_LABELS[value];
  if (known) return short ? known.short : known.full;
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function asOfLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function ExceptionDashboard({ tenantId, slug }: { tenantId: string; slug: string }) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const fetchDashboard = useServerFn(getExceptionDashboard);
  const dashboardQuery = useQuery({
    queryKey: ["exception-dashboard", tenantId, windowDays],
    queryFn: async (): Promise<ExceptionDashboardData> =>
      fetchDashboard({ data: { tenant_id: tenantId, days: windowDays } }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const data = dashboardQuery.data;

  return (
    <section aria-labelledby="exception-dashboard-title" className="space-y-4">
      <header className="rounded-2xl border bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              Exception control
            </div>
            <h2 id="exception-dashboard-title" className="text-2xl font-semibold tracking-tight">
              Exception dashboard
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Prioritise the open queue, understand ageing, and identify the reconciliations
              contributing the most unresolved work.
            </p>
            {data ? (
              <p className="mt-2 text-xs text-muted-foreground">
                As of <time dateTime={data.as_of}>{asOfLabel(data.as_of)}</time> · Trend window{" "}
                {data.window_days} days
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Exception creation-cohort trend window"
              className="inline-flex rounded-md border bg-background p-1"
            >
              {WINDOWS.map((days) => (
                <Button
                  key={days}
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={windowDays === days}
                  onClick={() => setWindowDays(days)}
                  className={cn("h-7 px-2.5", windowDays === days && "shadow-sm")}
                  style={
                    windowDays === days
                      ? { backgroundColor: "var(--brand-gold)", color: "#0e1a30" }
                      : undefined
                  }
                >
                  {days}d
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={dashboardQuery.isFetching}
              onClick={() => dashboardQuery.refetch()}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", dashboardQuery.isFetching && "animate-spin")}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          <Button asChild size="sm">
            <Link to="/$slug/workspace" params={{ slug }} search={{ page: "exceptions" }}>
              <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
              Open exception inbox
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/$slug/workspace" params={{ slug }} search={{ page: "breaks" }}>
              Open break manager
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </header>

      {dashboardQuery.isPending ? <DashboardLoading /> : null}
      {dashboardQuery.isError ? (
        <DashboardError
          error={dashboardQuery.error}
          retry={() => dashboardQuery.refetch()}
        />
      ) : null}
      {data && data.totals.total === 0 ? <DashboardEmpty /> : null}
      {data && data.totals.total > 0 ? <DashboardBody data={data} /> : null}
    </section>
  );
}

function DashboardBody({ data }: { data: ExceptionDashboardData }) {
  const resolvedShare = formatPercentage(data.totals.resolved, data.totals.total);
  const topReconciliations = useMemo(
    () =>
      [...data.by_reconciliation]
        .sort(
          (left, right) =>
            right.open - left.open ||
            right.high_priority - left.high_priority ||
            right.oldest_open_days - left.oldest_open_days,
        )
        .slice(0, 10),
    [data.by_reconciliation],
  );
  const insights = useMemo(() => buildInsights(data), [data]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiTile
          label="Open"
          value={count(data.totals.open)}
          hint={`${formatPercentage(data.totals.open, data.totals.total)} of ${count(data.totals.total)} total`}
          icon={Inbox}
        />
        <KpiTile
          label="Open P1/P2"
          value={count(data.totals.high_priority)}
          hint={`${formatPercentage(data.totals.high_priority, data.totals.open)} of open · priority P1 or P2`}
          icon={AlertTriangle}
          tone="danger"
        />
        <KpiTile
          label="Unassigned"
          value={count(data.totals.unassigned)}
          hint={`${formatPercentage(data.totals.unassigned, data.totals.open)} of open`}
          icon={UserRoundX}
          tone="warning"
        />
        <KpiTile
          label="Older than 30d"
          value={count(data.totals.older_than_30_days)}
          hint={`${formatPercentage(data.totals.older_than_30_days, data.totals.open)} of open`}
          icon={CalendarClock}
          tone="warning"
        />
        <KpiTile
          label="Oldest open"
          value={`${count(data.totals.oldest_open_days)}d`}
          hint="Age of oldest unresolved item"
          icon={Clock3}
        />
        <KpiTile
          label="Closed share"
          value={resolvedShare}
          hint={`${count(data.totals.resolved)} resolved, written off or won't fix`}
          icon={CheckCircle2}
          tone="success"
        />
      </div>

      <Card className="border-primary/20 bg-primary/[0.025]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Actionable queue signals</CardTitle>
          <CardDescription>
            Deterministic observations from the full current authorized exception population.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 md:grid-cols-3">
          {insights.map((insight) => (
            <div key={insight.title} className="rounded-lg border bg-card p-3">
              <div className={cn("text-sm font-semibold", insight.tone)}>{insight.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{insight.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Exception creation cohorts</CardTitle>
          <CardDescription>
            Created exceptions by date, with the portion of each creation cohort that remains open
            now. “Still open” is current cohort status, not a historical backlog measurement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart data={data.trend} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <DistributionCard
          title="Severity"
          description="Current exceptions by recorded severity."
          data={data.by_severity}
        />
        <DistributionCard
          title="Status"
          description="Current exceptions by workflow status."
          data={data.by_status}
        />
        <DistributionCard
          title="Ageing"
          description="Open exceptions by full elapsed days since creation."
          data={data.ageing}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top contributing reconciliations</CardTitle>
          <CardDescription>
            Ranked by open exceptions, then high-priority count and oldest open age. Rows are
            informational; use the inbox or break manager above for governed workflow actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reconciliation</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Open P1/P2</TableHead>
                <TableHead className="text-right">Oldest open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topReconciliations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    No reconciliation-linked open exceptions in this result.
                  </TableCell>
                </TableRow>
              ) : (
                topReconciliations.map((reconciliation, index) => (
                  <TableRow key={reconciliation.id ?? `unlinked-${index}`}>
                    <TableCell>
                      <div className="max-w-[30rem] truncate font-medium">
                        {reconciliation.name || "Unlinked"}
                      </div>
                      {reconciliation.id === null ? (
                        <div className="text-xs text-muted-foreground">
                          No reconciliation assigned
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {count(reconciliation.open)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(reconciliation.high_priority)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(reconciliation.oldest_open_days)}d
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const toneClass = {
    default: "text-primary",
    danger: "text-destructive",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
  }[tone];
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="rounded-md bg-muted p-1.5">
            <Icon className={cn("h-4 w-4", toneClass)} aria-hidden="true" />
          </span>
        </div>
        <div className={cn("mt-3 text-3xl font-semibold tabular-nums", toneClass)}>{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function TrendChart({ data }: { data: ExceptionDashboardData["trend"] }) {
  if (data.length === 0) {
    return <ChartEmpty message="No exceptions were created in the selected window." />;
  }
  const created = data.reduce((sum, item) => sum + item.created, 0);
  const stillOpen = data.reduce((sum, item) => sum + item.still_open, 0);
  return (
    <div>
      <div
        role="img"
        aria-label={`Exception creation cohort chart. ${count(created)} created; ${count(stillOpen)} from these cohorts are still open now.`}
        className="h-72 w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => value.slice(5)}
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
              minTickGap={18}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
            <Tooltip
              labelFormatter={(label) => `Created on ${label}`}
              formatter={(value: number, name: string) => [
                count(value),
                name === "created" ? "Created" : "Still open now",
              ]}
              contentStyle={tooltipStyle}
            />
            <Legend formatter={(value) => (value === "created" ? "Created" : "Still open now")} />
            <Bar
              dataKey="created"
              fill="var(--brand-gold)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="still_open"
              stroke="var(--fvi-crimson)"
              strokeWidth={2.5}
              dot={{ r: 2.5 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{count(created)}</strong> created in window
        </span>
        <span>
          <strong className="text-foreground">{count(stillOpen)}</strong> from those cohorts still
          open now
        </span>
      </div>
    </div>
  );
}

function DistributionCard({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: NamedCount[];
}) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const isStatus = title === "Status";
  const summary = data
    .map((item) => `${isStatus ? formatStatusLabel(item.name) : item.name}: ${count(item.count)}`)
    .join(", ");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <ChartEmpty message={`No ${title.toLowerCase()} distribution available.`} />
        ) : (
          <>
            <div
              role="img"
              aria-label={`${title} distribution. ${summary}.`}
              className="w-full"
              style={{ height: Math.max(180, data.length * 38) }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  layout="vertical"
                  margin={{ top: 4, right: 8, left: 12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={82}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value: string) =>
                      isStatus ? formatStatusLabel(value, true) : value
                    }
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip
                    labelFormatter={(label) =>
                      isStatus ? formatStatusLabel(String(label)) : label
                    }
                    formatter={(value: number) => [count(value), "Exceptions"]}
                    contentStyle={tooltipStyle}
                  />
                  <Bar
                    dataKey="count"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={18}
                    isAnimationActive={false}
                  >
                    {data.map((item, index) => (
                      <Cell key={item.name} fill={CHART_COLOURS[index % CHART_COLOURS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {count(total)} records across {count(data.length)} categories.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardLoading() {
  return (
    <div aria-label="Loading exception dashboard" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading exception dashboard…</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-64 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const category: UserMessageCategory = ["auth", "session", "mfa", "network", "timeout", "dependency"].includes(mapped.category) ? mapped.category : "system";
  const message = formatUserMessage({ ...mapped, category, action: "load the exception dashboard", code, status, retryable: true, availableActions: [{ id: "refresh-dashboard", label: "Refresh exception dashboard" }] });
  return (
    <Card role="alert" className="border-destructive/40">
      <CardContent className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center">
        <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{message.title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{message.humanMessage}</p>
        </div>
        {message.nextActions.map((action) => <Button key={action.id} type="button" variant="outline" size="sm" onClick={() => { if (action.id === "refresh-dashboard") retry(); }}>{action.label}</Button>)}
      </CardContent>
    </Card>
  );
}

function DashboardEmpty() {
  return (
    <Card>
      <CardContent className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
        <span className="rounded-full bg-primary/10 p-3 text-primary">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h3 className="mt-4 font-semibold">No exceptions in this result</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          The current authorized population contains no exception records. Refresh to check again;
          changing the trend window affects only the creation-cohort chart.
        </p>
      </CardContent>
    </Card>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-44 items-center justify-center text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function buildInsights(data: ExceptionDashboardData) {
  const { totals } = data;
  const highestContributor = [...data.by_reconciliation].sort(
    (left, right) => right.open - left.open || right.high_priority - left.high_priority,
  )[0];

  const priorityInsight =
    totals.open === 0
      ? {
          title: "Open queue is clear",
          detail: "No open exceptions are present in this result.",
          tone: "text-emerald-600 dark:text-emerald-400",
        }
      : {
          title: `${formatPercentage(totals.high_priority, totals.open)} priority P1/P2`,
          detail: `${count(totals.high_priority)} of ${count(totals.open)} open exceptions are assigned priority P1 or P2.`,
          tone:
            totals.high_priority > 0
              ? "text-destructive"
              : "text-emerald-600 dark:text-emerald-400",
        };

  const ownershipInsight = {
    title:
      totals.unassigned > 0
        ? `${count(totals.unassigned)} need an owner`
        : "Every open item is assigned",
    detail:
      totals.unassigned > 0
        ? `${formatPercentage(totals.unassigned, totals.open)} of the open queue is currently unassigned.`
        : "No unassigned open exceptions are present in this result.",
    tone:
      totals.unassigned > 0
        ? "text-amber-600 dark:text-amber-400"
        : "text-emerald-600 dark:text-emerald-400",
  };

  const concentrationInsight = highestContributor
    ? {
        title: `${highestContributor.name || "Unlinked"} leads the queue`,
        detail: `${count(highestContributor.open)} open, including ${count(highestContributor.high_priority)} with priority P1 or P2; oldest ${count(highestContributor.oldest_open_days)} days.`,
        tone: "text-primary",
      }
    : {
        title: `${count(totals.older_than_30_days)} aged over 30 days`,
        detail: `The oldest open exception is ${count(totals.oldest_open_days)} days old.`,
        tone: totals.older_than_30_days > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary",
      };

  return [priorityInsight, ownershipInsight, concentrationInsight];
}

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
};
