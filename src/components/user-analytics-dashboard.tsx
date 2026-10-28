import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { USER_FACING_ERRORS, userFacingErrorKind } from "@/lib/user-facing-errors";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  UserCheck,
  UserMinus,
  UserX,
  ShieldCheck,
  KeyRound,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getPlatformUserAnalytics,
  getTenantUserAnalytics,
  type PlatformAnalytics,
  type TenantAnalytics,
} from "@/lib/user-analytics.functions";

type WindowDays = 7 | 30 | 90;

function AnalyticsError({ error, onRetry, compact = false }: { error: unknown; onRetry: () => void; compact?: boolean }) {
  const kind = userFacingErrorKind(error);
  const copy = USER_FACING_ERRORS[kind];
  const warning = kind === "service" || kind === "network";
  const StatusIcon = kind === "access" ? ShieldAlert : AlertTriangle;
  return (
    <div role="alert" className={`space-y-2 rounded-lg border text-sm ${compact ? "p-3" : "p-5"} ${warning ? "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300" : "border-destructive/40 text-destructive"}`}>
      <p className="flex items-center gap-2 font-medium">
        <StatusIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
        {copy.title}
      </p>
      <p>{copy.message} {copy.action}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  hint?: string;
  icon: typeof Users;
  tone?: "default" | "success" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-500"
      : tone === "warning"
        ? "text-amber-500"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-primary";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <Icon className={`h-4 w-4 ${toneClass}`} />
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function CoverageBar({
  label,
  value,
  total,
  icon: Icon,
}: {
  label: string;
  value: number;
  total: number;
  icon: typeof ShieldCheck;
}) {
  const p = pct(value, total);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{label}</span>
        </div>
        <span className="tabular-nums text-muted-foreground">
          {value.toLocaleString()} / {total.toLocaleString()} · {p}%
        </span>
      </div>
      <Progress value={p} className="h-2" />
    </div>
  );
}

function TrendChart({ data }: { data: { day: string; signins: number }[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No sign-in activity in the selected window.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="signinGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
        <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="signins"
          stroke="hsl(var(--primary))"
          fill="url(#signinGradient)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function WindowSelector({
  value,
  onChange,
}: {
  value: WindowDays;
  onChange: (v: WindowDays) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v) as WindowDays)}>
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="7">Last 7 days</SelectItem>
        <SelectItem value="30">Last 30 days</SelectItem>
        <SelectItem value="90">Last 90 days</SelectItem>
      </SelectContent>
    </Select>
  );
}

function SummaryGrid({ totals }: { totals: TenantAnalytics["totals"] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Total users" value={totals.total} icon={Users} />
      <StatTile
        label="Active"
        value={totals.active}
        hint={`${pct(totals.active, totals.total)}% of total`}
        icon={UserCheck}
        tone="success"
      />
      <StatTile
        label="Inactive"
        value={totals.inactive}
        hint="Signed in once, not in window"
        icon={UserMinus}
        tone="warning"
      />
      <StatTile
        label="Never signed in"
        value={totals.never_signed_in}
        hint="Invited but never logged in"
        icon={UserX}
        tone="muted"
      />
    </div>
  );
}

/* =========================================================================
 * COMPACT OVERVIEW CARDS (mount on existing overview tabs)
 * ========================================================================= */

export function TenantUserAnalyticsCard({
  tenantId,
  onOpenFull,
}: {
  tenantId: string;
  onOpenFull?: () => void;
}) {
  const fn = useServerFn(getTenantUserAnalytics);
  const q = useQuery({
    queryKey: ["tenant-user-analytics-card", tenantId],
    queryFn: () => fn({ data: { tenantId, windowDays: 30 } }),
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Users
          </CardTitle>
          <CardDescription>Last 30 days · tenant scope</CardDescription>
        </div>
        {onOpenFull ? (
          <Button size="sm" variant="ghost" onClick={onOpenFull}>
            View details <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : q.error ? (
          <AnalyticsError error={q.error} onRetry={() => q.refetch()} compact />
        ) : q.data ? (
          <SummaryGrid totals={q.data.totals} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PlatformUserAnalyticsCard({
  onOpenFull,
}: {
  onOpenFull?: () => void;
}) {
  const fn = useServerFn(getPlatformUserAnalytics);
  const q = useQuery({
    queryKey: ["platform-user-analytics-card"],
    queryFn: () => fn({ data: { windowDays: 30 } }),
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Users (platform-wide)
          </CardTitle>
          <CardDescription>Last 30 days · all tenants</CardDescription>
        </div>
        {onOpenFull ? (
          <Button size="sm" variant="ghost" onClick={onOpenFull}>
            View details <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : q.error ? (
          <AnalyticsError error={q.error} onRetry={() => q.refetch()} compact />
        ) : q.data ? (
          <SummaryGrid totals={q.data.totals} />
        ) : null}
      </CardContent>
    </Card>
  );
}

/* =========================================================================
 * FULL DASHBOARDS
 * ========================================================================= */

export function TenantUserAnalyticsDashboard({ tenantId }: { tenantId: string }) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const fn = useServerFn(getTenantUserAnalytics);
  const q = useQuery({
    queryKey: ["tenant-user-analytics", tenantId, windowDays],
    queryFn: () => fn({ data: { tenantId, windowDays } }),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">People analytics</h2>
          <p className="text-sm text-muted-foreground">
            Users, activity, MFA &amp; SSO coverage — scoped to this tenant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WindowSelector value={windowDays} onChange={setWindowDays} />
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-[420px] w-full" />
      ) : q.error ? (
        <Card>
          <CardContent className="p-6">
            <AnalyticsError error={q.error} onRetry={() => q.refetch()} />
          </CardContent>
        </Card>
      ) : q.data ? (
        <DashboardBody
          totals={q.data.totals}
          trend={q.data.trend}
          roles={q.data.roles}
          groups={q.data.groups}
        />
      ) : null}
    </div>
  );
}

export function PlatformUserAnalyticsDashboard() {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const fn = useServerFn(getPlatformUserAnalytics);
  const q = useQuery({
    queryKey: ["platform-user-analytics", windowDays],
    queryFn: () => fn({ data: { windowDays } }),
    staleTime: 60_000,
  });

  const perTenantSorted = useMemo(() => {
    if (!q.data) return [];
    return [...q.data.per_tenant].sort((a, b) => b.active_users - a.active_users);
  }, [q.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">User analytics</h2>
          <p className="text-sm text-muted-foreground">
            Platform-wide users, activity, MFA &amp; SSO coverage, and a per-tenant slice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WindowSelector value={windowDays} onChange={setWindowDays} />
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-[420px] w-full" />
      ) : q.error ? (
        <Card>
          <CardContent className="p-6">
            <AnalyticsError error={q.error} onRetry={() => q.refetch()} />
          </CardContent>
        </Card>
      ) : q.data ? (
        <>
          <DashboardBody totals={q.data.totals} trend={q.data.trend} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-tenant breakdown</CardTitle>
              <CardDescription>
                Sorted by active users in the last {q.data.window_days} days.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Never signed in</TableHead>
                    <TableHead className="text-right">MFA %</TableHead>
                    <TableHead className="text-right">SSO %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perTenantSorted.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No tenants yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    perTenantSorted.map((row) => (
                      <TableRow key={row.tenant_id}>
                        <TableCell>
                          <div className="font-medium">{row.name}</div>
                          {row.slug ? (
                            <div className="text-xs text-muted-foreground">
                              /{row.slug}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.total_users.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Badge variant="secondary">{row.active_users}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.never_signed_in}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct(row.mfa_users, row.total_users)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct(row.sso_users, row.total_users)}%
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function DashboardBody({
  totals,
  trend,
  roles,
  groups,
}: {
  totals: TenantAnalytics["totals"];
  trend: TenantAnalytics["trend"];
  roles?: TenantAnalytics["roles"];
  groups?: TenantAnalytics["groups"];
}) {
  return (
    <>
      <SummaryGrid totals={totals} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Sign-ins over time</CardTitle>
            <CardDescription>Last sign-in timestamps, bucketed by day.</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart data={trend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Security coverage</CardTitle>
            <CardDescription>MFA enrolment and SSO sign-in usage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CoverageBar
              label="MFA enrolled"
              value={totals.mfa_enrolled}
              total={totals.total}
              icon={ShieldCheck}
            />
            <CoverageBar
              label="SSO users"
              value={totals.sso_users}
              total={totals.total}
              icon={KeyRound}
            />
          </CardContent>
        </Card>
      </div>

      {roles || groups ? (
        <div className="grid gap-4 md:grid-cols-2">
          {roles ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By role</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Users</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} className="py-4 text-center text-sm text-muted-foreground">
                          No roles assigned.
                        </TableCell>
                      </TableRow>
                    ) : (
                      roles.map((r) => (
                        <TableRow key={r.role}>
                          <TableCell className="capitalize">
                            {r.role.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.count}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {groups ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By group</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead className="text-right">Members</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} className="py-4 text-center text-sm text-muted-foreground">
                          No groups configured yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      groups.map((g) => (
                        <TableRow key={g.group_id}>
                          <TableCell>{g.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {g.count}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
