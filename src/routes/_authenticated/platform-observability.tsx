import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Activity, ShieldAlert, PlayCircle, ExternalLink, Gauge } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { getObservabilityStatus, emitTestObservabilityEvent } from "@/lib/observability.functions";

export const Route = createFileRoute("/_authenticated/platform-observability")({
  head: () => ({ meta: [
    { title: "APM & SIEM pipeline — ReconIQ Platform" },
    { name: "description", content: "Configure APM traces and SIEM security event pipeline. Setup runbook and live pipeline status." },
  ] }),
  component: ObservabilityPage,
});

function ObservabilityPage() {
  const statusFn = useServerFn(getObservabilityStatus);
  const testFn = useServerFn(emitTestObservabilityEvent);

  const status = useQuery({ queryKey: ["obs-status"], queryFn: () => statusFn() });

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (res) => toast.success(`Emitted synthetic span + event. trace_id=${res.trace_id.slice(0, 12)}…`),
    onError: (e: any) => toast.error(e?.message ?? "Test emit failed"),
  });

  const apmOk = !!status.data?.apm?.configured;
  const siemOk = !!status.data?.siem?.configured;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Platform observability</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Activity className="h-7 w-7 text-primary" aria-hidden />
          APM &amp; SIEM pipeline
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          ReconIQ streams APM traces and SIEM security events to configured collectors (Datadog, New Relic,
          Splunk, Elastic, etc.) via HTTPS. Configure the collectors below and validate the pipeline with
          a synthetic emission.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5 text-primary" aria-hidden />
              APM traces
              <Badge variant={apmOk ? "default" : "secondary"} className="ml-auto">
                {apmOk ? "configured" : "not configured"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Endpoint host:</span> <span className="font-mono">{status.data?.apm?.endpoint_host ?? "—"}</span></div>
            <div><span className="text-muted-foreground">Service tag:</span> <span className="font-mono">{status.data?.apm?.service_name ?? "fvi"}</span></div>
            <p className="text-xs text-muted-foreground">Set <code>APM_ENDPOINT</code>, <code>APM_API_KEY</code>, <code>APM_SERVICE_NAME</code> in project secrets.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-5 w-5 text-primary" aria-hidden />
              SIEM security events
              <Badge variant={siemOk ? "default" : "secondary"} className="ml-auto">
                {siemOk ? "configured" : "not configured"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Endpoint host:</span> <span className="font-mono">{status.data?.siem?.endpoint_host ?? "—"}</span></div>
            <p className="text-xs text-muted-foreground">Set <code>SIEM_ENDPOINT</code>, <code>SIEM_API_KEY</code> in project secrets. Splunk HEC, Elastic Common Schema, and Datadog Logs Intake supported.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Pipeline validation</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button className="gap-2" onClick={() => test.mutate()} disabled={test.isPending}>
            <PlayCircle className="h-4 w-4" aria-hidden />
            {test.isPending ? "Emitting…" : "Emit synthetic span + event"}
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/platform-pipeline-status">
              <Gauge className="h-4 w-4" aria-hidden /> Pipeline status &amp; alerts
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <a href="/api/appendix/apm-siem-setup.md" download>
              <ExternalLink className="h-4 w-4" aria-hidden /> Setup runbook &amp; dashboards
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
