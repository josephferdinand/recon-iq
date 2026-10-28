import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import { listMyWorkspaceAudit } from "@/lib/my-audit.functions";
import { useAccess } from "@/hooks/use-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryErrorFeedback } from "@/components/query-error-feedback";

export function MyAuditTrail({ tenantId }: { tenantId: string }) {
  const access = useAccess(tenantId);
  const actorId = access.access?.user_id;
  const [page, setPage] = useState(0);
  const fetchAudit = useServerFn(listMyWorkspaceAudit);

  useEffect(() => setPage(0), [tenantId, actorId]);

  const q = useQuery({
    queryKey: ["personal-workspace-audit", tenantId, actorId, page],
    queryFn: () => fetchAudit({ data: { tenant_id: tenantId, page } }),
    enabled: !!actorId && !access.isError,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });
  // Never render cached records from a previous signed-in actor.
  const result = !q.isError && !q.isFetching && q.data?.actor_id === actorId ? q.data : null;
  const rows = result?.rows ?? [];

  return (
    <section className="space-y-5" aria-labelledby="my-audit-heading">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="my-audit-heading" className="flex items-center gap-2 text-2xl font-semibold"><ShieldCheck className="h-5 w-5" aria-hidden /> My Audit Trail</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Recorded actions attributed to your signed-in account in this workspace. Tenant-wide and platform investigations remain in their separate administration areas.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => { if (access.isError || !actorId) void access.refetch(); else void q.refetch(); }} disabled={q.isFetching || access.isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Action history</CardTitle>
          <CardDescription>Newest recorded actions first. The server derives your actor identity from the verified session. Expand a record for its resource reference and stored integrity fields.</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isError ? <QueryErrorFeedback error={q.error} onRetry={q.refetch} resource="Your audit records" /> : access.isError ? (
            <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
              Your audit trail could not be loaded. Please try again or contact your administrator.
            </div>
          ) : !access.isLoading && !actorId ? (
            <p role="alert" className="py-8 text-sm text-muted-foreground">Your workspace identity could not be verified. Refresh access or contact your administrator; audit records have not been loaded.</p>
          ) : access.isLoading || q.isLoading || q.isFetching || !result ? (
            <p role="status" className="py-8 text-sm text-muted-foreground">Loading your recorded actions…</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">No recorded actions are visible on this page for your account.</p>
          ) : (
            <ol className="relative space-y-0 border-l border-border/70 pl-6" aria-label="Your recorded actions">
              {rows.map((row) => (
                <li key={String(row.id)} className="relative border-b border-border/60 py-4 last:border-0">
                  <span aria-hidden className="absolute -left-[29px] top-6 h-2.5 w-2.5 rounded-full bg-[var(--brand-gold)] ring-4 ring-background" />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{row.action.replaceAll(".", " · ").replaceAll("_", " ")}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {row.scope ? <Badge variant="outline">{row.scope}</Badge> : null}
                        {row.resource_type ? <Badge variant="secondary">{row.resource_type.replaceAll("_", " ")}</Badge> : null}
                      </div>
                    </div>
                    <time dateTime={row.occurred_at} className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {new Date(row.occurred_at).toLocaleString()}
                    </time>
                  </div>
                  <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Recorded details</summary><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[10rem_1fr]"><dt className="text-muted-foreground">Audit record ID</dt><dd className="break-all">{String(row.id)}</dd><dt className="text-muted-foreground">Resource reference</dt><dd className="break-all">{row.resource_id ?? "Not recorded"}</dd><dt className="text-muted-foreground">Recorded row hash</dt><dd className="break-all font-mono">{row.row_hash || "Not returned"}</dd><dt className="text-muted-foreground">Recorded previous hash</dt><dd className="break-all font-mono">{row.prev_hash ?? "No previous hash recorded"}</dd></dl><p className="mt-3 text-xs text-muted-foreground">These are stored integrity fields. This screen has not verified the audit chain. Raw context, credentials and network identifiers are not loaded.</p></details>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
      {result?.window_limit_reached ? <p className="text-sm text-muted-foreground">The personal history window ends here. More recorded actions exist beyond this bounded view; request an authorized deeper investigation from your administrator.</p> : null}

      <div className="flex items-center justify-between gap-3" aria-label="Audit trail pages">
        <Button type="button" variant="outline" disabled={page === 0 || q.isFetching} onClick={() => setPage((n) => Math.max(0, n - 1))}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Newer
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">Page {page + 1}</span>
        <Button type="button" variant="outline" disabled={!result?.has_more || q.isFetching} onClick={() => setPage((n) => n + 1)}>
          Older <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
        </Button>
      </div>
    </section>
  );
}
