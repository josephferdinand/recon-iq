import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listLeads } from "@/lib/mkt-leads.functions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/mkt-admin/leads")({
  component: Leads,
});

const TEMP_COLOR: Record<string, string> = { hot: "bg-red-500/10 text-red-500", warm: "bg-amber-500/10 text-amber-500", cold: "bg-sky-500/10 text-sky-500" };

function Leads() {
  const fn = useServerFn(listLeads);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("");
  const [temp, setTemp] = useState<string>("");
  const query = useQuery({
    queryKey: ["mkt","leads",{ q, stage, temp }],
    queryFn: () => fn({ data: { q: q || undefined, stage: stage || undefined, temperature: (temp || undefined) as "hot"|"warm"|"cold"|undefined } }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Leads</h1>
        <p className="text-sm text-muted-foreground">All inbound leads from the marketing site and ReconIQ Copilot.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Search leads" placeholder="Search email, company, name…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select aria-label="Filter leads by stage" value={stage} onChange={(e) => setStage(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="">All stages</option>
          {["new","qualified","meeting_scheduled","proposal","negotiation","won","lost"].map((s) => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
        </select>
        <select aria-label="Filter leads by temperature" value={temp} onChange={(e) => setTemp(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="">All temperatures</option>
          <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Company</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Stage</th>
              <th className="px-4 py-2 text-left">Temp</th>
              <th className="px-4 py-2 text-right">Score</th>
              <th className="px-4 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!query.isLoading && (query.data ?? []).length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No leads yet.</td></tr>}
            {(query.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-2"><Link to="/mkt-admin/leads/$leadId" params={{ leadId: r.id }} className="font-medium text-foreground hover:underline">{r.first_name} {r.last_name}</Link></td>
                <td className="px-4 py-2 text-muted-foreground">{r.company}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.email}</td>
                <td className="px-4 py-2"><Badge variant="outline">{r.stage.replace("_"," ")}</Badge></td>
                <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs ${TEMP_COLOR[r.temperature]}`}>{r.temperature}</span></td>
                <td className="px-4 py-2 text-right font-mono">{r.score}</td>
                <td className="px-4 py-2 text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
