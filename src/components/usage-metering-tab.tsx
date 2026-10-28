import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AiUsageTab } from "@/components/ai-usage-tab";
import { Database, Gauge, HardDrive, ListChecks, Wallet } from "lucide-react";

interface Props { tenantId: string; canWrite: boolean }

/**
 * Customer-facing usage metering dashboard.
 * Aggregates AI spend, storage, throughput, and active recons against the tenant's plan.
 */
export function UsageMeteringTab({ tenantId, canWrite }: Props) {
  // Subscription + plan (best-effort, falls back gracefully)
  const planQ = useQuery({
    queryKey: ["plan", tenantId],
    queryFn: async () => {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status, current_period_end, price_id")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const { data: tiers } = await supabase
        .from("pricing_tiers")
        .select("code, name, monthly_price_cents, currency, records_per_month, active_recons, connectors")
        .order("position", { ascending: true });
      const tier = (tiers ?? []).find((t: any) => t.stripe_price_id && sub?.price_id && t.stripe_price_id === sub.price_id)
        ?? (tiers ?? [])[0]
        ?? null;
      return { sub, tier };
    },
  });

  // Storage — sum of uploaded bytes for the tenant
  const storageQ = useQuery({
    queryKey: ["usage-storage", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_data_source_uploads")
        .select("size_bytes, row_count")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      const bytes = (data ?? []).reduce((s: number, r: any) => s + Number(r.size_bytes ?? 0), 0);
      const rows = (data ?? []).reduce((s: number, r: any) => s + Number(r.row_count ?? 0), 0);
      return { bytes, rows, files: data?.length ?? 0 };
    },
  });

  // Throughput — recon runs and rows processed (30d)
  const throughputQ = useQuery({
    queryKey: ["usage-throughput", tenantId],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("recon_runs")
        .select("total_rows, matched_count, exception_count, status, started_at")
        .eq("tenant_id", tenantId)
        .gte("started_at", since);
      if (error) throw error;
      const totalRows = (data ?? []).reduce((s: number, r: any) => s + Number(r.total_rows ?? 0), 0);
      const matched = (data ?? []).reduce((s: number, r: any) => s + Number(r.matched_count ?? 0), 0);
      const exceptions = (data ?? []).reduce((s: number, r: any) => s + Number(r.exception_count ?? 0), 0);
      return { runs: data?.length ?? 0, totalRows, matched, exceptions };
    },
  });

  // Active recon count
  const reconsQ = useQuery({
    queryKey: ["usage-recons", tenantId],
    queryFn: async () => {
      const { count } = await supabase
        .from("recon_definitions")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      return count ?? 0;
    },
  });

  const tier = planQ.data?.tier;
  const planRecordsCap = Number(tier?.records_per_month ?? 0);
  const planReconsCap = Number(tier?.active_recons ?? 0);
  const recordsPct = planRecordsCap > 0 ? Math.min(100, ((throughputQ.data?.totalRows ?? 0) / planRecordsCap) * 100) : 0;
  const reconsPct = planReconsCap > 0 ? Math.min(100, ((reconsQ.data ?? 0) / planReconsCap) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-primary" /> Plan & limits
          </CardTitle>
          <CardDescription>
            Live usage against your current subscription. Soft caps trigger alerts; hard caps block writes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Plan</div>
            <div className="mt-1 text-lg font-semibold">{tier?.name ?? "—"}</div>
            <Badge variant="outline" className="mt-1 text-[10px]">{tier?.code ?? "no plan"}</Badge>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Status</div>
            <div className="mt-1 text-lg font-semibold capitalize">{planQ.data?.sub?.status ?? "trial"}</div>
            {planQ.data?.sub?.current_period_end && (
              <div className="text-[11px] text-muted-foreground">
                Renews {new Date(planQ.data.sub.current_period_end).toLocaleDateString()}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Active recons</div>
            <div className="mt-1 text-lg font-semibold">
              {reconsQ.data ?? 0}{planReconsCap > 0 ? ` / ${planReconsCap}` : ""}
            </div>
            {planReconsCap > 0 && <Progress value={reconsPct} className="mt-2" />}
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Records (30d)</div>
            <div className="mt-1 text-lg font-semibold">
              {(throughputQ.data?.totalRows ?? 0).toLocaleString()}
              {planRecordsCap > 0 ? ` / ${planRecordsCap.toLocaleString()}` : ""}
            </div>
            {planRecordsCap > 0 && <Progress value={recordsPct} className="mt-2" />}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HardDrive className="h-4 w-4" /> Storage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatBytes(storageQ.data?.bytes ?? 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {(storageQ.data?.files ?? 0).toLocaleString()} files · {(storageQ.data?.rows ?? 0).toLocaleString()} rows
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gauge className="h-4 w-4" /> Throughput (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{(throughputQ.data?.runs ?? 0).toLocaleString()} runs</div>
            <div className="text-xs text-muted-foreground">
              {(throughputQ.data?.matched ?? 0).toLocaleString()} matched · {(throughputQ.data?.exceptions ?? 0).toLocaleString()} breaks
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="h-4 w-4" /> Match rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {matchRate(throughputQ.data?.matched, throughputQ.data?.exceptions)}
            </div>
            <div className="text-xs text-muted-foreground">Of all reconciled records in the last 30 days.</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" /> AI consumption
          </CardTitle>
          <CardDescription>Detailed token, model, and budget controls for Copilot, AIDP and Agentic AI.</CardDescription>
        </CardHeader>
        <CardContent>
          <AiUsageTab tenantId={tenantId} canWrite={canWrite} />
        </CardContent>
      </Card>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function matchRate(matched?: number, exceptions?: number): string {
  const m = Number(matched ?? 0);
  const e = Number(exceptions ?? 0);
  const total = m + e;
  if (!total) return "—";
  return `${((m / total) * 100).toFixed(1)}%`;
}
