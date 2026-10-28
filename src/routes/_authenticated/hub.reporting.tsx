import { createFileRoute } from "@tanstack/react-router";
import { HubShell } from "@/components/hub-shell";
import { FileBarChart, Database, ChartPie, Table, Send, ScrollText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/hub/reporting")({
  head: () => ({
    meta: [
      { title: "Reporting Studio — Platform | ReconIQ" },
      { name: "description", content: "Unified reporting hub: definitions, exports, field mappings, delivery." },
    ],
  }),
  component: () => (
    <HubShell
      eyebrow="Platform"
      title="Reporting Studio"
      intro="One studio for report definitions, field mappings, DB exports, and delivery — replacing the three separate reporting tabs."
      entries={[
        { title: "Report definitions", description: "Tenant-scoped report definitions and templates.", href: "/platform?page=roadmap", icon: FileBarChart },
        { title: "Reporting DB exports", description: "Managed exports to downstream warehouses.", href: "/platform?page=reporting-exports", icon: Database },
        { title: "Field mappings", description: "Semantic field maps across sources.", href: "/platform?page=field-mappings", icon: Table },
        { title: "Analytics dashboards", description: "Cross-tenant benchmarks and KPI rollups.", href: "/platform?page=benchmarks", icon: ChartPie },
        { title: "Delivery & scheduling", description: "Distribution windows and cadence.", href: "/platform?page=roadmap", icon: Send },
        { title: "Audit trail", description: "Report generation history and access log.", href: "/platform?page=audit", icon: ScrollText },
      ]}
    />
  ),
});
