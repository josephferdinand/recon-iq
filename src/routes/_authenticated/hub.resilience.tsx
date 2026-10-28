import { createFileRoute } from "@tanstack/react-router";
import { HubShell } from "@/components/hub-shell";
import { DatabaseBackup, Globe, Archive, Layers, ShieldCheck, Wrench } from "lucide-react";

export const Route = createFileRoute("/_authenticated/hub/resilience")({
  head: () => ({
    meta: [
      { title: "Resilience Center — Platform | ReconIQ" },
      { name: "description", content: "Backup, DR, retention, residency, and resilience tier under one roof." },
    ],
  }),
  component: () => (
    <HubShell
      eyebrow="Platform"
      title="Resilience Center"
      intro="Backup, disaster recovery, retention, data residency, and resilience-tier controls consolidated."
      entries={[
        { title: "Backup", description: "Platform backup config and events.", href: "/platform?page=backup", icon: DatabaseBackup },
        { title: "DR drills", description: "Disaster-recovery drills across regions.", href: "/platform?page=roadmap", icon: Wrench },
        { title: "Retention policies", description: "Retention overrides and archive ledger.", href: "/retention", icon: Archive },
        { title: "Data residency", description: "Tenant residency dashboard.", href: "/platform?page=residency", icon: Globe },
        { title: "Resilience tiers", description: "Silo tiers and tenant assignments.", href: "/platform?page=roadmap", icon: Layers },
        { title: "Compliance bundles", description: "SOC 2 / evidence bundles and controls.", href: "/security-appendix", icon: ShieldCheck },
      ]}
      kpiIds={["reliability.dr_drills_last_90d","tenancy.active_tenants"]}
    />
  ),
});
