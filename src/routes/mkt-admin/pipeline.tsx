import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listLeads } from "@/lib/mkt-leads.functions";

export const Route = createFileRoute("/mkt-admin/pipeline")({
  component: Pipeline,
});

const STAGES = ["new","qualified","meeting_scheduled","proposal","negotiation","won","lost"] as const;
const TITLES: Record<string,string> = { new: "New", qualified: "Qualified", meeting_scheduled: "Meeting", proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost" };

function Pipeline() {
  const fn = useServerFn(listLeads);
  const q = useQuery({ queryKey: ["mkt","pipeline"], queryFn: () => fn({ data: { limit: 200 } }) });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold">Pipeline</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
        {STAGES.map((s) => {
          const rows = (q.data ?? []).filter((r) => r.stage === s);
          return (
            <div key={s} className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{TITLES[s]}</div>
                <div className="text-xs font-mono">{rows.length}</div>
              </div>
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link to="/mkt-admin/leads/$leadId" params={{ leadId: r.id }}
                      className="block rounded border border-border p-2 text-xs hover:border-primary/50">
                      <div className="font-medium text-foreground">{r.company}</div>
                      <div className="text-muted-foreground">{r.first_name} {r.last_name}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">Score {r.score} · {r.temperature}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
