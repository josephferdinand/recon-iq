import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runAgent, listAgentRuns } from "@/lib/agent.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Bot, ShieldCheck, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { QueryErrorFeedback, safeActionErrorMessage } from "@/components/query-error-feedback";

const PRESETS = [
  "Triage P1 and P2 breaks created in the last 7 days; suggest root causes and next actions.",
  "Find duplicate breaks (same reason and amounts within 2%) and recommend which to write off.",
  "Identify breaks aged > 7 days that lack a root cause and suggest investigation priorities.",
  "Summarise this week's reconciliation health: match rate, top failing reconciliations, ageing trends.",
];

export function AgentTab({ tenantId, aiEnabled }: { tenantId: string; canWrite: boolean; aiEnabled: boolean }) {
  const qc = useQueryClient();
  const [objective, setObjective] = useState(PRESETS[0]);
  const autonomy = "read_only" as const;
  const [openId, setOpenId] = useState<string | null>(null);
  const fetchRuns = useServerFn(listAgentRuns);
  const requestAnalysis = useServerFn(runAgent);

  const runs = useQuery({
    queryKey: ["agent-runs", tenantId],
    queryFn: () => fetchRuns({ data: { tenant_id: tenantId, limit: 25 } }),
    staleTime: 30_000,
  });

  const run = useMutation({
    mutationFn: () => requestAnalysis({ data: { tenant_id: tenantId, objective, autonomy } }),
    onSuccess: (r: any) => { if (r.status === "failed") toast.error("Analysis did not complete. Review the recorded run."); else if (r.status === "succeeded") toast.success("Analysis completed"); else toast.info("Analysis request recorded; completion is pending."); setOpenId(r.id); qc.invalidateQueries({ queryKey: ["agent-runs", tenantId] }); },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : "";
      toast.error(/AI is disabled|provider not configured|residency|budget/iu.test(message)
        ? "Agent analysis is unavailable under the current AI configuration or limits. Ask your tenant administrator to review Agent settings."
        : safeActionErrorMessage(e));
    },
  });

  const visibleRuns = !runs.isError && !runs.isFetching ? runs.data : undefined;
  const selected = visibleRuns?.find((r: any) => r.id === openId) ?? visibleRuns?.[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> ReconIQ Reconciliation Agent</CardTitle>
            <CardDescription>Request read-only analysis of permitted reconciliation data and review recorded outcomes. AI configuration, provider readiness and access are checked by the runtime.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!aiEnabled && (
              <div className="rounded border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
                AI is disabled for this tenant. Analysis is unavailable; contact your tenant administrator about AI settings.
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <Button key={p} size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal py-2 text-left text-xs" onClick={() => setObjective(p)}>{p}</Button>
              ))}
            </div>
            <Textarea rows={4} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="e.g. Triage Demo Bank Nostro USD breaks > 24h: classify root cause, propose match, escalate to Cash Ops." />
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline"><ShieldCheck className="mr-2 h-3 w-3" aria-hidden />Read-only analysis</Badge>
              <Button onClick={() => run.mutate()} disabled={run.isPending || !aiEnabled || !objective.trim()}>
                {run.isPending ? "Requesting analysis…" : "Request analysis"}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Write autonomy is unavailable on this surface. Tenant AI being enabled alone does not prove provider/capability readiness. Review actual recorded traces and status; a failed request is not completed work.
            </div>
          </CardContent>
        </Card>

        {selected && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4" />
                Run <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide">{String(selected.id).slice(0, 8).toUpperCase()}</span>
                <Badge variant={selected.status === "succeeded" ? "default" : selected.status === "failed" ? "destructive" : "secondary"}>{selected.status}</Badge>
              </CardTitle>
              <CardDescription>{new Date(selected.created_at).toLocaleString()}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground">Objective</div>
                <div className="mt-1 rounded bg-muted/40 p-2 text-sm">{selected.objective}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Summary</div>
                <div className="mt-1 whitespace-pre-wrap rounded bg-muted/40 p-3 text-sm">{selected.summary ?? "Summary not recorded"}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Tool trace {Array.isArray(selected.steps) ? `(${selected.steps.length} recorded steps)` : "unavailable"}</div>
                <div className="mt-1 space-y-1">
                  {(Array.isArray(selected.steps) ? selected.steps : []).map((s: any, i: number) => (
                    <details key={i} className="rounded border bg-card text-xs">
                      <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5">
                        <ChevronRight className="h-3 w-3" />
                        <Badge variant="outline" className="text-[10px]">{s.tool}</Badge>
                        <span className="text-muted-foreground">{s.at ? new Date(s.at).toLocaleTimeString() : ""}</span>
                      </summary>
                      <div className="border-t bg-muted/30 p-2">
                        <div className="text-[10px] uppercase text-muted-foreground">Input</div>
                        <pre className="overflow-x-auto">{JSON.stringify(s.input, null, 2)}</pre>
                        <div className="mt-1 text-[10px] uppercase text-muted-foreground">Output</div>
                        <pre className="overflow-x-auto">{JSON.stringify(s.output, null, 2)}</pre>
                      </div>
                    </details>
                  ))}
                  {Array.isArray(selected.steps) && selected.steps.length === 0 ? <div className="text-xs text-muted-foreground">No tool calls were recorded for this run.</div> : null}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader><CardTitle className="text-sm">Recent analysis runs</CardTitle><Button size="sm" variant="outline" disabled={runs.isFetching} onClick={() => { void runs.refetch(); }}><RefreshCw className="mr-2 h-3 w-3" aria-hidden />Refresh history</Button></CardHeader>
        <CardContent className="space-y-1">
          {runs.isError ? <QueryErrorFeedback error={runs.error} onRetry={runs.refetch} resource="Agent run history" /> : !visibleRuns ? <p role="status" className="text-sm text-muted-foreground">Loading visible analysis runs…</p> : null}
          {(visibleRuns ?? []).map((r: any) => (
            <button key={r.id} onClick={() => setOpenId(r.id)}
              className={`w-full rounded border p-2 text-left text-xs hover:bg-muted/40 ${selected?.id === r.id ? "border-primary" : ""}`}>
              <div className="flex items-center gap-2">
                <Badge variant={r.status === "succeeded" ? "default" : r.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">{r.status}</Badge>
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-1 line-clamp-2">{r.objective}</div>
            </button>
          ))}
          {visibleRuns?.length === 0 ? <div className="text-sm text-muted-foreground">No agent analysis runs are visible to your account. Reconciliation runs and agent analyses have separate histories.</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
