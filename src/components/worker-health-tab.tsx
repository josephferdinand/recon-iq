import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { notifyUserError } from "@/lib/user-feedback";
import {
  listCircuitBreakers,
  listRetryAttempts,
  listWorkerHeartbeats,
  resetBreaker,
} from "@/lib/worker-health.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, Zap, Server } from "lucide-react";

interface Props {
  /** If null/undefined → cross-tenant view (platform admin). */
  tenantId?: string | null;
}

function stateBadge(state: string) {
  if (state === "closed") return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Closed</Badge>;
  if (state === "half_open") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">Half-open</Badge>;
  return <Badge variant="destructive">Open</Badge>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    retry_scheduled: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    retry_exhausted: "bg-destructive/15 text-destructive border-destructive/30",
    breaker_open: "bg-destructive/15 text-destructive border-destructive/30",
    breaker_half_open_probe: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    breaker_closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  };
  return <Badge className={map[status] ?? "bg-muted text-muted-foreground"}>{status.replace(/_/g, " ")}</Badge>;
}

export function WorkerHealthTab({ tenantId }: Props) {
  const qc = useQueryClient();
  const listBreakersFn = useServerFn(listCircuitBreakers);
  const listRetriesFn = useServerFn(listRetryAttempts);
  const listHeartbeatsFn = useServerFn(listWorkerHeartbeats);
  const resetFn = useServerFn(resetBreaker);

  const breakersQ = useQuery({
    queryKey: ["worker-breakers", tenantId ?? "all"],
    queryFn: () => listBreakersFn({ data: { tenant_id: tenantId ?? null } }),
  });

  const retriesQ = useQuery({
    queryKey: ["worker-retries", tenantId ?? "all"],
    queryFn: () => listRetriesFn({ data: { tenant_id: tenantId ?? null, limit: 100 } }),
  });

  const heartbeatsQ = useQuery({
    queryKey: ["worker-heartbeats"],
    queryFn: () => listHeartbeatsFn(),
    enabled: !tenantId, // platform-only
  });

  const mReset = useMutation({
    mutationFn: (id: string) => resetFn({ data: { breaker_id: id } }),
    onSuccess: () => {
      toast.success("Breaker reset — closed.");
      qc.invalidateQueries({ queryKey: ["worker-breakers"] });
      qc.invalidateQueries({ queryKey: ["worker-retries"] });
    },
    onError: (e: any) => notifyUserError(e, "circuit-breaker reset"),
  });

  const breakers = breakersQ.data ?? [];
  const retries = retriesQ.data ?? [];
  const openCount = breakers.filter((b: any) => b.state === "open").length;
  const halfCount = breakers.filter((b: any) => b.state === "half_open").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <div><div className="text-2xl font-semibold">{breakersQ.isSuccess ? breakers.length : "—"}</div><div className="text-xs text-muted-foreground">Total breakers</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Zap className="h-5 w-5 text-destructive" />
            <div><div className="text-2xl font-semibold text-destructive">{breakersQ.isSuccess ? openCount : "—"}</div><div className="text-xs text-muted-foreground">Open (blocking)</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div><div className="text-2xl font-semibold">{breakersQ.isSuccess ? halfCount : "—"}</div><div className="text-xs text-muted-foreground">Half-open (probing)</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div><div className="text-2xl font-semibold">{breakersQ.isSuccess ? breakers.length - openCount - halfCount : "—"}</div><div className="text-xs text-muted-foreground">Healthy</div></div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="breakers">
        <TabsList>
          <TabsTrigger value="breakers">Circuit breakers</TabsTrigger>
          <TabsTrigger value="retries">Retry log</TabsTrigger>
          {!tenantId ? <TabsTrigger value="workers">Workers</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="breakers" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Circuit breakers</CardTitle>
                <CardDescription>Series evaluation: data-source breaker trips first, pipeline breaker second.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["worker-breakers"] })}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Scope</th>
                    <th className="px-4 py-2">Target</th>
                    <th className="px-4 py-2">State</th>
                    <th className="px-4 py-2">Failures</th>
                    <th className="px-4 py-2">Threshold</th>
                    <th className="px-4 py-2">Next probe</th>
                    <th className="px-4 py-2">Last error</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {breakers.map((b: any, index: number) => (
                    <tr key={b.id} className="border-b align-top">
                      <td className="px-4 py-2"><Badge variant="outline">{b.scope}</Badge></td>
                      <td className="px-4 py-2 text-xs">Target {index + 1}</td>
                      <td className="px-4 py-2">{stateBadge(b.state)}</td>
                      <td className="px-4 py-2">{b.consecutive_failures}</td>
                      <td className="px-4 py-2 text-muted-foreground">{b.failure_threshold}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {b.next_probe_at ? new Date(b.next_probe_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground max-w-[240px]">
                        {b.last_failure_needs_attention ? "Needs attention — review and retry" : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {b.state !== "closed" ? (
                          <Button size="sm" variant="outline" disabled={mReset.isPending}
                                  onClick={() => mReset.mutate(b.id)}>
                            <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Reset
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {breakersQ.isError ? (
                    <tr><td colSpan={8} role="alert" className="px-4 py-8 text-center text-warning">Worker health is temporarily unavailable. Please retry shortly. <Button variant="outline" size="sm" onClick={() => { void breakersQ.refetch(); }}>Retry</Button></td></tr>
                  ) : null}
                  {breakersQ.isSuccess && breakers.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No breakers recorded — all workers healthy.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="retries">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Retry transitions (audited)</CardTitle>
                <CardDescription>Each row corresponds to an entry in <code>audit_log</code> under <code>worker.step.*</code>.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["worker-retries"] })}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">When</th>
                    <th className="px-4 py-2">Step</th>
                    <th className="px-4 py-2">Attempt</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Breaker</th>
                    <th className="px-4 py-2">Backoff</th>
                    <th className="px-4 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {retries.map((r: any) => (
                    <tr key={r.id} className="border-b align-top">
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.attempted_at).toLocaleString()}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.step}</td>
                      <td className="px-4 py-2 text-xs">{r.attempt}/{r.max_attempts}</td>
                      <td className="px-4 py-2">{statusBadge(r.status)}</td>
                      <td className="px-4 py-2">{r.breaker_state ? stateBadge(r.breaker_state) : "—"}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.backoff_seconds ? `${r.backoff_seconds}s` : "—"}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground max-w-[320px]">{r.attempt_needs_attention ? "Delivery needs attention — review the job before retrying" : "—"}</td>
                    </tr>
                  ))}
                  {retriesQ.isError ? (
                    <tr><td colSpan={7} role="alert" className="px-4 py-8 text-center text-warning">Retry history is temporarily unavailable. Please retry shortly. <Button variant="outline" size="sm" onClick={() => { void retriesQ.refetch(); }}>Retry</Button></td></tr>
                  ) : null}
                  {retriesQ.isSuccess && retries.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No retry events in window.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {!tenantId ? (
          <TabsContent value="workers">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Server className="h-4 w-4" /> Worker heartbeats</CardTitle>
                <CardDescription>Most recent liveness reports from reconciliation workers.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Worker</th>
                      <th className="px-4 py-2">Kind</th>
                      <th className="px-4 py-2">Region</th>
                      <th className="px-4 py-2">Last seen</th>
                      <th className="px-4 py-2">In-flight</th>
                      <th className="px-4 py-2">Processed</th>
                      <th className="px-4 py-2">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(heartbeatsQ.data ?? []).map((h: any) => (
                      <tr key={h.worker_id} className="border-b">
                        <td className="px-4 py-2 font-mono text-xs">{h.worker_id}</td>
                        <td className="px-4 py-2 text-xs">{h.worker_kind}</td>
                        <td className="px-4 py-2 text-xs">{h.region ?? "—"}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(h.last_seen_at).toLocaleString()}</td>
                        <td className="px-4 py-2 text-xs">{h.in_flight}</td>
                        <td className="px-4 py-2 text-xs">{h.total_processed}</td>
                        <td className="px-4 py-2 text-xs">{h.total_failed}</td>
                      </tr>
                    ))}
                    {heartbeatsQ.isError ? (
                      <tr><td colSpan={7} role="alert" className="px-4 py-8 text-center text-warning">Worker activity is temporarily unavailable. Please retry shortly. <Button variant="outline" size="sm" onClick={() => { void heartbeatsQ.refetch(); }}>Retry</Button></td></tr>
                    ) : null}
                    {heartbeatsQ.isSuccess && (heartbeatsQ.data ?? []).length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No workers reporting.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
