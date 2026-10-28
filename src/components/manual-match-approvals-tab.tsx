import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, X } from "lucide-react";
import { listManualMatchApprovals, decideManualMatch } from "@/lib/manual-match-approvals.functions";
import { QueryErrorFeedback, safeActionErrorMessage } from "@/components/query-error-feedback";

export function ManualMatchApprovalsTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listManualMatchApprovals);
  const decide = useServerFn(decideManualMatch);
  const [reason, setReason] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["manual-match-approvals", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId, status: "pending" } }),
    staleTime: 30_000,
  });

  const mD = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "rejected" }) =>
      decide({ data: { id: v.id, tenant_id: tenantId, decision: v.decision, reject_reason: reason[v.id] } }),
    onSuccess: () => { toast.success("Decision recorded"); qc.invalidateQueries({ queryKey: ["manual-match-approvals", tenantId] }); },
    onError: (e: unknown) => toast.error(safeActionErrorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Manual match — maker / checker queue</CardTitle>
        <CardDescription>4-eyes approval for human-proposed matches. Maker cannot approve their own.</CardDescription>
      </CardHeader>
      {q.isError ? <div className="px-4 pb-4"><QueryErrorFeedback error={q.error} onRetry={q.refetch} resource="Manual match approvals" /></div> : null}
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">Proposed</th><th className="px-4 py-2">Cardinality</th><th className="px-4 py-2">Rationale</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Decide</th></tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r: any) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.proposed_at).toLocaleString()}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.cardinality}</td>
                <td className="px-4 py-2 text-xs">{r.rationale ?? "—"}</td>
                <td className="px-4 py-2"><Badge variant="outline">{r.status}</Badge></td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <input className="rounded border px-2 py-1 text-xs" placeholder="e.g. Match below Demo Bank tolerance threshold — needs 4-eyes"
                      value={reason[r.id] ?? ""} onChange={(e) => setReason((s) => ({ ...s, [r.id]: e.target.value }))} />
                    <Button size="sm" variant="outline" onClick={() => mD.mutate({ id: r.id, decision: "rejected" })} disabled={mD.isPending}>
                      <X className="h-3 w-3" />
                    </Button>
                    <Button size="sm" onClick={() => mD.mutate({ id: r.id, decision: "approved" })} disabled={mD.isPending}>
                      Approve
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {q.isSuccess && q.data.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No pending manual matches.</td></tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
