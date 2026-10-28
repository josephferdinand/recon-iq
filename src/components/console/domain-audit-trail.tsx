/**
 * DomainAuditTrail — consolidated ABAC-aware audit feed for the Domain Console.
 * Shows DQ, lineage, and ABAC actions. Optionally scoped to a single resource.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";
import { listDomainAuditTrail } from "@/lib/domain-console.functions";

type Row = {
  id: number;
  occurred_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any> | null;
};

const ACTION_TONE: Record<string, string> = {
  "dq.samples.view": "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  "dq.rule.upsert": "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  "lineage.node.view": "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
  "lineage.pair.view": "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
  "rbac.abac.create": "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  "rbac.abac.update": "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  "rbac.abac.delete": "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  "access.denied": "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export function DomainAuditTrail({
  tenantId,
  resourceType,
  resourceId,
  compact = false,
}: {
  tenantId: string;
  resourceType?: string;
  resourceId?: string;
  compact?: boolean;
}) {
  const fn = useServerFn(listDomainAuditTrail);
  const q = useQuery({
    queryKey: ["domain-audit", tenantId, resourceType ?? "-", resourceId ?? "-"],
    queryFn: () =>
      fn({
        data: {
          tenant_id: tenantId,
          resource_type: resourceType,
          resource_id: resourceId,
          limit: compact ? 15 : 100,
        },
      }),
  });

  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  const rows = (q.data ?? []) as Row[];

  const body = (
    <div className="space-y-1.5">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No audit events recorded yet for this scope.
        </p>
      ) : (
        rows.map((r) => {
          const tone = ACTION_TONE[r.action] ?? "border-border";
          const masked = Number(r.context?.masked_cells ?? 0);
          const preds = Number(r.context?.abac_predicates_evaluated ?? 0);
          return (
            <div key={r.id} className="flex items-start gap-2 rounded-md border p-2 text-xs">
              <Badge variant="outline" className={`shrink-0 ${tone}`}>{r.action}</Badge>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-muted-foreground">
                    {new Date(r.occurred_at).toLocaleString()}
                  </span>
                  <span>·</span>
                  <span className="truncate">{r.actor_email ?? r.actor_user_id ?? "system"}</span>
                  {r.resource_type && (
                    <>
                      <span>·</span>
                      <code className="text-[10px]">{r.resource_type}</code>
                    </>
                  )}
                  {r.resource_id && <code className="text-[10px] truncate">{r.resource_id}</code>}
                </div>
                {(masked > 0 || preds > 0) && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    {preds > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> {preds} ABAC predicate{preds === 1 ? "" : "s"} evaluated
                      </span>
                    )}
                    {masked > 0 && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                        {masked} cell{masked === 1 ? "" : "s"} masked
                      </span>
                    )}
                    {Array.isArray(r.context?.masked_fields) && r.context!.masked_fields.length > 0 && (
                      <span className="truncate">
                        fields: <code>{(r.context!.masked_fields as string[]).join(", ")}</code>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  if (compact) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit trail</CardTitle>
        <CardDescription>
          ABAC-aware, hash-chained. Every DQ sample view, lineage drill, and ABAC change is captured with masked-cell counts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[540px] pr-3">{body}</ScrollArea>
      </CardContent>
    </Card>
  );
}
