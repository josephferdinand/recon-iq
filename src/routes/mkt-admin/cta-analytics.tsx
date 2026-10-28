import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMktCtaAnalytics } from "@/lib/mkt-admin.functions";
// PII boundary: CTA analytics uses the aggregate mkt_cta_analytics RPC via
// getMktCtaAnalytics — never reads mkt_cta_events rows directly.
import { BarChart3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/mkt-admin/cta-analytics")({
  ssr: false,
  component: CtaAnalyticsPage,
});

const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;

type CtaSummary = {
  restricted: boolean;
  totals: Record<string, number | null>;
  byCta: Array<{ cta_id: string; view: number | null; click: number | null; form_submit: number | null; pack_download: number | null }>;
  bySource: Array<{ source: string; total: number }>;
  byRegion: Array<{ region: string; total: number }>;
  recent: Array<{ day: string; event_type: string; total: number }>;
};

function CtaAnalyticsPage() {
  const [range, setRange] = useState<keyof typeof RANGES>("30d");
  const analyticsFn = useServerFn(getMktCtaAnalytics);

  const q = useQuery({
    queryKey: ["mkt-cta-events", range],
    queryFn: () => analyticsFn({ data: { days: RANGES[range] } }) as Promise<CtaSummary>,
  });

  const summary = q.data;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" /> Enterprise buyer CTAs
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold">CTA tracking</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Clicks, form submissions, and pack downloads for the buyer's guide and due-diligence pack — broken
            down by source and region.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={
                  "px-3 py-1.5 text-xs font-medium transition " +
                  (k === range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")
                }
              >
                {k}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["view", "click", "form_submit", "pack_download"] as const).map((k) => (
          <div key={k} className="rounded-lg border border-border bg-background p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.replace("_", " ")}</div>
            <div className="mt-1 font-display text-2xl font-semibold">{summary?.totals[k] ?? "—"}</div>
          </div>
        ))}
      </div>

      {summary?.restricted && <p className="text-xs text-muted-foreground">Counts below five are suppressed; event-level identifiers and campaign strings are not shown.</p>}

      <section className="rounded-lg border border-border bg-background">
        <header className="border-b border-border px-4 py-3 text-sm font-semibold">By CTA</header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">CTA</th>
                <th className="px-4 py-2 text-right">Views</th>
                <th className="px-4 py-2 text-right">Clicks</th>
                <th className="px-4 py-2 text-right">Submissions</th>
                <th className="px-4 py-2 text-right">Downloads</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.byCta.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No aggregate events in this window (low-count cells may be suppressed).</td>
                </tr>
              )}
              {summary?.byCta.map((cta) => (
                <tr key={cta.cta_id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{cta.cta_id}</td>
                  <td className="px-4 py-2 text-right">{cta.view ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{cta.click ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{cta.form_submit ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-semibold">{cta.pack_download ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-background">
          <header className="border-b border-border px-4 py-3 text-sm font-semibold">By source</header>
          <table className="w-full text-sm">
            <tbody>
              {summary?.bySource.slice(0, 15).map(({ source, total }) => (
                <tr key={source} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{source}</td>
                  <td className="px-4 py-2 text-right">{total}</td>
                </tr>
              ))}
              {(summary?.bySource.length ?? 0) === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-muted-foreground">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="rounded-lg border border-border bg-background">
          <header className="border-b border-border px-4 py-3 text-sm font-semibold">By region</header>
          <table className="w-full text-sm">
            <tbody>
              {summary?.byRegion.slice(0, 15).map(({ region, total }) => (
                <tr key={region} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{region}</td>
                  <td className="px-4 py-2 text-right">{total}</td>
                </tr>
              ))}
              {(summary?.byRegion.length ?? 0) === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-muted-foreground">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-background">
        <header className="border-b border-border px-4 py-3 text-sm font-semibold">Recent daily event totals</header>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {summary?.recent.map((row) => (
                <tr key={`${row.day}-${row.event_type}`} className="border-t border-border">
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{row.day}</td>
                  <td className="px-3 py-1.5 text-xs">{row.event_type}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
