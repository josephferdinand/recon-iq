import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Download, RefreshCw, FileClock, ExternalLink } from "lucide-react";
import { listSoc2EvidenceBundles, regenerateSoc2BundleSignedUrl } from "@/lib/soc2-evidence-bundle.functions";

export const Route = createFileRoute("/_authenticated/security-appendix/bundles")({
  head: () => ({
    meta: [
      { title: "SOC 2 Evidence Bundle Registry — ReconIQ" },
      { name: "description", content: "Every generated SOC 2 evidence bundle with requester, timestamp, download count, expiry, and linked audit-log entry." },
    ],
  }),
  component: BundlesRegistryPage,
});

function fmtBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function BundlesRegistryPage() {
  const list = useServerFn(listSoc2EvidenceBundles);
  const regen = useServerFn(regenerateSoc2BundleSignedUrl);

  const query = useQuery({
    queryKey: ["soc2-bundles"],
    queryFn: () => list({ data: { limit: 100 } }),
  });

  const regenMutation = useMutation({
    mutationFn: (bundle_id: string) => regen({ data: { bundle_id, expiry_minutes: 15 } }),
    onSuccess: (res) => {
      window.location.href = res.signed_url;
      toast.success(`Signed download URL issued — expires ${new Date(res.expires_at).toLocaleTimeString()}.`);
      query.refetch();
    },
    onError: (err: any) => toast.error(err?.message ?? "Cannot re-issue signed URL."),
  });

  const bundles = query.data?.bundles ?? [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">SOC 2 evidence</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FileClock className="h-7 w-7 text-primary" aria-hidden />
            Evidence bundle registry
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Every SOC 2 evidence ZIP that has been generated. Rows are RLS-scoped to bundles you are authorized to see.
            Re-download issues a fresh 15-minute signed URL and is itself audit-logged.
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden />
          Refresh
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {bundles.length} bundle{bundles.length === 1 ? "" : "s"} visible to you
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : bundles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bundles yet. Generate one from the{" "}
              <Link to="/security-appendix" className="text-primary underline">Security Appendix</Link>.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Generated</TableHead>
                  <TableHead>Bundle ID</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Downloads</TableHead>
                  <TableHead>Audit</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bundles.map((b: any) => {
                  const expired = new Date(b.expires_at).getTime() < Date.now();
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(b.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{b.bundle_id}</TableCell>
                      <TableCell>
                        <Badge variant={b.scope === "platform" ? "default" : "secondary"}>{b.scope}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{b.requester_email ?? "—"}</div>
                        <div className="font-mono text-muted-foreground">{b.requester_user_id?.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.row_count}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtBytes(b.bytes)}</TableCell>
                      <TableCell className="text-xs">{b.window_days} d</TableCell>
                      <TableCell className={`whitespace-nowrap text-xs ${expired ? "text-destructive" : ""}`}>
                        {new Date(b.expires_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.download_count}</TableCell>
                      <TableCell className="text-xs">
                        {b.audit_log_id ? (
                          <Link
                            to="/$slug/security-audit"
                            params={{ slug: "fvihq-prod" }}
                            search={{ audit_id: b.audit_log_id } as never}
                            className="inline-flex items-center gap-1 text-primary underline"
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            log
                          </Link>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={regenMutation.isPending}
                          onClick={() => regenMutation.mutate(b.bundle_id)}
                        >
                          <Download className="h-3 w-3" aria-hidden />
                          {expired ? "Re-issue link" : "Download"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
