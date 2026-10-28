import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BackButton } from "@/components/back-button";
import { getMarketplaceAnalytics } from "@/lib/marketplace-analytics.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/platform-marketplace-analytics")({
  head: () => ({
    meta: [
      { title: "Marketplace Analytics — Platform | ReconIQ" },
      {
        name: "description",
        content:
          "Install → usage → outcome telemetry across every Marketplace listing (recon, regulatory, AML, workflow, report, persona, parser, runbook, preset, email).",
      },
    ],
  }),
  component: MarketplaceAnalyticsPage,
});

function MarketplaceAnalyticsPage() {
  const fn = useServerFn(getMarketplaceAnalytics);
  const q = useQuery({ queryKey: ["mkt-analytics"], queryFn: () => fn() });

  const rows = q.data ?? [];
  const totals = rows.reduce(
    (a, r) => ({
      installs: a.installs + (r.install_count ?? 0),
      tenants: a.tenants + (r.installed_tenants ?? 0),
      workspaces: a.workspaces + (r.active_workspaces ?? 0),
      usage: a.usage + (r.usage_events ?? 0),
    }),
    { installs: 0, tenants: 0, workspaces: 0, usage: 0 },
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Platform</p>
        <h1 className="text-3xl font-semibold">Marketplace Analytics</h1>
        <p className="text-muted-foreground mt-1">
          One dashboard for install → usage → outcome across every listing kind and channel.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-4 mb-6">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total installs</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{totals.installs}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Installed tenants</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{totals.tenants}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Active workspaces</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{totals.workspaces}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Usage events</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{totals.usage}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top 200 listings</CardTitle></CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Installs</TableHead>
                  <TableHead className="text-right">Tenants</TableHead>
                  <TableHead className="text-right">Workspaces</TableHead>
                  <TableHead className="text-right">Usage</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.listing_id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell><Badge variant="outline">{r.kind}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{r.tier}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{r.channel}</Badge></TableCell>
                    <TableCell className="text-right">{r.install_count}</TableCell>
                    <TableCell className="text-right">{r.installed_tenants}</TableCell>
                    <TableCell className="text-right">{r.active_workspaces}</TableCell>
                    <TableCell className="text-right">{r.usage_events}</TableCell>
                    <TableCell className="text-right">
                      {r.rating_avg ? `${Number(r.rating_avg).toFixed(2)} (${r.rating_count})` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
