import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, FileArchive, ShieldCheck, Workflow, Database, AlertTriangle, BookOpen, FileText, ListChecks } from "lucide-react";
import { exportSoc2EvidenceBundle } from "@/lib/soc2-evidence-bundle.functions";

export const Route = createFileRoute("/_authenticated/security-appendix")({
  head: () => ({
    meta: [
      { title: "Security & Compliance Appendix — ReconIQ" },
      { name: "description", content: "Boardroom-ready security appendix. Generate signed, role-gated SOC 2 evidence bundles with short-lived download URLs." },
    ],
  }),
  component: SecurityAppendixPage,
});

const ARTIFACTS = [
  { key: "control-map", icon: ShieldCheck, title: "SOC 2 control mapping (CC-series)", desc: "Every shipped control mapped to CC6/7/8, A1, C1 with evidence pointers.", href: "/api/appendix/soc2-control-map.md" },
  { key: "tenant-iso", icon: Database, title: "Tenant isolation summary", desc: "Six-layer isolation model: identity, data, storage, compute, secrets, telemetry.", href: "/api/appendix/tenant-isolation.md" },
  { key: "ir", icon: Workflow, title: "Incident response playbook", desc: "6-phase runbook with SLAs and notification commitments.", href: "/api/appendix/incident-response.md" },
  { key: "dr", icon: AlertTriangle, title: "Backups & DR runbook", desc: "PITR, snapshot, and restore procedure with quarterly drill evidence.", href: "/api/appendix/backups-dr.md" },
  { key: "audit-coverage", icon: BookOpen, title: "Audit log coverage matrix", desc: "Eight event classes, retention, and tamper-evidence design.", href: "/api/appendix/audit-coverage.md" },
];

function SecurityAppendixPage() {
  const [days, setDays] = useState(90);
  const [expiryMin, setExpiryMin] = useState(15);
  const generate = useServerFn(exportSoc2EvidenceBundle);
  const mutation = useMutation({
    mutationFn: (opts: { days: number; expiry_minutes: number }) =>
      generate({ data: { days: opts.days, expiry_minutes: opts.expiry_minutes } }),
    onSuccess: (res) => {
      window.location.href = res.signed_url;
      toast.success(`Bundle ready — ${res.row_count} rows. Link expires at ${new Date(res.expires_at).toLocaleTimeString()}.`);
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to generate evidence bundle. Requires platform_admin or tenant_admin."),
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Boardroom-ready</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">Security &amp; Compliance Appendix</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted-foreground">
          Downloadable artifacts and a live SOC 2 evidence bundle generator. Bundles are
          role-gated, uploaded to a private storage bucket, and served via short-lived signed URLs.
          Every generation and re-download is audit-logged.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm" className="gap-2">
            <Link to="/security-appendix/bundles"><ListChecks className="h-4 w-4" aria-hidden /> Bundle registry</Link>
          </Button>
          <Button asChild variant="secondary" size="sm" className="gap-2">
            <Link to="/security-appendix/advisory"><FileText className="h-4 w-4" aria-hidden /> Advisory downloads (v3 &amp; v4)</Link>
          </Button>
        </div>
      </header>

      <Card className="mb-8 border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5 text-primary" aria-hidden />
            Generate live SOC 2 evidence bundle
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Compiles the last N days of audit events (SOC 2 categorized), control mapping,
            IR runbook, and tenant-isolation summary into a single ZIP.
            Requires <span className="font-medium text-foreground">platform_admin</span> or
            <span className="font-medium text-foreground"> tenant_admin</span>.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40">
              <Label htmlFor="days">Window (days)</Label>
              <Input id="days" type="number" min={1} max={400} value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(400, Number(e.target.value) || 90)))} />
            </div>
            <div className="w-40">
              <Label htmlFor="expiry">Link expiry (min)</Label>
              <Input id="expiry" type="number" min={5} max={120} value={expiryMin}
                onChange={(e) => setExpiryMin(Math.max(5, Math.min(120, Number(e.target.value) || 15)))} />
            </div>
            <Button onClick={() => mutation.mutate({ days, expiry_minutes: expiryMin })}
              disabled={mutation.isPending} className="gap-2">
              <Download className="h-4 w-4" aria-hidden />
              {mutation.isPending ? "Generating…" : "Generate & download (.zip)"}
            </Button>
            {mutation.data ? (
              <Badge variant="secondary" className="ml-2">
                {mutation.data.row_count} rows · expires {new Date(mutation.data.expires_at).toLocaleTimeString()}
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="artifacts-heading" className="grid gap-4 sm:grid-cols-2">
        <h2 id="artifacts-heading" className="sr-only">Reference artifacts</h2>
        {ARTIFACTS.map((a) => {
          const Icon = a.icon;
          return (
            <Card key={a.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  {a.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{a.desc}</p>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <a href={a.href} download>
                    <Download className="h-4 w-4" aria-hidden />
                    Download
                  </a>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </main>
  );
}
