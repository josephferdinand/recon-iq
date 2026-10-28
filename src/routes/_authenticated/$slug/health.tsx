import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { TenantHealthWidget } from "@/components/tenant-health-widget";
import { ExceptionForecastWidget } from "@/components/exception-forecast-widget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Sparkles } from "lucide-react";

const parentRoute = getRouteApi("/_authenticated/$slug");

export const Route = createFileRoute("/_authenticated/$slug/health")({
  component: TenantHealthPage,
});

function TenantHealthPage() {
  const { tenant } = parentRoute.useLoaderData() as { tenant: { id: string; slug: string; name: string } };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Tenant health dashboard</h1>
          <Badge variant="outline">{tenant.name}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Composite reconciliation health for this workspace — match quality, exception volume,
          time-to-resolve, rule coverage and AI confidence.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TenantHealthWidget tenantId={tenant.id} />
        <ExceptionForecastWidget tenantId={tenant.id} horizonDays={7} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">
            <Activity className="mr-1.5 inline h-4 w-4 text-muted-foreground" />
            How the score is computed
          </CardTitle>
          <CardDescription>30-day rolling window. Updated daily by cron.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Match quality (30%)" desc="matched ÷ (matched + unmatched) across all runs" />
          <Row label="Exception volume (20%)" desc="penalises open-exception backlog" />
          <Row label="Time-to-resolve (20%)" desc="median hours from created → resolved for closed exceptions" />
          <Row label="Rule coverage (15%)" desc="ratio of active rules to total" />
          <Row label="AI confidence (15%)" desc="avg confidence across ai_usage_events with payload.confidence" />
          <p className="pt-2 text-xs text-muted-foreground">
            <Sparkles className="mr-1 inline h-3 w-3" />
            Forecast model uses a 30-day daily mean + day-of-week factor + anomaly factor (1.5× if
            last 3 days &gt; 1.5× rolling median).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border/40 pt-2 first:border-t-0 first:pt-0">
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground">{desc}</div>
    </div>
  );
}