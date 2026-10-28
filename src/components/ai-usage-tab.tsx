import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBudget, upsertBudget, getUsageStats } from "@/lib/ai-usage.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DollarSign, Activity, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export function AiUsageTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const getB = useServerFn(getBudget);
  const upB = useServerFn(upsertBudget);
  const getU = useServerFn(getUsageStats);

  const bQ = useQuery({ queryKey: ["ai-budget", tenantId], queryFn: () => getB({ data: { tenant_id: tenantId } }) });
  const uQ = useQuery({ queryKey: ["ai-usage", tenantId], queryFn: () => getU({ data: { tenant_id: tenantId, days: 30 } }) });

  const [b, setB] = useState<any>(null);
  useEffect(() => { if (bQ.data) setB(bQ.data); }, [bQ.data]);

  const m = useMutation({
    mutationFn: (v: any) => upB({ data: v }),
    onSuccess: () => { toast.success("Budget saved"); qc.invalidateQueries({ queryKey: ["ai-budget", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (bQ.isError || uQ.isError) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive opacity-50" />
        <div className="mt-3 text-sm font-medium text-destructive">Failed to load usage data</div>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => { bQ.refetch(); uQ.refetch(); }}>
          Retry
        </Button>
      </div>
    );
  }

  if (!b || !uQ.data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader><div className="h-4 w-24 rounded bg-muted" /></CardHeader>
              <CardContent><div className="h-8 w-16 rounded bg-muted" /></CardContent>
            </Card>
          ))}
        </div>
        <Card className="animate-pulse"><CardContent className="h-48" /></Card>
      </div>
    );
  }

  const dailyPct = Math.min(100, (uQ.data.todayCost / (b.daily_max_cost_usd || 1)) * 100);
  const monthPct = Math.min(100, (uQ.data.monthCost / (b.monthly_max_cost_usd || 1)) * 100);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4" /> Today</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">${uQ.data.todayCost.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{uQ.data.todayTokens.toLocaleString()} tokens</div>
            <Progress value={dailyPct} className="mt-3" />
            <div className="mt-1 text-xs text-muted-foreground">{dailyPct.toFixed(0)}% of ${Number(b.daily_max_cost_usd).toFixed(2)} daily cap</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><DollarSign className="h-4 w-4" /> This month</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">${uQ.data.monthCost.toFixed(2)}</div>
            <Progress value={monthPct} className="mt-3" />
            <div className="mt-1 text-xs text-muted-foreground">{monthPct.toFixed(0)}% of ${Number(b.monthly_max_cost_usd).toFixed(2)} monthly cap</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">By scope (30d)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {uQ.data.byScope.map((s: any) => (
              <div key={s.scope} className="flex justify-between">
                <Badge variant="outline" className="uppercase">{s.scope}</Badge>
                <span>${Number(s.cost).toFixed(2)} · {s.count}</span>
              </div>
            ))}
            {uQ.data.byScope.length === 0 ? <div className="text-muted-foreground">No usage yet. Once ReconIQ teams run Copilot or AIDP, model spend appears here grouped by tenant/scope.</div> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Budget</CardTitle>
          <CardDescription>Hard stop blocks AI calls when reached. Alert percentage triggers notifications.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {[
            ["daily_max_tokens", "Daily tokens"],
            ["daily_max_cost_usd", "Daily USD"],
            ["monthly_max_cost_usd", "Monthly USD"],
            ["alert_at_pct", "Alert at %"],
            ["hard_stop_at_pct", "Hard stop at %"],
          ].map(([k, label]) => (
            <div key={k}>
              <Label>{label}</Label>
              <Input type="number" value={b[k as string]} disabled={!canWrite}
                onChange={(e) => setB({ ...b, [k as string]: Number(e.target.value) })} />
            </div>
          ))}
          <div className="md:col-span-3 flex justify-end">
            <Button disabled={!canWrite || m.isPending} onClick={() => m.mutate(b)}>Save</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top models (30d)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Model</th><th className="px-4 py-2">Calls</th><th className="px-4 py-2">Tokens</th><th className="px-4 py-2">Cost</th></tr>
            </thead>
            <tbody>
              {uQ.data.byModel.map((r: any) => (
                <tr key={r.model} className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">{r.model}</td>
                  <td className="px-4 py-2">{r.count}</td>
                  <td className="px-4 py-2">{Number(r.tokens).toLocaleString()}</td>
                  <td className="px-4 py-2">${Number(r.cost).toFixed(4)}</td>
                </tr>
              ))}
              {uQ.data.byModel.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No AI calls recorded yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
