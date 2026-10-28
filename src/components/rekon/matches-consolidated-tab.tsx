import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listConsolidatedMatches } from "@/lib/nrl.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Layers, LayoutList } from "lucide-react";

type ConsolidatedRow = {
  match_id: string;
  match_key: string | null;
  rule_id: string | null;
  cardinality: string;
  confidence: number | null;
  side_a: Record<string, unknown> | null;
  side_b: Record<string, unknown> | null;
  side_c: Record<string, unknown> | null;
  deltas: { amount_delta: number; has_diff: boolean } | null;
  created_at: string;
};

/**
 * Consolidated Matches Tab — single-row view across sides A/B/(C),
 * styled to match Duco's "merged" matched-records grid.
 *
 * Toggle: consolidated ↔ split-by-side.
 */
export function MatchesConsolidatedTab({
  tenantId,
  runId,
}: { tenantId: string; runId?: string }) {
  const list = useServerFn(listConsolidatedMatches);
  const [mode, setMode] = useState<"consolidated" | "split">("consolidated");

  const q = useQuery({
    queryKey: ["consolidated-matches", tenantId, runId ?? "all"],
    queryFn: () => list({ data: { tenant_id: tenantId, run_id: runId, limit: 200 } }),
  });

  const rows = (q.data ?? []) as ConsolidatedRow[];
  const allKeys = Array.from(new Set(rows.flatMap(
    (r) => [...Object.keys(r.side_a ?? {}), ...Object.keys(r.side_b ?? {})]
  ))).slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Matched records</CardTitle>
          <CardDescription>
            One row per match — side A and side B data combined for fast review and write-off triage.
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={mode === "consolidated" ? "default" : "outline"}
            onClick={() => setMode("consolidated")}><Layers className="h-4 w-4 mr-1" />Consolidated</Button>
          <Button size="sm" variant={mode === "split" ? "default" : "outline"}
            onClick={() => setMode("split")}><LayoutList className="h-4 w-4 mr-1" />Split</Button>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
         rows.length === 0 ? <p className="text-sm text-muted-foreground">No matches yet. Example: Demo Bank trade FAL-TR-1001 ↔ Citi confirm 1250000.00 USD matched 100%.</p> :
         mode === "consolidated" ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Match</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Card.</TableHead>
                  {allKeys.map((k) => (
                    <TableHead key={k}>A.{k} / B.{k}</TableHead>
                  ))}
                  <TableHead>Δ Amount</TableHead>
                  <TableHead>Conf.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.match_id}>
                    <TableCell className="font-mono text-xs">{r.match_key ?? r.match_id.slice(0, 8)}</TableCell>
                    <TableCell><Badge variant="outline">{r.rule_id ?? "—"}</Badge></TableCell>
                    <TableCell>{r.cardinality}</TableCell>
                    {allKeys.map((k) => {
                      const a = r.side_a?.[k]; const b = r.side_b?.[k];
                      const diff = a !== b;
                      return (
                        <TableCell key={k} className={diff ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                          <div className="text-xs">
                            <div>{String(a ?? "—")}</div>
                            <div className="text-muted-foreground">{String(b ?? "—")}</div>
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell className={r.deltas?.has_diff ? "text-amber-600" : ""}>
                      {r.deltas?.amount_delta ?? 0}
                    </TableCell>
                    <TableCell>{r.confidence != null ? Math.round(r.confidence * 100) + "%" : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
         ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((r) => (
              <div key={r.match_id} className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground mb-1">{r.match_id.slice(0, 8)} · {r.rule_id ?? "—"}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><div className="font-medium">Side A</div><pre className="whitespace-pre-wrap">{JSON.stringify(r.side_a, null, 2)}</pre></div>
                  <div><div className="font-medium">Side B</div><pre className="whitespace-pre-wrap">{JSON.stringify(r.side_b, null, 2)}</pre></div>
                </div>
              </div>
            ))}
          </div>
         )}
      </CardContent>
    </Card>
  );
}
