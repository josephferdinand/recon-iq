/**
 * Phase 7 — Vertical Console
 *
 * Tenant-admin route surfacing Phase-7 capabilities:
 *  • Corporate Actions (lifecycle browser + entitlements)
 *  • Shadow NAV runs
 *  • Data Quality rules & results
 *  • Agent Runbooks catalog
 *  • Knowledge Graph node browser
 *  • Upstream Drift Alerts
 *  • Counterparty Outreach queue
 *  • Dynamic Data Masking rules
 *  • Red-Team scans history
 *  • Regulatory pack catalog (read-only)
 */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock, GaugeCircle, Workflow, AlertTriangle, MessageSquare, ShieldAlert } from "lucide-react";
import { ConsoleHeader, type ConsoleKpi } from "@/components/console-header";
import { ReconPacksPanel } from "@/components/console/recon-packs-panel";
import { RegCalendarPanel } from "@/components/console/reg-calendar-panel";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { listCorporateActions } from "@/lib/phase7-corporate-actions.functions";
import { listNavRuns } from "@/lib/phase7-nav.functions";
import { listDqRules, listDqResults } from "@/lib/phase7-data-quality.functions";
import { listAgentRunbooks, listRuleOptimisationRuns } from "@/lib/phase7-agents.functions";
import { listKgNodes } from "@/lib/phase7-knowledge-graph.functions";
import { listDriftAlerts, listMaskingRules } from "@/lib/phase7-drift-masking.functions";
import { listOutreachMessages } from "@/lib/phase7-outreach.functions";

export const Route = createFileRoute("/_authenticated/$slug/tenant/settings/verticals")({
  component: VerticalConsole,
});

function VerticalConsole() {
  const { slug } = useParams({ from: "/_authenticated/$slug/tenant/settings/verticals" });
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
          <VerticalHeader tenantId={tenantId} slug={slug} />
          <Tabs defaultValue="packs" className="w-full">
            <TabsList className="grid grid-cols-4 lg:grid-cols-11 max-w-6xl">
              <TabsTrigger value="packs">Recon Packs</TabsTrigger>
              <TabsTrigger value="calendar">Reg Calendar</TabsTrigger>
              <TabsTrigger value="ca">Corp Actions</TabsTrigger>
              <TabsTrigger value="nav">Shadow NAV</TabsTrigger>
              <TabsTrigger value="dq">DQ</TabsTrigger>
              <TabsTrigger value="agents">Runbooks</TabsTrigger>
              <TabsTrigger value="kg">Graph</TabsTrigger>
              <TabsTrigger value="drift">Drift</TabsTrigger>
              <TabsTrigger value="outreach">Outreach</TabsTrigger>
              <TabsTrigger value="masking">Masking</TabsTrigger>
              <TabsTrigger value="redteam">Red-Team</TabsTrigger>
            </TabsList>
            <TabsContent value="packs"><ReconPacksPanel tenantId={tenantId} /></TabsContent>
            <TabsContent value="calendar"><RegCalendarPanel tenantId={tenantId} /></TabsContent>
            <TabsContent value="ca"><CorporateActionsTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="nav"><NavTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="dq"><DqTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="agents"><RunbooksTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="kg"><KgTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="drift"><DriftTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="outreach"><OutreachTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="masking"><MaskingTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="redteam"><RedTeamTab /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function VerticalHeader({ tenantId, slug }: { tenantId: string; slug: string }) {
  const lca = useServerFn(listCorporateActions);
  const lnav = useServerFn(listNavRuns);
  const ldqr = useServerFn(listDqRules);
  const ldqres = useServerFn(listDqResults);
  const ldrift = useServerFn(listDriftAlerts);
  const lout = useServerFn(listOutreachMessages);
  const ca = useQuery({ queryKey: ["vh-ca", tenantId], queryFn: () => lca({ data: { tenant_id: tenantId, limit: 200 } }) });
  const nav = useQuery({ queryKey: ["vh-nav", tenantId], queryFn: () => lnav({ data: { tenant_id: tenantId, limit: 100 } }) });
  const dqr = useQuery({ queryKey: ["vh-dqr", tenantId], queryFn: () => ldqr({ data: { tenant_id: tenantId, enabledOnly: false } }) });
  const dqres = useQuery({ queryKey: ["vh-dqres", tenantId], queryFn: () => ldqres({ data: { tenant_id: tenantId, limit: 200 } }) });
  const drift = useQuery({ queryKey: ["vh-drift", tenantId], queryFn: () => ldrift({ data: { tenant_id: tenantId, openOnly: true } }) });
  const out = useQuery({ queryKey: ["vh-out", tenantId], queryFn: () => lout({ data: { tenant_id: tenantId, limit: 100 } }) });
  const loading = ca.isLoading || nav.isLoading || dqr.isLoading || dqres.isLoading || drift.isLoading || out.isLoading;
  const navBreaches = ((nav.data ?? []) as Array<{ status?: string }>).filter(r => r.status === "breach").length;
  const dqEnabled = ((dqr.data ?? []) as Array<{ enabled?: boolean }>).filter(r => r.enabled).length;
  const dqViol = ((dqres.data ?? []) as Array<{ violations?: number }>).reduce((a, r) => a + Number(r.violations ?? 0), 0);
  const outreachOpen = ((out.data ?? []) as Array<{ status?: string }>).filter(r => !["sent", "delivered", "resolved"].includes(String(r.status))).length;
  const kpis: ConsoleKpi[] = [
    { label: "Corp Actions", value: (ca.data ?? []).length, hint: "announced → paid", icon: CalendarClock },
    { label: "NAV variance breaches", value: navBreaches, hint: `${(nav.data ?? []).length} runs`, icon: GaugeCircle, tone: navBreaches > 0 ? "danger" : "positive" },
    { label: "DQ rules enabled", value: dqEnabled, hint: `${dqViol} violations 30d`, icon: Workflow, tone: dqViol > 0 ? "warning" : "positive" },
    { label: "Drift alerts open", value: (drift.data ?? []).length, hint: "upstream feed changes", icon: AlertTriangle, tone: (drift.data ?? []).length > 0 ? "danger" : "positive" },
    { label: "Outreach pending", value: outreachOpen, hint: "counterparty replies", icon: MessageSquare },
    { label: "Red-Team", value: "auto", hint: "nightly CI scan", icon: ShieldAlert },
  ];
  return (
    <ConsoleHeader
      persona="Head of Product Control · Regulatory Reporting Lead"
      title="Vertical Console"
      tagline="Industry-specific packs — Corporate Actions, Shadow NAV, Data Quality, agent runbooks, knowledge graph, drift alerts, counterparty outreach, masking, and red-team scans."
      accent="vertical"
      loading={loading}
      kpis={kpis}
      primaryCta={{ label: "Browse marketplace", href: `/${slug}/tenant/settings/marketplace` }}
      secondaryCta={{ label: "Regulatory packs", href: "/docs/15_regulatory_packs.md" }}
    />
  );
}

type R = Record<string, unknown>;

function SimpleTable({ columns, rows, loading, empty }: { columns: string[]; rows: R[]; loading: boolean; empty: string }) {
  if (loading) return <Skeleton className="h-32" />;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-left text-muted-foreground">{columns.map(c => <th key={c} className="py-1 pr-2">{c}</th>)}</tr></thead>
      <tbody>
        {rows.slice(0, 50).map((r, i) => (
          <tr key={(r.id as string) ?? i} className="border-t">
            {columns.map(c => <td key={c} className="py-1 pr-2 truncate max-w-[16rem]">{r[c] == null ? "—" : String(r[c])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CorporateActionsTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listCorporateActions);
  const q = useQuery({ queryKey: ["p7-ca", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId, limit: 100 } }) });
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Corporate Actions</CardTitle><CardDescription>Lifecycle (announced → confirmed → ex/record → pay → reconciled).</CardDescription></CardHeader>
      <CardContent>
        <SimpleTable
          columns={["ca_type","isin","ex_date","pay_date","gross_amount","currency","status"]}
          rows={(q.data ?? []) as R[]}
          loading={q.isLoading}
          empty="No corporate actions ingested yet."
        />
      </CardContent>
    </Card>
  );
}

function NavTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listNavRuns);
  const q = useQuery({ queryKey: ["p7-nav", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId, limit: 50 } }) });
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Shadow NAV runs</CardTitle><CardDescription>Compare official vs shadow NAV with bps variance.</CardDescription></CardHeader>
      <CardContent>
        <SimpleTable
          columns={["fund_code","nav_date","official_nav","shadow_nav","variance_bps","status"]}
          rows={(q.data ?? []) as R[]}
          loading={q.isLoading}
          empty="No NAV runs yet."
        />
      </CardContent>
    </Card>
  );
}

function DqTab({ tenantId }: { tenantId: string }) {
  const lr = useServerFn(listDqRules);
  const lres = useServerFn(listDqResults);
  const rulesQ = useQuery({ queryKey: ["p7-dqr", tenantId], queryFn: () => lr({ data: { tenant_id: tenantId, enabledOnly: false } }) });
  const resQ = useQuery({ queryKey: ["p7-dqres", tenantId], queryFn: () => lres({ data: { tenant_id: tenantId, limit: 100 } }) });
  return (
    <div className="grid lg:grid-cols-2 gap-4 pt-4">
      <Card><CardHeader><CardTitle>DQ rules</CardTitle></CardHeader><CardContent>
        <SimpleTable columns={["name","target_table","severity","enabled"]} rows={(rulesQ.data ?? []) as R[]} loading={rulesQ.isLoading} empty="No DQ rules configured." />
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Latest DQ results</CardTitle></CardHeader><CardContent>
        <SimpleTable columns={["run_at","dq_rule_id","violations","severity","score"]} rows={(resQ.data ?? []) as R[]} loading={resQ.isLoading} empty="No DQ runs yet." />
      </CardContent></Card>
    </div>
  );
}

function RunbooksTab({ tenantId }: { tenantId: string }) {
  const lr = useServerFn(listAgentRunbooks);
  const lro = useServerFn(listRuleOptimisationRuns);
  const rb = useQuery({ queryKey: ["p7-rb"], queryFn: () => lr({ data: {} }) });
  const ro = useQuery({ queryKey: ["p7-ro", tenantId], queryFn: () => lro({ data: { tenant_id: tenantId } }) });
  return (
    <div className="space-y-4 pt-4">
      <Card><CardHeader><CardTitle>Agent runbooks</CardTitle><CardDescription>Named playbooks an agent can execute.</CardDescription></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          {rb.isLoading ? <Skeleton className="h-32" /> : ((rb.data ?? []) as R[]).map((r) => (
            <div key={r.code as string} className="rounded-md border p-3">
              <div className="flex items-center gap-2"><Badge variant="outline">{r.code as string}</Badge><span className="font-medium">{r.name as string}</span></div>
              <p className="text-xs text-muted-foreground mt-1">{r.description as string}</p>
              <p className="text-xs mt-2">Applies to: <code>{r.applies_to as string}</code></p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Rule Optimisation runs</CardTitle></CardHeader><CardContent>
        <SimpleTable columns={["created_at","status","recon_definition_id"]} rows={(ro.data ?? []) as R[]} loading={ro.isLoading} empty="No optimisation runs yet." />
      </CardContent></Card>
    </div>
  );
}

function KgTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listKgNodes);
  const q = useQuery({ queryKey: ["p7-kg", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId, limit: 200 } }) });
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Reconciliation Knowledge Graph</CardTitle><CardDescription>Entity nodes (account, security, counterparty, definition, run, break) and weighted edges.</CardDescription></CardHeader>
      <CardContent>
        <SimpleTable columns={["node_type","node_key","label"]} rows={(q.data ?? []) as R[]} loading={q.isLoading} empty="No KG nodes yet. Hydrate via upsertKgNode." />
      </CardContent>
    </Card>
  );
}

function DriftTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listDriftAlerts);
  const q = useQuery({ queryKey: ["p7-drift", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId, openOnly: true } }) });
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Upstream drift alerts</CardTitle><CardDescription>Proactive break prevention — schema/volume drift on inbound feeds.</CardDescription></CardHeader>
      <CardContent>
        <SimpleTable columns={["detected_at","source","metric","baseline","observed","delta_pct","severity"]} rows={(q.data ?? []) as R[]} loading={q.isLoading} empty="No open drift alerts." />
      </CardContent>
    </Card>
  );
}

function OutreachTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listOutreachMessages);
  const q = useQuery({ queryKey: ["p7-outreach", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId, limit: 50 } }) });
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Counterparty outreach queue</CardTitle><CardDescription>Symphony / Outlook / Teams / Slack / email via marketplace plugins.</CardDescription></CardHeader>
      <CardContent>
        <SimpleTable columns={["created_at","channel","recipient","subject","status"]} rows={(q.data ?? []) as R[]} loading={q.isLoading} empty="No outreach messages queued." />
      </CardContent>
    </Card>
  );
}

function MaskingTab({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listMaskingRules);
  const q = useQuery({ queryKey: ["p7-mask", tenantId], queryFn: () => lst({ data: { tenant_id: tenantId } }) });
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Dynamic data masking</CardTitle><CardDescription>Column-level mask metadata applied by `security_invoker` views and server-side renderers.</CardDescription></CardHeader>
      <CardContent>
        <SimpleTable columns={["schema_name","table_name","column_name","mask_strategy","enabled"]} rows={(q.data ?? []) as R[]} loading={q.isLoading} empty="No masking rules configured." />
      </CardContent>
    </Card>
  );
}

function RedTeamTab() {
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Red-Team scans</CardTitle><CardDescription>Adversarial probes (RLS, prompt-injection, BOLA, SCIM, masking). Start a scan via the `startRedTeamScan` server fn or the scheduled CI workflow.</CardDescription></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Historical scan list — populated as scans complete via the GitHub Actions <code>red-team-scan</code> workflow.</p>
      </CardContent>
    </Card>
  );
}
