import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, X, Sparkles } from "lucide-react";
import {
  listProposedMatches, reviewProposedMatch, bulkReviewProposedMatches,
} from "@/lib/proposed-matches.functions";

export function ProposedMatchesTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProposedMatches);
  const review = useServerFn(reviewProposedMatch);
  const bulk = useServerFn(bulkReviewProposedMatches);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["proposed-matches", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId, status: "pending" } }),
    staleTime: 30_000,
  });

  const mR = useMutation({
    mutationFn: (v: { id: string; decision: "accepted" | "rejected" }) =>
      review({ data: { tenant_id: tenantId, id: v.id, decision: v.decision } }),
    onSuccess: () => { toast.success("Decision recorded"); qc.invalidateQueries({ queryKey: ["proposed-matches", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mB = useMutation({
    mutationFn: (decision: "accepted" | "rejected") =>
      bulk({ data: { tenant_id: tenantId, ids: Array.from(sel), decision } }),
    onSuccess: (r: any) => { toast.success(`${r.count} processed`); setSel(new Set()); qc.invalidateQueries({ queryKey: ["proposed-matches", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Proposed auto-matches</CardTitle>
            <CardDescription>ML-suggested matches ranked by confidence. Accept or reject — accepted rows become real matches and exceptions auto-close.</CardDescription>
          </div>
          {sel.size > 0 ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => mB.mutate("rejected")} disabled={mB.isPending}>
                <X className="mr-1 h-3 w-3" /> Reject {sel.size}
              </Button>
              <Button size="sm" onClick={() => mB.mutate("accepted")} disabled={mB.isPending}>
                <Check className="mr-1 h-3 w-3" /> Accept {sel.size}
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-8 px-2"></th>
                <th className="px-4 py-2">Confidence</th>
                <th className="px-4 py-2">Cardinality</th>
                <th className="px-4 py-2">Definition</th>
                <th className="px-4 py-2">Members</th>
                <th className="px-4 py-2">Rule hint</th>
                <th className="px-4 py-2 text-right">Decide</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-2"><Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} /></td>
                  <td className="px-4 py-2">
                    <Badge variant={r.ml_score >= 0.9 ? "default" : r.ml_score >= 0.7 ? "secondary" : "outline"}>
                      {Math.round(r.ml_score * 100)}%
                    </Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.cardinality}</td>
                  <td className="px-4 py-2 text-xs">{r.definition?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{Array.isArray(r.members) ? r.members.length : 0} rows</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.rule_hint ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => mR.mutate({ id: r.id, decision: "rejected" })} disabled={mR.isPending}>
                        <X className="h-3 w-3" />
                      </Button>
                      <Button size="sm" onClick={() => mR.mutate({ id: r.id, decision: "accepted" })} disabled={mR.isPending}>
                        <Check className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No pending proposals. ML matcher runs after each recon.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
