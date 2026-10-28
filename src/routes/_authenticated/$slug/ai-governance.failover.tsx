import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { listLlmProviders } from "@/lib/llm.functions";
import {
  listModelRoutes,
  upsertModelRoute,
  runFailoverTest,
  listFailoverTestRuns,
} from "@/lib/ai-governance-routing.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Play, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/$slug/ai-governance/failover")({
  component: FailoverPage,
  errorComponent: ({ error }) => (<div className="p-6 text-sm text-destructive">Failed: {error instanceof Error ? error.message : "An unexpected error occurred."}</div>),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

const STRATEGIES = ["priority", "availability", "latency", "cost", "performance", "manual", "policy"] as const;
const SCENARIOS = [
  "primary", "fallback1", "fallback2", "health", "connectivity",
  "auth", "throughput", "latency", "full_failover", "rate_limit", "timeout",
] as const;

function FailoverPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/ai-governance/failover" });
  const qc = useQueryClient();
  const getTenant = useServerFn(getTenantBySlug);
  const tenantQ = useQuery({ queryKey: ["tenant", slug], queryFn: () => getTenant({ data: { slug } }) });
  const tenantId = tenantQ.data?.id;

  const listRoutes = useServerFn(listModelRoutes);
  const listProviders = useServerFn(listLlmProviders);
  const listRuns = useServerFn(listFailoverTestRuns);
  const upsertRoute = useServerFn(upsertModelRoute);
  const runTest = useServerFn(runFailoverTest);

  const routesQ = useQuery({
    queryKey: ["model-routes", tenantId],
    queryFn: () => listRoutes({ data: { tenant_id: tenantId! } }),
    enabled: !!tenantId,
  });
  const provQ = useQuery({
    queryKey: ["llm-providers-tenant", tenantId],
    queryFn: () => listProviders({ data: { scope: "tenant", tenant_id: tenantId! } }),
    enabled: !!tenantId,
  });
  const runsQ = useQuery({
    queryKey: ["failover-runs", tenantId],
    queryFn: () => listRuns({ data: { tenant_id: tenantId! } }),
    enabled: !!tenantId,
  });

  const upsertM = useMutation({
    mutationFn: (v: any) => upsertRoute({ data: v }),
    onSuccess: () => {
      toast.success("Route saved");
      qc.invalidateQueries({ queryKey: ["model-routes", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const testM = useMutation({
    mutationFn: (v: any) => runTest({ data: v }),
    onSuccess: (r: any) => {
      toast[r.status === "pass" ? "success" : "error"](`Test ${r.status} (${r.latency_ms}ms)${r.error_message ? `: ${r.error_message}` : ""}`);
      qc.invalidateQueries({ queryKey: ["failover-runs", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Test failed"),
  });

  if (!tenantId) return <div className="p-6 text-sm text-muted-foreground">Loading tenant…</div>;
  if (routesQ.isLoading || provQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const providers = provQ.data ?? [];
  const providersById = new Map<string, any>(providers.map((p: any) => [p.id, p]));
  const featureKeys = routesQ.data?.featureKeys ?? [];
  const routes = routesQ.data?.routes ?? [];
  const routesByFeature = new Map<string, any>(routes.map((r: any) => [r.feature_key, r]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$slug/ai-governance" params={{ slug }}><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Failover &amp; Model Management</h1>
          <p className="text-sm text-muted-foreground">Configure primary + fallback providers per feature and run validation tests.</p>
        </div>
      </div>

      <Tabs defaultValue="routes">
        <TabsList>
          <TabsTrigger value="routes">Routing</TabsTrigger>
          <TabsTrigger value="console">Validation Console</TabsTrigger>
          <TabsTrigger value="history">Test History</TabsTrigger>
        </TabsList>

        <TabsContent value="routes" className="space-y-3">
          {featureKeys.map((fk: string) => {
            const r = routesByFeature.get(fk) ?? {
              tenant_id: tenantId, feature_key: fk, primary_provider_id: null,
              fallback1_provider_id: null, fallback2_provider_id: null,
              routing_strategy: "priority", is_active: true,
            };
            return (
              <Card key={fk}>
                <CardHeader>
                  <CardTitle className="text-base">{fk}</CardTitle>
                  <CardDescription>Strategy: {r.routing_strategy} · {r.is_active ? "Active" : "Disabled"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-5 items-end">
                    <ProvSlot label="Primary" value={r.primary_provider_id} providers={providers}
                      onChange={(v) => upsertM.mutate({ ...r, primary_provider_id: v })} />
                    <ProvSlot label="Fallback 1" value={r.fallback1_provider_id} providers={providers}
                      onChange={(v) => upsertM.mutate({ ...r, fallback1_provider_id: v })} />
                    <ProvSlot label="Fallback 2" value={r.fallback2_provider_id} providers={providers}
                      onChange={(v) => upsertM.mutate({ ...r, fallback2_provider_id: v })} />
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">Strategy</div>
                      <Select value={r.routing_strategy} onValueChange={(v) => upsertM.mutate({ ...r, routing_strategy: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{STRATEGIES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={r.is_active} onCheckedChange={(v) => upsertM.mutate({ ...r, is_active: v })} />
                      <span className="text-xs">Active</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="console">
          <ValidationConsole
            tenantId={tenantId}
            routes={routes}
            providers={providers}
            onRun={(v) => testM.mutate(v)}
            busy={testM.isPending}
          />
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle>Recent failover test runs</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th>When</th><th>Scenario</th><th>Provider</th><th>Status</th><th className="text-right">Latency</th><th>Error</th></tr></thead>
                <tbody>
                  {(runsQ.data ?? []).map((r: any) => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="py-1">{new Date(r.created_at).toLocaleString()}</td>
                      <td><Badge variant="outline">{r.scenario}</Badge></td>
                      <td>{providersById.get(r.provider_used)?.display_name ?? "—"}</td>
                      <td>{r.status === "pass"
                        ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />pass</span>
                        : <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" />{r.status}</span>}</td>
                      <td className="text-right">{r.latency_ms ?? 0} ms</td>
                      <td className="text-xs text-muted-foreground">{r.error_message ?? ""}</td>
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

function ProvSlot({ label, value, providers, onChange }: { label: string; value: string | null; providers: any[]; onChange: (v: string | null) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <Select value={value ?? "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
        <SelectTrigger><SelectValue placeholder="Not configured" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— none —</SelectItem>
          {providers.map((p) => (<SelectItem key={p.id} value={p.id}>{p.display_name} ({p.model})</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ValidationConsole({ tenantId, routes, providers, onRun, busy }: { tenantId: string; routes: any[]; providers: any[]; onRun: (v: any) => void; busy: boolean }) {
  const [routeId, setRouteId] = useState<string>(routes[0]?.id ?? "");
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>("primary");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Failover Validation Console</CardTitle>
        <CardDescription>Fire synthetic probes; every attempt is audit-logged.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3 items-end">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Feature route</div>
            <Select value={routeId} onValueChange={setRouteId}>
              <SelectTrigger><SelectValue placeholder="Pick a route" /></SelectTrigger>
              <SelectContent>{routes.map((r) => (<SelectItem key={r.id} value={r.id}>{r.feature_key}</SelectItem>))}</SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Scenario</div>
            <Select value={scenario} onValueChange={(v) => setScenario(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SCENARIOS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
            </Select>
          </div>
          <Button disabled={busy || !routeId} onClick={() => onRun({ tenant_id: tenantId, route_id: routeId, scenario })}>
            <Play className="mr-2 h-4 w-4" /> Run test
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Configured providers: {providers.length}. Tests validate provider configuration and record an audit row.
          Network-probe scenarios (rate_limit, timeout) execute structurally — production probes are wired through the model factory.
        </p>
      </CardContent>
    </Card>
  );
}
