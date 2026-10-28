import { createFileRoute } from "@tanstack/react-router";
import { HubShell } from "@/components/hub-shell";
import { Activity, GitBranch, Gauge, Siren, Waves, HeartPulse } from "lucide-react";

export const Route = createFileRoute("/_authenticated/hub/observability")({
  head: () => ({
    meta: [
      { title: "Observability — Platform | ReconIQ" },
      { name: "description", content: "Pipelines, workers, SLOs, chaos, anomalies, and schema drift in one hub." },
    ],
  }),
  component: () => (
    <HubShell
      eyebrow="Platform"
      title="Observability"
      intro="Pipelines, workers, SLOs, chaos calendar, anomalies, and schema drift — one hub for platform health."
      entries={[
        { title: "Pipelines & stats", description: "Ingest and processing pipelines.", href: "/platform-observability", icon: Waves },
        { title: "Worker health", description: "Worker heartbeats, retries, circuit breakers.", href: "/platform?page=worker-health", icon: HeartPulse },
        { title: "SLOs & measurements", description: "SLO catalog and daily measurements.", href: "/platform?page=slo", icon: Gauge },
        { title: "Chaos calendar", description: "Scheduled chaos drills and findings.", href: "/platform?page=chaos", icon: Siren },
        { title: "Session anomalies", description: "Login-risk and session anomaly events.", href: "/platform?page=session-anomalies", icon: Activity },
        { title: "Schema drift", description: "Upstream schema drift alerts.", href: "/platform?page=schema-drift", icon: GitBranch },
      ]}
      kpiIds={["reliability.dr_drills_last_90d","ai.usage_events_24h"]}
    />
  ),
});
