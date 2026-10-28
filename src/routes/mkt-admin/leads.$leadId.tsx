import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { getLead, updateLeadStage, addLeadNote } from "@/lib/mkt-leads.functions";
import { myMktRoles } from "@/lib/mkt-admin.functions";
import { hasAnyMktRole, MKT_PII_WRITE_ROLES } from "@/lib/mkt-admin-roles";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/mkt-admin/leads/$leadId")({
  component: LeadDetail,
});

const STAGES = ["new","qualified","meeting_scheduled","proposal","negotiation","won","lost"] as const;

function LeadDetail() {
  const { leadId } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getLead);
  const stageFn = useServerFn(updateLeadStage);
  const noteFn = useServerFn(addLeadNote);
  const rolesFn = useServerFn(myMktRoles);
  const rolesQ = useQuery({ queryKey: ["mkt","roles"], queryFn: () => rolesFn({ data: undefined }) });
  const canWriteLead = hasAnyMktRole(rolesQ.data ?? [], MKT_PII_WRITE_ROLES);

  const q = useQuery({ queryKey: ["mkt","lead", leadId], queryFn: () => getFn({ data: { id: leadId } }) });
  const [note, setNote] = useState("");

  const stageMut = useMutation({
    mutationFn: (stage: typeof STAGES[number]) => stageFn({ data: { id: leadId, stage } }),
    onSuccess: () => { toast.success("Stage updated"); qc.invalidateQueries({ queryKey: ["mkt","lead", leadId] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const noteMut = useMutation({
    mutationFn: (body: string) => noteFn({ data: { id: leadId, body, kind: "note" } }),
    onSuccess: () => { toast.success("Note added"); setNote(""); qc.invalidateQueries({ queryKey: ["mkt","lead", leadId] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading || !q.data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const { lead, notes, tasks, files, activity } = q.data as unknown as {
    lead: {
      first_name: string; last_name: string; company: string; email: string;
      job_title: string | null; mobile: string | null; country: string | null;
      industry: string | null; company_size: string | null; monthly_txn_volume: string | null;
      current_recon_tool: string | null; erp_platform: string | null;
      source: string; category: string; stage: string; temperature: string; score: number;
      areas_of_interest: string[]; message: string | null; consent_at: string | null;
      metadata: Record<string, unknown> | null;
    };
    notes: { id: string; kind: string; body: string; created_at: string }[];
    tasks: { id: string; title: string; due_at: string | null }[];
    files: { id: string; filename: string }[];
    activity: { id: string; action: string; created_at: string }[];
  };
  const plan = typeof lead.metadata?.plan === "string" ? lead.metadata.plan : null;
  const purpose = typeof lead.metadata?.purpose === "string" ? lead.metadata.purpose : null;

  return (
    <div className="space-y-6">
      <Link to="/mkt-admin/leads" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All leads
      </Link>

      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">{lead.first_name} {lead.last_name}</h1>
          <p className="text-sm text-muted-foreground">{lead.job_title ? `${lead.job_title} · ` : ""}{lead.company}</p>
          <p className="text-xs text-muted-foreground">{lead.email}{lead.mobile ? ` · ${lead.mobile}` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge>{lead.temperature}</Badge>
          <div className="font-mono text-sm">Score {lead.score}</div>
          {canWriteLead ? (
            <select aria-label="Lead stage" value={lead.stage} onChange={(e) => stageMut.mutate(e.target.value as typeof STAGES[number])}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              {STAGES.map((s) => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
            </select>
          ) : <Badge variant="outline">{lead.stage.replace("_", " ")}</Badge>}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-2 space-y-6">
          <Card title="Inquiry">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Row k="Country" v={lead.country} />
              <Row k="Industry" v={lead.industry} />
              <Row k="Company size" v={lead.company_size} />
              <Row k="Volume" v={lead.monthly_txn_volume} />
              <Row k="Current tool" v={lead.current_recon_tool} />
              <Row k="ERP" v={lead.erp_platform} />
              <Row k="Source" v={lead.source} />
              <Row k="Category" v={lead.category} />
              <Row k="Plan" v={plan} />
              <Row k="Purpose" v={purpose} />
              <Row k="Consent recorded" v={lead.consent_at ? new Date(lead.consent_at).toLocaleString() : null} />
            </dl>
            {lead.areas_of_interest?.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Areas of interest</div>
                <div className="flex flex-wrap gap-2">
                  {lead.areas_of_interest.map((a: string) => <Badge key={a} variant="secondary">{a}</Badge>)}
                </div>
              </div>
            )}
            {lead.message && (
              <div className="mt-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Message</div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{lead.message}</p>
              </div>
            )}
          </Card>

          {canWriteLead && <Card title="Add note">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note, call summary, follow-up…" />
            <div className="mt-2 flex justify-end">
              <Button disabled={!note.trim() || noteMut.isPending} onClick={() => noteMut.mutate(note.trim())}>Add note</Button>
            </div>
            <div className="mt-4 space-y-3">
              {notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
              {notes.map((n) => (
                <div key={n.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>{n.kind}</span><span>{new Date(n.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
                </div>
              ))}
            </div>
          </Card>}
        </section>

        <aside className="space-y-6">
          <Card title="Tasks">
            {tasks.length === 0 ? <p className="text-xs text-muted-foreground">No tasks.</p> :
              <ul className="space-y-2 text-sm">
                {tasks.map((t) => (
                  <li key={t.id} className="rounded border border-border p-2">
                    <div className="font-medium">{t.title}</div>
                    {t.due_at && <div className="text-xs text-muted-foreground">Due {new Date(t.due_at).toLocaleDateString()}</div>}
                  </li>
                ))}
              </ul>}
          </Card>
          <Card title="Files">
            {files.length === 0 ? <p className="text-xs text-muted-foreground">No files.</p> :
              <ul className="space-y-1 text-sm">
                {files.map((f) => <li key={f.id}>{f.filename}</li>)}
              </ul>}
          </Card>
          <Card title="Activity">
            <ul className="space-y-2 text-xs">
              {activity.map((a) => (
                <li key={a.id} className="text-muted-foreground">
                  <span className="text-foreground">{a.action}</span> · {new Date(a.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className="text-sm">{v ?? <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}
