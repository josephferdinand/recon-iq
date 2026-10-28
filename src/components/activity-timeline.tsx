import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getActivityFor } from "@/lib/activity.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function ActivityTimeline({
  tenantId, resourceType, resourceId, limit = 50,
}: { tenantId: string; resourceType?: string; resourceId?: string; limit?: number }) {
  const fn = useServerFn(getActivityFor);
  const q = useQuery({
    queryKey: ["activity", tenantId, resourceType, resourceId, limit],
    queryFn: () => fn({ data: { tenant_id: tenantId, resource_type: resourceType, resource_id: resourceId, limit } }),
  });

  if (q.isLoading) return <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No activity yet. ReconIQ user actions (recon edits, sign-offs, role changes) will stream here in real time.</p>;

  return (
    <ol className="relative space-y-3 border-l pl-5">
      {rows.map((r: any) => (
        <li key={r.id} className="relative">
          <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="font-mono">{r.scope}</Badge>
            <span className="font-medium">{r.action}</span>
            {r.resource_type ? <span className="text-muted-foreground">{r.resource_type}</span> : null}
            <span className="ml-auto text-muted-foreground tabular-nums">{new Date(r.occurred_at).toLocaleString()}</span>
          </div>
          {r.context && Object.keys(r.context).length > 0 ? (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[10px] text-muted-foreground">{JSON.stringify(r.context, null, 2)}</pre>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
