import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { leadKpis } from "@/lib/mkt-leads.functions";
import { chatKpis } from "@/lib/mkt-admin.functions";

export const Route = createFileRoute("/mkt-admin/analytics")({
  component: Analytics,
});

function Analytics() {
  const leadFn = useServerFn(leadKpis);
  const chatFn = useServerFn(chatKpis);
  const l = useQuery({ queryKey: ["mkt","an","leads"], queryFn: () => leadFn({ data: undefined }) });
  const c = useQuery({ queryKey: ["mkt","an","chat"], queryFn: () => chatFn({ data: undefined }) });

  const days = Object.entries(l.data?.daily ?? {}).sort(([a],[b]) => a.localeCompare(b));
  const max = Math.max(1, ...days.map(([, v]) => v));

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-semibold">Analytics</h1>

      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Leads per day</h3>
        <div className="flex h-40 items-end gap-1">
          {days.map(([d, v]) => (
            <div key={d} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t bg-primary/60" style={{ height: `${(v / max) * 100}%` }} title={`${d}: ${v}`} />
              <div className="text-[9px] text-muted-foreground">{d.slice(5)}</div>
            </div>
          ))}
          {days.length === 0 && <div className="w-full text-center text-sm text-muted-foreground">No leads yet.</div>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI cost</h3>
        <p className="text-sm">Total AI spend: <b>${c.data?.totalCost != null ? c.data.totalCost.toFixed(4) : "Unavailable"}</b> across {c.data?.totalTokens ?? 0} tokens.</p>
      </section>
    </div>
  );
}
