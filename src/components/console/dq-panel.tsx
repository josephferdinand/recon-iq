/**
 * DqPanel — Data Quality overview for the Domain Console.
 * Reuses phase7 DQ rules + results, renders a dimension heatmap + top failing rules,
 * and offers a click-to-drill dialog with ABAC-masked violation samples + audit trail.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, ChevronRight } from "lucide-react";
import { EmptyStateAction } from "@/components/console-header";
import { listDqRules, listDqResults } from "@/lib/phase7-data-quality.functions";
import { listDqRuleViolations } from "@/lib/domain-console.functions";
import { DomainAuditTrail } from "@/components/console/domain-audit-trail";

type RuleRow = {
  id: string;
  name: string;
  target_table?: string | null;
  severity?: string | null;
  dimension?: string | null;
  enabled?: boolean;
};
type ResultRow = {
  id: string;
  dq_rule_id: string;
  run_at: string;
  violations?: number | null;
  score?: number | null;
  severity?: string | null;
};

const DIMENSIONS = ["completeness", "uniqueness", "validity", "consistency", "timeliness", "accuracy"] as const;

export function DqPanel({ tenantId }: { tenantId: string }) {
  const [drillRuleId, setDrillRuleId] = useState<string | null>(null);
  const lr = useServerFn(listDqRules);
  const lres = useServerFn(listDqResults);
  const rulesQ = useQuery({
    queryKey: ["dq-panel-rules", tenantId],
    queryFn: () => lr({ data: { tenant_id: tenantId, enabledOnly: false } }),
  });
  const resQ = useQuery({
    queryKey: ["dq-panel-results", tenantId],
    queryFn: () => lres({ data: { tenant_id: tenantId, limit: 500 } }),
  });

  if (rulesQ.isLoading || resQ.isLoading) return <Skeleton className="h-64 w-full" />;
  const rules = (rulesQ.data ?? []) as RuleRow[];
  const results = (resQ.data ?? []) as ResultRow[];

  if (rules.length === 0 && results.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Data Quality</CardTitle>
          <CardDescription>Rule-driven checks across the 6 DAMA-DMBOK quality dimensions.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyStateAction
            title="No DQ rules configured yet"
            description="Start with a completeness rule on your master data, or install a regulatory pack that ships with rules preconfigured."
            actions={[
              { label: "Browse packs", href: "../marketplace", variant: "default" },
              { label: "DQ guide", href: "/docs/18_data_prep_staging.md" },
            ]}
          />
        </CardContent>
      </Card>
    );
  }

  // Score by dimension
  const byDim: Record<string, { pass: number; fail: number; violations: number }> = {};
  DIMENSIONS.forEach((d) => (byDim[d] = { pass: 0, fail: 0, violations: 0 }));
  const ruleMap = new Map(rules.map((r) => [r.id, r]));
  results.forEach((res) => {
    const rule = ruleMap.get(res.dq_rule_id);
    const dim = String(rule?.dimension ?? "validity").toLowerCase();
    if (!byDim[dim]) byDim[dim] = { pass: 0, fail: 0, violations: 0 };
    if ((res.violations ?? 0) > 0) byDim[dim].fail += 1;
    else byDim[dim].pass += 1;
    byDim[dim].violations += Number(res.violations ?? 0);
  });

  // Top failing rules
  const failByRule: Record<string, { count: number; violations: number }> = {};
  results.forEach((r) => {
    if ((r.violations ?? 0) <= 0) return;
    failByRule[r.dq_rule_id] = failByRule[r.dq_rule_id] ?? { count: 0, violations: 0 };
    failByRule[r.dq_rule_id].count += 1;
    failByRule[r.dq_rule_id].violations += Number(r.violations ?? 0);
  });
  const topFail = Object.entries(failByRule)
    .map(([id, v]) => ({ id, name: ruleMap.get(id)?.name ?? "(deleted rule)", table: ruleMap.get(id)?.target_table ?? "—", ...v }))
    .sort((a, b) => b.violations - a.violations)
    .slice(0, 8);

  const overallScore = (() => {
    const totalRuns = results.length || 1;
    const passRuns = results.filter((r) => (r.violations ?? 0) === 0).length;
    return Math.round((passRuns / totalRuns) * 100);
  })();

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricTile label="DQ score" value={`${overallScore}`} suffix="/100" tone={overallScore > 90 ? "positive" : overallScore > 70 ? "warning" : "danger"} />
        <MetricTile label="Rules" value={rules.length} suffix={` (${rules.filter((r) => r.enabled).length} on)`} />
        <MetricTile label="Runs last window" value={results.length} />
        <MetricTile label="Total violations" value={results.reduce((a, r) => a + Number(r.violations ?? 0), 0)} tone="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quality by dimension</CardTitle>
          <CardDescription>DAMA-DMBOK — Completeness, Uniqueness, Validity, Consistency, Timeliness, Accuracy.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {DIMENSIONS.map((d) => {
            const s = byDim[d];
            const total = s.pass + s.fail;
            const pct = total ? Math.round((s.pass / total) * 100) : 100;
            const tone = pct >= 95 ? "bg-emerald-500/10 border-emerald-500/30" : pct >= 80 ? "bg-amber-500/10 border-amber-500/30" : "bg-rose-500/10 border-rose-500/30";
            return (
              <div key={d} className={`rounded-md border p-3 ${tone}`}>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium capitalize">{d}</span>
                  <Badge variant="outline">{pct}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {s.pass} pass · {s.fail} fail · {s.violations.toLocaleString()} violations
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top failing rules</CardTitle>
          <CardDescription>Click a rule to drill into violation samples with ABAC masking + audit trail.</CardDescription>
        </CardHeader>
        <CardContent>
          {topFail.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failing rules — clean bill of health.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Rule</th><th>Table</th><th className="text-right">Fail runs</th><th className="text-right">Violations</th><th />
                </tr>
              </thead>
              <tbody>
                {topFail.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t cursor-pointer hover:bg-muted/40"
                    onClick={() => setDrillRuleId(r.id)}
                  >
                    <td className="py-1">{r.name}</td>
                    <td><code className="text-xs">{r.table}</code></td>
                    <td className="text-right">{r.count}</td>
                    <td className="text-right font-mono">{r.violations.toLocaleString()}</td>
                    <td className="text-right pr-1"><ChevronRight className="inline h-4 w-4 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <DomainAuditTrail tenantId={tenantId} resourceType="dq_rules" />

      <DqDrillDialog
        tenantId={tenantId}
        ruleId={drillRuleId}
        onClose={() => setDrillRuleId(null)}
      />
    </div>
  );
}

function MetricTile({ label, value, suffix, tone }: { label: string; value: string | number; suffix?: string; tone?: "positive" | "warning" | "danger" }) {
  const toneClass = tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : tone === "warning" ? "text-amber-600 dark:text-amber-400" : tone === "danger" ? "text-rose-600 dark:text-rose-400" : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}{suffix && <span className="text-sm text-muted-foreground ml-1">{suffix}</span>}</p>
    </div>
  );
}

// ---- Drill-down dialog: violation samples with ABAC masking ----
type ViolationsPayload = {
  rule: { id: string; name: string; target_schema: string; target_table: string; severity: string | null; expression: string };
  results: { id: string; run_at: string; violations: number; severity: string | null; samples: Record<string, unknown>[] }[];
  abac: { predicates_evaluated: number; masked_cells: number; masked_fields: string[] };
};

function DqDrillDialog({
  tenantId,
  ruleId,
  onClose,
}: {
  tenantId: string;
  ruleId: string | null;
  onClose: () => void;
}) {
  const fn = useServerFn(listDqRuleViolations);
  const q = useQuery({
    enabled: !!ruleId,
    queryKey: ["dq-violations", tenantId, ruleId],
    queryFn: () => fn({ data: { tenant_id: tenantId, dq_rule_id: ruleId!, limit: 15 } }),
  });
  const payload = q.data as ViolationsPayload | undefined;

  return (
    <Dialog open={!!ruleId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {payload?.rule.name ?? "Rule"}
            {payload?.rule.severity && (
              <Badge variant="outline" className="capitalize">{payload.rule.severity}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {payload ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <code>{payload.rule.target_schema}.{payload.rule.target_table}</code>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  {payload.abac.predicates_evaluated} ABAC predicate{payload.abac.predicates_evaluated === 1 ? "" : "s"} evaluated
                </span>
                {payload.abac.masked_cells > 0 && (
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                    {payload.abac.masked_cells} cell{payload.abac.masked_cells === 1 ? "" : "s"} masked
                    {payload.abac.masked_fields.length > 0 && <> · {payload.abac.masked_fields.join(", ")}</>}
                  </span>
                )}
              </span>
            ) : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading || !payload ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <ScrollArea className="h-[520px] pr-3">
              <div className="space-y-3">
                <div className="rounded-md border p-2 text-xs">
                  <p className="uppercase text-[10px] text-muted-foreground mb-1">Expression</p>
                  <code className="whitespace-pre-wrap break-all">{payload.rule.expression}</code>
                </div>
                {payload.results.length === 0 && (
                  <p className="text-sm text-muted-foreground">No result rows on record.</p>
                )}
                {payload.results.map((r) => (
                  <div key={r.id} className="rounded-md border p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{new Date(r.run_at).toLocaleString()}</span>
                      <Badge variant={r.violations > 0 ? "destructive" : "outline"}>{r.violations} violation{r.violations === 1 ? "" : "s"}</Badge>
                    </div>
                    {r.samples.length === 0 ? (
                      <p className="text-muted-foreground">No sample rows captured.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              {Object.keys(r.samples[0]).map((k) => (
                                <th key={k} className="pr-3 pb-1">{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.samples.slice(0, 8).map((row, i) => (
                              <tr key={i} className="border-t">
                                {Object.keys(r.samples[0]).map((k) => (
                                  <td key={k} className="pr-3 py-1 font-mono">{String(row[k] ?? "")}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div>
              <p className="text-sm font-medium mb-2">Audit trail for this rule</p>
              <ScrollArea className="h-[520px] pr-3">
                <DomainAuditTrail tenantId={tenantId} resourceType="dq_rules" resourceId={ruleId!} compact />
              </ScrollArea>
            </div>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
