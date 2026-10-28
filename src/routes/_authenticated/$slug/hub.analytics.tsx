import { createFileRoute, useParams } from "@tanstack/react-router";
import { HubShell } from "@/components/hub-shell";
import { BarChart3, LineChart, PieChart, Activity, Layers, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/$slug/hub/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics Hub — Workspace | ReconIQ" },
      { name: "description", content: "Pluggable dashboards, KPI registry, and role-based landings." },
    ],
  }),
  component: AnalyticsHub,
});

function AnalyticsHub() {
  const { slug } = useParams({ from: "/_authenticated/$slug/hub/analytics" });
  return (
    <HubShell
      eyebrow="Workspace"
      title="Analytics Hub"
      intro="Pluggable dashboards powered by the KPI registry (useKpi). Role-based landings, export governance, and cross-surface KPIs."
      entries={[
        { title: "Recon health", description: "Match rate, break age, resolution SLA.", href: `/${slug}/monitoring`, icon: Activity },
        { title: "AI usage & cost", description: "AI events, latency, spend by tenant.", href: `/${slug}/ai-governance/finops`, icon: LineChart },
        { title: "Marketplace analytics", description: "Install → usage → outcome per listing.", href: "/platform-marketplace-analytics", icon: BarChart3 },
        { title: "Governance posture", description: "HITL, kill switches, drift alerts.", href: `/${slug}/ai-governance/approvals`, icon: PieChart },
        { title: "KPI registry", description: "Named KPIs powering every tile.", href: `/${slug}/monitoring`, icon: Layers },
        { title: "Exports", description: "Governed CSV/PDF/XLSX exports.", href: `/${slug}/recon/evidence`, icon: Download },
      ]}
    />
  );
}
