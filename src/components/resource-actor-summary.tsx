import type { ResourceActorSummary } from "@/lib/resource-actor-summaries.functions";

type Props = {
  summary?: ResourceActorSummary;
  available: boolean;
  mode: "updated-line" | "detail";
};

function actorLabel(summary: ResourceActorSummary | undefined, available: boolean, kind: "created" | "updated") {
  if (!available || !summary) return kind === "created" ? "Creator unavailable" : "Editor unavailable";
  return kind === "created" ? summary.created_by_label : summary.updated_by_label;
}

export function ResourceActorSummary({ summary, available, mode }: Props) {
  if (mode === "updated-line") {
    const label = actorLabel(summary, available, "updated");
    return <span className="block text-xs text-muted-foreground">{available && summary?.updated_by_status === "known" ? `by ${label}` : label === "Unknown" ? "Editor unknown" : label === "Unattributed" ? "Unattributed update" : label}</span>;
  }
  return <dl className="grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
    <div><dt className="text-xs text-muted-foreground">Created by</dt><dd className="mt-1 break-words">{actorLabel(summary, available, "created")}</dd></div>
    <div><dt className="text-xs text-muted-foreground">Last updated by</dt><dd className="mt-1 break-words">{actorLabel(summary, available, "updated")}</dd></div>
  </dl>;
}
