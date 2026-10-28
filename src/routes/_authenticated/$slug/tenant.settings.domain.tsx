/**
 * Phase 6 — Domain Depth Console
 *
 * Single tenant-admin route that surfaces Phase 6 capabilities:
 *  • Master data: securities / counterparties / accounts
 *  • Event-driven recon triggers
 *  • Rule simulation & backtest
 *  • ABAC predicates (attribute scoping on top of RBAC)
 *  • Auditor Copilot persona prompts
 *
 * All writes are tenant-scoped via RLS; reads call typed server fns.
 */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, Zap, ShieldCheck, FlaskConical, UserCog } from "lucide-react";
import { ConsoleHeader, type ConsoleKpi } from "@/components/console-header";
import { DqPanel } from "@/components/console/dq-panel";
import { LineagePanel } from "@/components/console/lineage-panel";
import { getTenantBySlug } from "@/lib/tenants.functions";
import {
  listMasterSecurities, listMasterCounterparties, listMasterAccounts,
} from "@/lib/phase6-masters.functions";
import { listEventTriggers } from "@/lib/phase6-event-triggers.functions";
import { listSimulations } from "@/lib/phase6-simulation.functions";
import { listAbacPredicates } from "@/lib/phase6-abac.functions";
import { listCopilotPersonas } from "@/lib/phase6-personas.functions";

export const Route = createFileRoute("/_authenticated/$slug/tenant/settings/domain")({
  component: DomainConsole,
});

function DomainConsole() {
  const { slug } = useParams({ from: "/_authenticated/$slug/tenant/settings/domain" });
  const getTenant = useServerFn(getTenantBySlug);
  const { data: tenant } = useQuery({
    queryKey: ["tenant", slug],
    queryFn: () => getTenant({ data: { slug } }),
  });
  const tenantId = (tenant as { id?: string } | undefined)?.id ?? null;

  return (
    <div className="p-6 space-y-4">
      {!tenantId ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <DomainHeader tenantId={tenantId} slug={slug} />
          <Tabs defaultValue="masters" className="w-full">
            <TabsList className="grid grid-cols-4 lg:grid-cols-7 max-w-4xl">
              <TabsTrigger value="masters">Master data</TabsTrigger>
              <TabsTrigger value="dq">Data Quality</TabsTrigger>
              <TabsTrigger value="lineage">Lineage</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="sims">Simulations</TabsTrigger>
              <TabsTrigger value="abac">ABAC</TabsTrigger>
              <TabsTrigger value="personas">Personas</TabsTrigger>
            </TabsList>
            <TabsContent value="masters"><MastersTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="dq"><DqPanel tenantId={tenantId} /></TabsContent>
            <TabsContent value="lineage"><LineagePanel tenantId={tenantId} /></TabsContent>
            <TabsContent value="events"><EventTriggersTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="sims"><SimulationsTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="abac"><AbacTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="personas"><PersonasTab /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function DomainHeader({ tenantId, slug }: { tenantId: string; slug: string }) {
  const lsec = useServerFn(listMasterSecurities);
  const lcp = useServerFn(listMasterCounterparties);
  const lacc = useServerFn(listMasterAccounts);
  const let_ = useServerFn(listEventTriggers);
  const labac = useServerFn(listAbacPredicates);
  const lpers = useServerFn(listCopilotPersonas);
  const sec = useQuery({ queryKey: ["dh-sec", tenantId], queryFn: () => lsec({ data: { tenant_id: tenantId, limit: 500 } }) });
  const cp  = useQuery({ queryKey: ["dh-cp",  tenantId], queryFn: () => lcp({ data: { tenant_id: tenantId, limit: 500 } }) });
  const acc = useQuery({ queryKey: ["dh-acc", tenantId], queryFn: () => lacc({ data: { tenant_id: tenantId, limit: 500 } }) });
  const evt = useQuery({ queryKey: ["dh-evt", tenantId], queryFn: () => let_({ data: { tenant_id: tenantId } }) });
  const abac = useQuery({ queryKey: ["dh-abac", tenantId], queryFn: () => labac({ data: { tenant_id: tenantId } }) });
  const pers = useQuery({ queryKey: ["dh-pers"], queryFn: () => lpers({ data: {} }) });
  const loading = sec.isLoading || cp.isLoading || acc.isLoading || evt.isLoading || abac.isLoading || pers.isLoading;
  const masters = (sec.data?.length ?? 0) + (cp.data?.length ?? 0) + (acc.data?.length ?? 0);
  const evtEnabled = ((evt.data ?? []) as Array<{ enabled?: boolean }>).filter(r => r.enabled).length;
  const abacOn = ((abac.data ?? []) as Array<{ enabled?: boolean }>).filter(r => r.enabled).length;
  const kpis: ConsoleKpi[] = [
    { label: "Master records", value: masters, hint: `${sec.data?.length ?? 0} sec · ${cp.data?.length ?? 0} cp · ${acc.data?.length ?? 0} acc`, icon: Database },
    { label: "Event triggers on", value: evtEnabled, hint: `${(evt.data ?? []).length} configured`, icon: Zap, tone: evtEnabled > 0 ? "positive" : "default" },
    { label: "ABAC predicates", value: abacOn, hint: "attribute scoping on RBAC", icon: ShieldCheck, tone: abacOn > 0 ? "positive" : "warning" },
    { label: "Simulations", value: "—", hint: "dry-run rule changes", icon: FlaskConical },
    { label: "Copilot personas", value: (pers.data ?? []).length, hint: "auditor / analyst / ops", icon: UserCog },
  ];
  return (
    <ConsoleHeader
      persona="Chief Data Officer · Head of Data Governance"
      title="Domain Console"
      tagline="Master data, event-driven recon, attribute-based access, rule simulation, and the Auditor Copilot persona — the trust layer under every reconciliation."
      accent="domain"
      loading={loading}
      kpis={kpis}
      primaryCta={{ label: "Import masters", href: `/${slug}/tenant/settings/erp-connectors` }}
      secondaryCta={{ label: "Open Data Docs", href: "/docs/architecture/00_README.md" }}
    />
  );
}

function MastersTab({ tenantId }: { tenantId: string }) {
  const [q, setQ] = useState("");
  const lsec = useServerFn(listMasterSecurities);
  const lcp = useServerFn(listMasterCounterparties);
  const lacc = useServerFn(listMasterAccounts);
  const sec = useQuery({ queryKey: ["m-sec", tenantId, q], queryFn: () => lsec({ data: { tenant_id: tenantId, q: q || undefined, limit: 50 } }) });
  const cp = useQuery({ queryKey: ["m-cp", tenantId, q], queryFn: () => lcp({ data: { tenant_id: tenantId, q: q || undefined, limit: 50 } }) });
  const acc = useQuery({ queryKey: ["m-acc", tenantId, q], queryFn: () => lacc({ data: { tenant_id: tenantId, q: q || undefined, limit: 50 } }) });

  return (
    <div className="space-y-4 pt-4">
      <Input placeholder="Search by name, ISIN, ticker, LEI, account…" value={q} onChange={e => setQ(e.target.value)} className="max-w-md" />
      <div className="grid lg:grid-cols-3 gap-4">
        <MasterList title="Securities" rows={sec.data ?? []} columns={["name","isin","ticker","asset_class","currency"]} loading={sec.isLoading} />
        <MasterList title="Counterparties" rows={cp.data ?? []} columns={["short_name","lei","bic","cp_type","jurisdiction"]} loading={cp.isLoading} />
        <MasterList title="Accounts" rows={acc.data ?? []} columns={["account_number","account_name","account_type","currency"]} loading={acc.isLoading} />
      </div>
      <p className="text-xs text-muted-foreground">Create via <code>upsertMasterSecurity</code> / <code>upsertMasterCounterparty</code> / <code>upsertMasterAccount</code> server fns or import via the Ingestion Hub.</p>
    </div>
  );
}

function MasterList({ title, rows, columns, loading }: { title: string; rows: Array<Record<string, unknown>>; columns: string[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{loading ? "…" : `${rows.length} record(s)`}</CardDescription></CardHeader>
      <CardContent className="text-xs">
        {loading ? <Skeleton className="h-32" /> : rows.length === 0 ? (
          <p className="text-muted-foreground">No records yet.</p>
        ) : (
          <table className="w-full">
            <thead><tr className="text-left text-muted-foreground">{columns.map(c => <th key={c} className="py-1 pr-2">{c}</th>)}</tr></thead>
            <tbody>
              {rows.slice(0, 20).map((r, i) => (
                <tr key={(r.id as string) ?? i} className="border-t">
                  {columns.map(c => <td key={c} className="py-1 pr-2 truncate">{String(r[c] ?? "—")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function EventTriggersTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listEventTriggers);
  const q = useQuery({ queryKey: ["evt-trigs", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId } }) });
  const rows = (q.data ?? []) as Array<Record<string, unknown>>;
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Event-driven recon triggers</CardTitle><CardDescription>Map webhook/outbox topics to recon schedules for continuous reconciliation.</CardDescription></CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-32" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No event triggers yet. Wire one via the <code>upsertEventTrigger</code> server fn.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Topic</th><th>Schedule</th><th>Debounce</th><th>Last fired</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id as string} className="border-t">
                  <td className="py-1"><code>{r.event_topic as string}</code></td>
                  <td>{(r.recon_schedules as { name?: string } | undefined)?.name ?? "—"}</td>
                  <td>{r.debounce_seconds as number}s</td>
                  <td>{r.last_fired_at ? new Date(r.last_fired_at as string).toLocaleString() : "never"}</td>
                  <td><Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "enabled" : "off"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function SimulationsTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listSimulations);
  const q = useQuery({ queryKey: ["sims", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId } }) });
  const rows = (q.data ?? []) as Array<Record<string, unknown>>;
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Rule simulation & backtest</CardTitle><CardDescription>Dry-run candidate rule sets against historical baseline runs before promoting.</CardDescription></CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-32" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No simulations yet. Use the <code>createSimulation</code> + <code>runSimulation</code> fns.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Created</th><th>Status</th><th>Baseline</th><th>Candidate</th><th>Δ matched</th><th>Δ exceptions</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = (r.delta ?? {}) as Record<string, number>;
                return (
                  <tr key={r.id as string} className="border-t">
                    <td className="py-1">{new Date(r.created_at as string).toLocaleString()}</td>
                    <td><Badge>{r.status as string}</Badge></td>
                    <td>{r.baseline_matched as number} / {r.baseline_exceptions as number}</td>
                    <td>{r.candidate_matched as number} / {r.candidate_exceptions as number}</td>
                    <td className={Number(d.matched_delta) > 0 ? "text-green-600" : ""}>{d.matched_delta ?? 0}</td>
                    <td className={Number(d.exceptions_delta) < 0 ? "text-green-600" : ""}>{d.exceptions_delta ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function AbacTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listAbacPredicates);
  const q = useQuery({ queryKey: ["abac", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId } }) });
  const rows = (q.data ?? []) as Array<Record<string, unknown>>;
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>ABAC predicates</CardTitle><CardDescription>Attribute scoping layered on top of RBAC permissions. Empty = RBAC alone applies.</CardDescription></CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-32" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ABAC predicates configured. Use <code>upsertAbacPredicate</code> to add one (e.g. <em>recon.read</em> scoped to <em>account_number ∈ {`{`}…{`}`}</em>).</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Permission</th><th>Attribute</th><th>Operator</th><th>Values</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id as string} className="border-t">
                  <td className="py-1"><code>{r.permission_id as string}</code></td>
                  <td>{r.attribute as string}</td>
                  <td>{r.operator as string}</td>
                  <td className="truncate max-w-xs"><code>{JSON.stringify(r.values)}</code></td>
                  <td><Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "on" : "off"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function PersonasTab() {
  const lst = useServerFn(listCopilotPersonas);
  const q = useQuery({ queryKey: ["personas"], queryFn: () => lst({ data: {} }) });
  const rows = (q.data ?? []) as Array<Record<string, unknown>>;
  return (
    <div className="grid md:grid-cols-2 gap-4 pt-4">
      {q.isLoading ? <Skeleton className="h-32" /> : rows.map((p) => {
        const prompts = (p.default_prompts ?? []) as Array<{ label: string; prompt: string }>;
        return (
          <Card key={p.id as string}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">{p.name as string}<Badge variant="outline">{p.code as string}</Badge></CardTitle>
              <CardDescription>{p.description as string}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Canned prompts</p>
              {prompts.map((cp) => (
                <div key={cp.label} className="rounded-md border p-2 text-xs">
                  <div className="font-medium">{cp.label}</div>
                  <div className="text-muted-foreground mt-1">{cp.prompt}</div>
                </div>
              ))}
              <Button variant="outline" size="sm" disabled>Launch in Copilot (coming soon)</Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
