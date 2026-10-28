import { createFileRoute } from "@tanstack/react-router";
import { HubShell } from "@/components/hub-shell";
import { Brain, Gauge, ShieldCheck, Coins, Activity, Rss } from "lucide-react";

export const Route = createFileRoute("/_authenticated/hub/ai-ops")({
  head: () => ({
    meta: [
      { title: "AI Ops — Platform | ReconIQ" },
      { name: "description", content: "One hub for AI governance, providers, budgets, chain health, and approvals." },
    ],
  }),
  component: () => (
    <HubShell
      eyebrow="Platform"
      title="AI Ops"
      intro="Single hub consolidating LLM providers, governance, budgets, approvals, and chain health across every AI surface."
      entries={[
        { title: "LLM providers & routes", description: "Provider registry, routing policies, per-tenant overrides.", href: "/platform?page=llm", icon: Brain },
        { title: "AI governance", description: "Toggles, drift, HITL queue, kill switches.", href: "/platform?page=ai-governance", icon: ShieldCheck },
        { title: "AI control plane", description: "Instances, quotas, model catalog, pricing.", href: "/platform?page=ai-control-plane", icon: Gauge },
        { title: "Budgets & FinOps", description: "Tenant AI budgets and usage limits.", href: "/$slug/ai-governance/finops", icon: Coins },
        { title: "Chain health", description: "End-to-end AI chain latency and failure telemetry.", href: "/$slug/ai-governance/chain-health", icon: Activity },
        { title: "Approvals queue", description: "Pending step-up and HITL approvals.", href: "/$slug/ai-governance/approvals", icon: Rss },
      ]}
      kpiIds={["ai.usage_events_24h","governance.hitl_queue_open"]}
    />
  ),
});
