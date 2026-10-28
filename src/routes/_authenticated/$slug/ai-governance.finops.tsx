import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { getFinOpsAnalytics } from "@/lib/ai-governance-routing.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, DollarSign, Activity, Users, Server } from "lucide-react";

export const Route = createFileRoute("/_authenticated/$slug/ai-governance/finops")({
  component: FinOpsPage,
  errorComponent: ({ error }) => (<div className="p-6 text-sm text-destructive">Failed: {error instanceof Error ? error.message : "An unexpected error occurred."}</div>),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

const fmtUsd = (n: number) => `$${(n ?? 0).toFixed(2)}`;
const fmtInt = (n: number) => (n ?? 0).toLocaleString();
const fmtPct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;

function FinOpsPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/ai-governance/finops" });
  const getTenant = useServerFn(getTenantBySlug);
  const tenantQ = useQuery({ queryKey: ["tenant", slug], queryFn: () => getTenant({ data: { slug } }) });
  const tenantId = tenantQ.data?.id;

  const fetchFinOps = useServerFn(getFinOpsAnalytics);
  const fo = useQuery({
    queryKey: ["finops", tenantId],
    queryFn: () => fetchFinOps({ data: { tenant_id: tenantId!, days: 30 } }),
    enabled: !!tenantId,
  });

  if (!tenantId) return <div className="p-6 text-sm text-muted-foreground">Loading tenant…</div>;
  if (fo.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading FinOps…</div>;
  if (!fo.data) return <div className="p-6 text-sm text-destructive">No data.</div>;
  const k = fo.data.kpis;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$slug/ai-governance" params={{ slug }}><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Cost &amp; Usage Analytics</h1>
          <p className="text-sm text-muted-foreground">Last 30 days. Drill down by provider, model, feature, and user.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Total requests" value={fmtInt(k.requests)} icon={<Activity className="h-4 w-4" />} />
        <Kpi label="Total tokens" value={fmtInt(k.tokens_total)} icon={<Activity className="h-4 w-4" />} />
        <Kpi label="Spend (period)" value={fmtUsd(k.cost_total)} icon={<DollarSign className="h-4 w-4" />} />
        <Kpi label="Spend (MTD)" value={fmtUsd(k.cost_month)} icon={<DollarSign className="h-4 w-4" />} />
        <Kpi label="Avg $/request" value={fmtUsd(k.avg_cost_per_request)} icon={<DollarSign className="h-4 w-4" />} />
        <Kpi label="Avg tokens/req" value={fmtInt(Math.round(k.avg_tokens_per_request))} icon={<Activity className="h-4 w-4" />} />
        <Kpi label="Success rate" value={fmtPct(k.success_rate)} icon={<Activity className="h-4 w-4" />} />
        <Kpi label="Failure rate" value={fmtPct(k.failure_rate)} icon={<Activity className="h-4 w-4" />} tone={k.failure_rate > 0.05 ? "warn" : "ok"} />
        <Kpi label="Input tokens" value={fmtInt(k.tokens_in)} icon={<Activity className="h-4 w-4" />} />
        <Kpi label="Output tokens" value={fmtInt(k.tokens_out)} icon={<Activity className="h-4 w-4" />} />
        <Kpi label="Cached tokens" value={fmtInt(k.cached_tokens)} icon={<Activity className="h-4 w-4" />} />
        <Kpi label="Active models" value={fmtInt(k.active_models)} icon={<Server className="h-4 w-4" />} />
        <Kpi label="Active providers" value={fmtInt(k.active_providers)} icon={<Server className="h-4 w-4" />} />
        <Kpi label="Active users" value={fmtInt(k.active_users)} icon={<Users className="h-4 w-4" />} />
      </div>

      <Tabs defaultValue="provider">
        <TabsList>
          <TabsTrigger value="provider">By Provider</TabsTrigger>
          <TabsTrigger value="model">By Model</TabsTrigger>
          <TabsTrigger value="feature">By Feature</TabsTrigger>
          <TabsTrigger value="user">By User</TabsTrigger>
          <TabsTrigger value="trend">Trend</TabsTrigger>
        </TabsList>
        <TabsContent value="provider"><BreakdownTable rows={fo.data.byProvider} keyLabel="Provider" keyField="provider" /></TabsContent>
        <TabsContent value="model"><BreakdownTable rows={fo.data.byModel} keyLabel="Model" keyField="model" /></TabsContent>
        <TabsContent value="feature"><BreakdownTable rows={fo.data.byFeature} keyLabel="Feature" keyField="feature" /></TabsContent>
        <TabsContent value="user"><BreakdownTable rows={fo.data.byUser} keyLabel="User" keyField="user_id" /></TabsContent>
        <TabsContent value="trend">
          <Card>
            <CardHeader><CardTitle>Daily spend &amp; tokens</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th>Date</th><th className="text-right">Requests</th><th className="text-right">Tokens</th><th className="text-right">Cost</th></tr></thead>
                <tbody>
                  {fo.data.byDay.map((r: any) => (
                    <tr key={r.date} className="border-t border-border/50">
                      <td className="py-1">{r.date}</td>
                      <td className="text-right">{fmtInt(r.count)}</td>
                      <td className="text-right">{fmtInt(r.tokens_in + r.tokens_out)}</td>
                      <td className="text-right">{fmtUsd(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-xs font-medium text-muted-foreground">{label}{icon}</CardTitle></CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function BreakdownTable({ rows, keyLabel, keyField }: { rows: any[]; keyLabel: string; keyField: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>Breakdown by {keyLabel}</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>{keyLabel}</th>
              <th className="text-right">Requests</th>
              <th className="text-right">Tokens</th>
              <th className="text-right">Cached</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const total = rows.reduce((s, r) => s + (r.cost ?? 0), 0) || 1;
              return rows.map((r) => (
                <tr key={String(r[keyField])} className="border-t border-border/50">
                  <td className="py-1"><Badge variant="outline">{String(r[keyField])}</Badge></td>
                  <td className="text-right">{fmtInt(r.count)}</td>
                  <td className="text-right">{fmtInt(r.tokens_in + r.tokens_out)}</td>
                  <td className="text-right">{fmtInt(r.cached)}</td>
                  <td className="text-right">{fmtUsd(r.cost)}</td>
                  <td className="text-right">{fmtPct((r.cost ?? 0) / total)}</td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
