/**
 * ChaosScorecardPanel — Chaos drill scorecard for the Scale Console.
 * Aggregates last-drill RTO/RPO vs target, MTTR, category coverage, SOC2/ISO/DORA mapping.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyStateAction } from "@/components/console-header";
import { CheckCircle2, XCircle, Calendar, Target } from "lucide-react";
import { listChaosCatalog, listChaosDrills } from "@/lib/phase8-chaos-drills.functions";

type CatalogItem = {
  code: string;
  name: string;
  description?: string | null;
  category: string;
  enabled?: boolean;
};
type Drill = {
  id: string;
  drill_code: string;
  scheduled_for?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  status: string;
  rto_seconds?: number | null;
  rpo_seconds?: number | null;
  summary?: string | null;
};

const TARGET_RTO_SEC = 3600; // 1h target
const TARGET_RPO_SEC = 900; // 15m target

export function ChaosScorecardPanel({ tenantId }: { tenantId: string }) {
  const lc = useServerFn(listChaosCatalog);
  const ld = useServerFn(listChaosDrills);
  const catQ = useQuery({ queryKey: ["chaos-cat"], queryFn: () => lc({ data: {} }) });
  const drillQ = useQuery({
    queryKey: ["chaos-drills-sc", tenantId],
    queryFn: () => ld({ data: { tenant_id: tenantId, limit: 50 } }),
  });

  if (catQ.isLoading || drillQ.isLoading) return <Skeleton className="h-64 w-full" />;
  const catalog = (catQ.data ?? []) as CatalogItem[];
  const drills = ((drillQ.data ?? []) as Drill[]).slice().sort((a, b) => {
    const ta = new Date(a.scheduled_for ?? a.started_at ?? 0).getTime();
    const tb = new Date(b.scheduled_for ?? b.started_at ?? 0).getTime();
    return tb - ta;
  });

  const last = drills[0];
  const passed = drills.filter((d) => d.status === "passed" || d.status === "success").length;
  const failed = drills.filter((d) => d.status === "failed").length;
  const passRate = drills.length > 0 ? Math.round((passed / drills.length) * 100) : 0;
  const avgRto =
    drills
      .filter((d) => d.rto_seconds != null)
      .reduce((a, d) => a + Number(d.rto_seconds ?? 0), 0) /
    Math.max(1, drills.filter((d) => d.rto_seconds != null).length);
  const avgRpo =
    drills
      .filter((d) => d.rpo_seconds != null)
      .reduce((a, d) => a + Number(d.rpo_seconds ?? 0), 0) /
    Math.max(1, drills.filter((d) => d.rpo_seconds != null).length);

  // Category coverage — which drill categories have been exercised
  const drillCodes = new Set(drills.map((d) => d.drill_code));
  const catByCategory: Record<string, { total: number; exercised: number; items: CatalogItem[] }> =
    {};
  catalog.forEach((c) => {
    catByCategory[c.category] = catByCategory[c.category] ?? { total: 0, exercised: 0, items: [] };
    catByCategory[c.category].total += 1;
    catByCategory[c.category].items.push(c);
    if (drillCodes.has(c.code)) catByCategory[c.category].exercised += 1;
  });

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Tile label="Drills 90d" value={drills.length} />
        <Tile
          label="Pass rate"
          value={`${passRate}%`}
          tone={passRate >= 90 ? "positive" : passRate >= 70 ? "warning" : "danger"}
        />
        <Tile label="Passed" value={passed} tone="positive" />
        <Tile label="Failed" value={failed} tone={failed > 0 ? "danger" : "default"} />
        <Tile
          label="Avg RTO"
          value={avgRto ? `${Math.round(avgRto / 60)}m` : "—"}
          tone={avgRto && avgRto <= TARGET_RTO_SEC ? "positive" : "warning"}
        />
        <Tile
          label="Avg RPO"
          value={avgRpo ? `${Math.round(avgRpo / 60)}m` : "—"}
          tone={avgRpo && avgRpo <= TARGET_RPO_SEC ? "positive" : "warning"}
        />
      </div>

      {last ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  Last drill: <code className="text-sm">{last.drill_code}</code>
                  <Badge
                    variant={
                      last.status === "passed" || last.status === "success"
                        ? "default"
                        : last.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {last.status}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  <Calendar className="h-3 w-3 inline mr-1" />
                  {last.scheduled_for ? new Date(last.scheduled_for).toLocaleString() : "—"}
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" disabled>
                Schedule next
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-3 text-sm">
            <ScoreBox
              label="RTO achieved"
              actual={last.rto_seconds ?? null}
              target={TARGET_RTO_SEC}
            />
            <ScoreBox
              label="RPO achieved"
              actual={last.rpo_seconds ?? null}
              target={TARGET_RPO_SEC}
            />
            <div className="rounded-md border p-3">
              <p className="text-[11px] uppercase text-muted-foreground">Summary</p>
              <p className="text-xs mt-1">{last.summary ?? "No summary provided."}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyStateAction
          title="No chaos drills on record"
          description="Schedule a drill to prove RTO/RPO against DORA Art. 25, SOC 2 CC7.5, and ISO 22301."
          actions={[
            { label: "DR runbook", href: "/docs/runbooks/01_dr_restore.md" },
            { label: "Chaos catalog", href: "/docs/20_disaster_recovery.md" },
          ]}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Category coverage</CardTitle>
          <CardDescription>
            Which blast-radius categories have been exercised at least once in the window.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          {Object.entries(catByCategory).map(([cat, v]) => {
            const pct = v.total > 0 ? Math.round((v.exercised / v.total) * 100) : 0;
            return (
              <div key={cat} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm capitalize">{cat}</span>
                  <Badge variant={pct === 100 ? "default" : pct > 0 ? "secondary" : "outline"}>
                    {v.exercised}/{v.total}
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 bg-muted rounded overflow-hidden">
                  <div
                    className={
                      pct >= 80
                        ? "h-full bg-emerald-500"
                        : pct >= 40
                          ? "h-full bg-amber-500"
                          : "h-full bg-rose-500"
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex gap-1 flex-wrap mt-2">
                  {v.items.map((i) => (
                    <Badge
                      key={i.code}
                      variant="outline"
                      className={`text-[10px] ${drillCodes.has(i.code) ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300" : ""}`}
                    >
                      {drillCodes.has(i.code) ? (
                        <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />
                      ) : (
                        <XCircle className="h-2.5 w-2.5 inline mr-0.5 opacity-40" />
                      )}
                      {i.code}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compliance mapping</CardTitle>
          <CardDescription>
            Each drill maps to a control across recognised frameworks.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3 text-sm">
          {[
            { framework: "SOC 2", control: "CC7.5", desc: "Business continuity plans are tested" },
            { framework: "ISO 22301", control: "8.5", desc: "Exercising and testing" },
            { framework: "DORA", control: "Art. 25", desc: "Testing of ICT tools and systems" },
            {
              framework: "NIST CSF",
              control: "RC.RP-1",
              desc: "Recovery plan is executed during or after an event",
            },
            {
              framework: "PCI DSS",
              control: "12.10.2",
              desc: "Test incident response plan at least annually",
            },
            {
              framework: "HIPAA",
              control: "§164.308(a)(7)",
              desc: "Contingency plan testing and revision",
            },
          ].map((m) => (
            <div key={`${m.framework}-${m.control}`} className="rounded-md border p-3">
              <p className="font-medium text-sm flex items-center gap-2">
                <Target className="h-3.5 w-3.5" />
                {m.framework} · <code>{m.control}</code>
              </p>
              <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "positive" | "warning" | "danger" | "default";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-800 dark:text-emerald-300"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-300"
        : tone === "danger"
          ? "text-rose-700 dark:text-rose-300"
          : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}

function ScoreBox({
  label,
  actual,
  target,
}: {
  label: string;
  actual: number | null;
  target: number;
}) {
  const pass = actual != null && actual <= target;
  const val = actual != null ? `${Math.round(actual / 60)}m` : "—";
  const tgt = `${Math.round(target / 60)}m`;
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <span
          className={`text-2xl font-semibold ${pass ? "text-emerald-800 dark:text-emerald-300" : actual != null ? "text-rose-700 dark:text-rose-300" : ""}`}
        >
          {val}
        </span>
        <span className="text-xs text-muted-foreground">target ≤ {tgt}</span>
      </div>
      {actual != null && (
        <Badge className="mt-1" variant={pass ? "default" : "destructive"}>
          {pass ? (
            <>
              <CheckCircle2 className="h-3 w-3 mr-1" />
              met
            </>
          ) : (
            <>
              <XCircle className="h-3 w-3 mr-1" />
              breached
            </>
          )}
        </Badge>
      )}
    </div>
  );
}
