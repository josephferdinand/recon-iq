/**
 * AuditChainVerifyPanel — auditor-first UX for verifying the WORM audit chain.
 *
 * Shows dual-region status per recent anchor + summary tiles + an export
 * button that produces a signed verify receipt (JSON) suitable for external
 * audit files.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, FileDown, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  verifyDualRegionAnchors,
  type DualRegionAnchorRow,
} from "@/lib/worm-dual-region.functions";

const STATUS_TONE: Record<DualRegionAnchorRow["status"], string> = {
  matched: "border-emerald-500/40 text-emerald-600",
  missing_secondary: "border-amber-500/40 text-amber-600",
  hash_mismatch: "border-rose-500/40 text-rose-600",
};

const STATUS_LABEL: Record<DualRegionAnchorRow["status"], string> = {
  matched: "matched",
  missing_secondary: "missing secondary",
  hash_mismatch: "hash mismatch",
};

export function AuditChainVerifyPanel() {
  const verify = useServerFn(verifyDualRegionAnchors);
  const q = useQuery({
    queryKey: ["worm-dual-region", 30],
    queryFn: () => verify({ data: { limit: 30 } }),
    staleTime: 30_000,
  });

  const summary = q.data?.summary ?? { total: 0, matched: 0, missing_secondary: 0, hash_mismatch: 0 };
  const rows = q.data?.rows ?? [];
  const overallOk = summary.total > 0 && summary.matched === summary.total;

  const receipt = useMemo(
    () => ({
      generated_at: q.data?.checked_at,
      summary,
      rows,
    }),
    [q.data?.checked_at, rows, summary],
  );

  function exportReceipt() {
    try {
      const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-chain-verify-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Verify receipt exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  }

  if (q.isLoading) return <Skeleton className="mt-4 h-96 w-full" />;

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Anchors checked"
          value={summary.total}
          hint="last 30 days"
          icon={ShieldCheck}
        />
        <Kpi
          label="Matched"
          value={summary.matched}
          hint="primary = secondary"
          icon={CheckCircle2}
          toneClass="text-emerald-600"
        />
        <Kpi
          label="Missing secondary"
          value={summary.missing_secondary}
          hint="re-publish candidate"
          icon={Clock}
          toneClass={summary.missing_secondary > 0 ? "text-amber-600" : undefined}
        />
        <Kpi
          label="Hash mismatch"
          value={summary.hash_mismatch}
          hint="P0 investigate"
          icon={AlertTriangle}
          toneClass={summary.hash_mismatch > 0 ? "text-rose-600" : "text-emerald-600"}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Audit-chain dual-region verify
                <Badge variant="outline" className={overallOk ? STATUS_TONE.matched : STATUS_TONE.hash_mismatch}>
                  {overallOk ? "chain intact" : "review required"}
                </Badge>
              </CardTitle>
              <CardDescription>
                Cross-checks the daily audit anchor (DB + R2) against the independent secondary witness.
                Signed verify receipt is downloadable for auditor evidence files.
              </CardDescription>
            </div>
            <Button size="sm" onClick={exportReceipt} disabled={rows.length === 0}>
              <FileDown className="h-4 w-4 mr-1" /> Export receipt
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No anchors on file yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-3">Anchored</th>
                    <th className="py-1 pr-3">Last audit id</th>
                    <th className="py-1 pr-3">Primary hash</th>
                    <th className="py-1 pr-3">Secondary at</th>
                    <th className="py-1 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.anchor_id} className="border-t">
                      <td className="py-1 pr-3 font-mono">{new Date(r.anchored_at).toISOString().slice(0, 10)}</td>
                      <td className="py-1 pr-3 font-mono">{r.last_audit_id}</td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[16rem]">{r.primary_hash.slice(0, 24)}…</td>
                      <td className="py-1 pr-3 text-muted-foreground">
                        {r.secondary_at ? new Date(r.secondary_at).toISOString().slice(0, 10) : "—"}
                      </td>
                      <td className="py-1 pr-3">
                        <Badge variant="outline" className={STATUS_TONE[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  toneClass,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  toneClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className={`text-xl font-semibold mt-1 ${toneClass ?? ""}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}
