import { Badge } from "@/components/ui/badge";
import type { ResourceAccessSummary } from "@/lib/resource-access-summaries.functions";

type Props = {
  summary?: ResourceAccessSummary;
  available: boolean;
  mode?: "compact" | "detail";
  publicIdFallback?: string | null;
  section?: "all" | "identity" | "business-units" | "user-groups";
};

function NameList({ label, names, count, compact }: { label: string; names: string[]; count: number; compact: boolean }) {
  if (count <= 0 || names.length === 0) return <span className="text-xs text-muted-foreground">{label}: None</span>;
  const visible = compact ? names.slice(0, 1) : names;
  const remaining = Math.max(count - visible.length, 0);
  return <span className="flex flex-wrap items-center gap-1" aria-label={`${count} ${label.toLowerCase()}`}>
    {compact ? <span className="mr-1 text-[11px] text-muted-foreground">{count} {label.toLowerCase()}</span> : null}
    {visible.map((name) => <Badge key={name} variant="outline" className="max-w-full truncate text-[10px] font-normal">{name}</Badge>)}
    {remaining > 0 ? <Badge variant="secondary" className="text-[10px]">+{remaining}</Badge> : null}
  </span>;
}

export function ResourceIdentitySummary({ summary, available, mode = "compact", publicIdFallback, section = "all" }: Props) {
  const compact = mode === "compact";
  const publicId = summary?.public_id ?? publicIdFallback ?? null;
  const unavailable = !available || !summary;
  const unassigned = !unavailable && summary.access_state === "unmapped";

  return <div className={compact ? "min-w-24 space-y-1" : "space-y-4 border-t pt-4"}>
    {section === "all" || section === "identity" ? <div>
      {!compact ? <div className="text-xs font-medium text-muted-foreground">Public ID</div> : null}
      <div className="font-mono text-xs" aria-label="Public ID">{publicId ?? "ID pending setup"}</div>
    </div> : null}
    {unavailable && section !== "identity" ? <p role="status" className="text-xs text-muted-foreground">Access mapping unavailable</p> : null}
    {!unavailable && unassigned && (section === "all" || section === "business-units" || section === "user-groups") ? (
      <div className={compact ? "space-y-1" : "space-y-3"}>
        {section === "all" || section === "business-units" ? <><div className="text-xs text-muted-foreground">Business units</div><Badge variant="secondary">Unassigned</Badge></> : null}
        {section === "all" || section === "user-groups" ? <><div className="text-xs text-muted-foreground">User groups</div><span className="text-xs text-muted-foreground">None</span></> : null}
      </div>
    ) : !unavailable && !unassigned && (section === "all" || section === "business-units" || section === "user-groups") ? (
      <div className={compact ? "space-y-1" : "space-y-3"}>
        {section === "all" || section === "business-units" ? <NameList label="Business units" names={summary.business_unit_names} count={summary.business_unit_count} compact={compact} /> : null}
        {section === "all" || section === "user-groups" ? <NameList label="User groups" names={summary.user_group_names} count={summary.user_group_count} compact={compact} /> : null}
      </div>
    ) : null}
  </div>;
}
