/**
 * Phase 8 — Scale & Enterprise Console
 *
 * 7 tabs: Shards, Silo Tiers, Schema-per-Tenant, Loans, Digital Twin, Chaos, Attestations.
 * Phase C upgrade: Digital Twin graph, Loans exposure dashboard, Schema-per-tenant
 * wizard, and Attestations (SOC 2 + EOD sign-off) panel.
 */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Cpu, Layers, FileCheck2, Banknote, Network, FlaskConical, ShieldCheck, Lock } from "lucide-react";
import { ConsoleHeader, type ConsoleKpi } from "@/components/console-header";
import { ShardsPanel } from "@/components/console/shards-panel";
import { SiloLadderPanel } from "@/components/console/silo-ladder-panel";
import { ChaosScorecardPanel } from "@/components/console/chaos-scorecard-panel";
import { DigitalTwinPanel } from "@/components/console/digital-twin-panel";
import { LoansExposurePanel } from "@/components/console/loans-exposure-panel";
import { SchemaTenantWizardPanel } from "@/components/console/schema-tenant-wizard-panel";
import { AttestationsPanel } from "@/components/console/attestations-panel";
import { ProcessingHealthOverview } from "@/components/console/processing-health-overview";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { listShardRuns } from "@/lib/phase8-shard-executor.functions";
import { listTenantSiloAssignments, listSchemaPerTenantRequests } from "@/lib/phase8-silo.functions";
import { listLoanFacilities } from "@/lib/phase8-loan-vertical.functions";
import { listTwinNodes } from "@/lib/phase8-digital-twin.functions";
import { listChaosDrills } from "@/lib/phase8-chaos-drills.functions";
import { listSoc2Runs } from "@/lib/soc2.functions";
import { getPhaseCPermissions, type PhaseCPermissionSet } from "@/lib/phase-c-rbac.functions";

export const Route = createFileRoute("/_authenticated/$slug/tenant/settings/scale")({
  component: ScaleConsole,
});

function ScaleConsole() {
  const { slug } = useParams({ from: "/_authenticated/$slug/tenant/settings/scale" });
  const getTenant = useServerFn(getTenantBySlug);
  const getPerms = useServerFn(getPhaseCPermissions);
  const { data: tenant } = useQuery({
    queryKey: ["tenant", slug],
    queryFn: () => getTenant({ data: { slug } }),
  });
  const tenantId = (tenant as { id?: string } | undefined)?.id ?? null;
  const permsQ = useQuery({
    queryKey: ["phase-c-perms", tenantId],
    queryFn: () => getPerms({ data: { tenant_id: tenantId! } }),
    enabled: !!tenantId,
    staleTime: 60_000,
  });
  const perms = (permsQ.data ?? null) as PhaseCPermissionSet | null;

  return (
    <div className="p-6 space-y-4">
      {!tenantId || !perms ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <ScaleHeader tenantId={tenantId} slug={slug} perms={perms} />
          <ProcessingHealthOverview tenantId={tenantId} />
          <Tabs defaultValue="shards" className="w-full">
            <TabsList className="grid grid-cols-3 lg:grid-cols-7 max-w-4xl">
              <TabsTrigger value="shards">Shards</TabsTrigger>
              <TabsTrigger value="silo">Silo Tiers</TabsTrigger>
              <TabsTrigger value="schema" disabled={!perms.schema_view} title={!perms.schema_view ? "Requires tenant_admin" : ""}>Schema-per-Tenant</TabsTrigger>
              <TabsTrigger value="loans" disabled={!perms.loans_view} title={!perms.loans_view ? "Requires tenant_analyst or above" : ""}>Loans</TabsTrigger>
              <TabsTrigger value="twin" disabled={!perms.twin_view} title={!perms.twin_view ? "Requires tenant_analyst or above" : ""}>Digital Twin</TabsTrigger>
              <TabsTrigger value="chaos">Chaos</TabsTrigger>
              <TabsTrigger value="attest" disabled={!perms.attest_view} title={!perms.attest_view ? "Requires tenant_admin" : ""}>Attestations</TabsTrigger>
            </TabsList>
            <TabsContent value="shards"><ShardsPanel tenantId={tenantId} /></TabsContent>
            <TabsContent value="silo"><SiloLadderPanel tenantId={tenantId} /></TabsContent>
            <TabsContent value="schema">{perms.schema_view ? <SchemaTenantWizardPanel tenantId={tenantId} canRequest={perms.schema_request} /> : <ForbiddenPanel label="Schema-per-Tenant" role="tenant_admin" />}</TabsContent>
            <TabsContent value="loans">{perms.loans_view ? <LoansExposurePanel tenantId={tenantId} /> : <ForbiddenPanel label="Loans exposure" role="tenant_analyst" />}</TabsContent>
            <TabsContent value="twin">{perms.twin_view ? <DigitalTwinPanel tenantId={tenantId} /> : <ForbiddenPanel label="Digital Twin" role="tenant_analyst" />}</TabsContent>
            <TabsContent value="chaos"><ChaosScorecardPanel tenantId={tenantId} /></TabsContent>
            <TabsContent value="attest">{perms.attest_view ? <AttestationsPanel tenantId={tenantId} canExport={perms.attest_export} /> : <ForbiddenPanel label="Attestations" role="tenant_admin" />}</TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function ForbiddenPanel({ label, role }: { label: string; role: string }) {
  return (
    <Card className="mt-4 border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4 text-muted-foreground" /> {label} — access restricted
        </CardTitle>
        <CardDescription>
          Your role does not include the required permission. Contact a tenant administrator to be
          granted the <code className="font-mono">{role}</code> role (or higher) to view this panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        Every Phase C panel enforces fine-grained RBAC both in the UI and server-side (denied
        requests are recorded in the tenant audit trail).
      </CardContent>
    </Card>
  );
}

function ScaleHeader({ tenantId, slug, perms }: { tenantId: string; slug: string; perms: PhaseCPermissionSet }) {
  const lsr = useServerFn(listShardRuns);
  const lta = useServerFn(listTenantSiloAssignments);
  const lspr = useServerFn(listSchemaPerTenantRequests);
  const llf = useServerFn(listLoanFacilities);
  const ltn = useServerFn(listTwinNodes);
  const ldr = useServerFn(listChaosDrills);
  const lsoc = useServerFn(listSoc2Runs);
  const runs = useQuery({ queryKey: ["sh-runs", tenantId], queryFn: () => lsr({ data: { tenant_id: tenantId, limit: 200 } }) });
  const assigns = useQuery({ queryKey: ["sh-assigns", tenantId], queryFn: () => lta({ data: { tenant_id: tenantId } }) });
  const reqs = useQuery({ queryKey: ["sh-reqs", tenantId], queryFn: () => lspr({ data: { tenant_id: tenantId, openOnly: false } }), enabled: perms.schema_view });
  const loans = useQuery({ queryKey: ["sh-loans", tenantId], queryFn: () => llf({ data: { tenant_id: tenantId } }), enabled: perms.loans_view });
  const twin = useQuery({ queryKey: ["sh-twin", tenantId], queryFn: () => ltn({ data: { tenant_id: tenantId, limit: 500 } }), enabled: perms.twin_view });
  const drills = useQuery({ queryKey: ["sh-drills", tenantId], queryFn: () => ldr({ data: { tenant_id: tenantId, limit: 20 } }) });
  const soc = useQuery({ queryKey: ["sh-soc-30"], queryFn: () => lsoc({ data: { since_days: 30 } }), enabled: perms.attest_view });
  const loading = runs.isLoading || assigns.isLoading || reqs.isLoading || loans.isLoading || twin.isLoading || drills.isLoading || soc.isLoading;
  const runsArr = (runs.data ?? []) as Array<{ status?: string; rows_in?: number }>;
  const rowsIn = runsArr.reduce((a, r) => a + Number(r.rows_in ?? 0), 0);
  const failed = runsArr.filter(r => r.status === "failed").length;
  const activeTier = ((assigns.data ?? []) as Array<{ status?: string; silo_tier_code?: string }>).find(a => a.status === "active");
  const openReqs = ((reqs.data ?? []) as Array<{ status?: string }>).filter(r => !["provisioned", "live", "rejected"].includes(String(r.status))).length;
  const facilityOutstanding = ((loans.data ?? []) as Array<{ outstanding_amount?: number }>).reduce((a, r) => a + Number(r.outstanding_amount ?? 0), 0);
  const lastDrill = ((drills.data ?? []) as Array<{ scheduled_for?: string; status?: string }>)[0];
  const socArr = (soc.data ?? []) as Array<{ status?: string; control_id?: string }>;
  const socPassing = socArr.filter(r => r.status === "passed").length;
  const kpis: ConsoleKpi[] = [
    { label: "Rows processed", value: rowsIn.toLocaleString(), hint: `${runsArr.length} shard runs · ${failed} failed`, icon: Cpu, tone: failed > 0 ? "warning" : "positive" },
    { label: "Silo tier", value: activeTier?.silo_tier_code ?? "shared", hint: activeTier ? "active" : "default", icon: Layers },
    { label: "Schema requests", value: openReqs, hint: `${(reqs.data ?? []).length} total`, icon: FileCheck2 },
    { label: "Loans outstanding", value: facilityOutstanding ? `${(facilityOutstanding / 1_000_000).toFixed(1)}M` : "—", hint: `${(loans.data ?? []).length} facilities`, icon: Banknote },
    { label: "Twin nodes", value: (twin.data as { total?: number } | undefined)?.total ?? 0, hint: "ops graph coverage", icon: Network },
    { label: "Last drill", value: lastDrill?.status ?? "—", hint: lastDrill?.scheduled_for ? new Date(lastDrill.scheduled_for).toLocaleDateString() : "no drills yet", icon: FlaskConical, tone: lastDrill?.status === "passed" ? "positive" : lastDrill ? "warning" : "default" },
    { label: "SOC 2 evidence", value: socArr.length, hint: `${socPassing} passing · 30d`, icon: ShieldCheck, tone: socArr.length > 0 && socPassing === socArr.length ? "positive" : socArr.length > 0 ? "warning" : "default" },
  ];
  return (
    <ConsoleHeader
      persona="COO · Head of Platform Reliability · CISO"
      title="Scale & Enterprise Console"
      tagline="Capacity, tenant isolation, resilience, and enterprise-scale operations — sharded execution, silo tiers, schema-per-tenant, loan vertical, digital twin, chaos drills, and attestations."
      accent="scale"
      loading={loading}
      kpis={kpis}
      primaryCta={{ label: "Schedule drill", href: `/${slug}/tenant/settings/scale#chaos` }}
      secondaryCta={{ label: "DR runbook", href: "/docs/runbooks/01_dr_restore.md" }}
    />
  );
}

