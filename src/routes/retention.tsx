import { createFileRoute } from "@tanstack/react-router";
import { listPublicRetentionPolicies } from "@/lib/retention.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/retention")({
  loader: () => listPublicRetentionPolicies(),
  errorComponent: ({ error }) => <div className="p-10 text-sm text-destructive">{error instanceof Error ? error.message : "An unexpected error occurred."}</div>,
  notFoundComponent: () => <div className="p-10">Not found</div>,
  head: () => ({
    meta: [
      { title: "Data Retention Policy — ReconIQ" },
      { name: "description", content: "How long ReconIQ keeps each class of customer data, the regulatory basis, and how to request a copy or erasure under GDPR Articles 15 and 17." },
      { property: "og:title", content: "Data Retention Policy — ReconIQ" },
      { property: "og:description", content: "Default retention windows, archival posture, and GDPR data-subject request process for the ReconIQ platform." },
      { property: "og:url", content: "https://app.reconiq.example/retention" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://app.reconiq.example/retention" }],
  }),
  component: RetentionPublic,
});


const HUMAN: Record<string, { title: string; desc: string }> = {
  audit_log: { title: "Audit log", desc: "Hash-chained, append-only system audit. Never auto-purged — held for the full SOX 7-year window and archived to immutable cold storage thereafter." },
  ai_usage_events: { title: "AI usage telemetry", desc: "Per-call usage and cost metering supporting AI governance and chargeback." },
  security_events: { title: "Security events", desc: "Authentication, MFA, SSO and step-up events for SOC 2 CC7.2 investigation." },
  recon_runs: { title: "Reconciliation runs", desc: "Tenant-configurable. Default is 13 months to cover regulatory year-end review windows." },
  email_send_log: { title: "Email delivery log", desc: "Transactional and digest email delivery records for CAN-SPAM and bounce diagnostics." },
};

function RetentionPublic() {
  const rows = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-6"><BackButton fallbackTo="/" label="Back to home" /></div>
      <header className="mb-10">
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> ReconIQ
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Data Retention &amp; Archival Policy</h1>
        <p className="mt-3 text-muted-foreground">
          ReconIQ retains customer data only as long as required to deliver the service, satisfy legal and regulatory obligations, and support audit. Tenants may extend retention per data class; reductions below the platform minimum are not permitted.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Platform defaults</CardTitle>
          <CardDescription>Minimum retention periods applied across all tenants.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Data class</th><th className="px-4 py-2">Retention</th><th className="px-4 py-2">Basis</th></tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const h = HUMAN[r.table_name] ?? { title: r.table_name, desc: "" };
                return (
                  <tr key={r.table_name} className="border-b align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{h.title}</div>
                      <div className="text-xs text-muted-foreground">{h.desc}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline">{r.retention_days} days</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.regulatory_basis ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <section className="mt-12 space-y-6 text-sm leading-6 text-muted-foreground">
        <div>
          <h2 className="mb-2 text-base font-semibold text-foreground">What we store and why</h2>
          <p>We store the records you upload (statements, trades, GL extracts), the matches and breaks our engine produces, and the operational metadata needed to audit, secure, bill, and improve the service. We do not sell customer data and we do not use it to train third-party models.</p>
        </div>
        <div>
          <h2 className="mb-2 text-base font-semibold text-foreground">Tenant overrides</h2>
          <p>Tenant administrators can extend retention for any tenant-configurable class up to 10 years from <code className="rounded bg-muted px-1.5 py-0.5">Tenant Admin → Settings → Data retention</code>. Reductions below the platform floor are rejected by the database. The <strong>audit_log</strong> class is regulatory-fixed and not configurable.</p>
        </div>
        <div>
          <h2 className="mb-2 text-base font-semibold text-foreground">Purge cadence &amp; cold-storage archive</h2>
          <p>Nightly server-side jobs purge data past its effective retention; every purge bucket emits a <code className="rounded bg-muted px-1.5 py-0.5">security_events</code> row of type <code className="rounded bg-muted px-1.5 py-0.5">retention.purge</code>. Where an archive prefix is configured, rows are copied to write-once, region-pinned object storage with SHA-256 anchoring before deletion.</p>
        </div>
        <div>
          <h2 className="mb-2 text-base font-semibold text-foreground">How to request a copy of your data (GDPR Art. 15)</h2>
          <p>Email <a className="underline" href="mailto:privacy@reconiq.example">privacy@reconiq.example</a> from the account-owner address. We respond within 30 days with a verified-identity machine-readable export covering every system of record listed above.</p>
        </div>
        <div>
          <h2 className="mb-2 text-base font-semibold text-foreground">How to request deletion (GDPR Art. 17)</h2>
          <p>Account-closure deletion completes within 30 days. Records we are obliged to retain by law — primarily the hash-chained audit log under SOX / SOC 2 — are preserved in immutable storage until their statutory window expires, and you receive a written list of what was retained and why.</p>
        </div>
        <div>
          <h2 className="mb-2 text-base font-semibold text-foreground">Sub-processors</h2>
          <p>Our current sub-processor list, with regions and processing purposes, lives at <a className="underline" href="/sub-processors">/sub-processors</a> and is versioned in the Trust Center.</p>
        </div>
        <div>
          <h2 className="mb-2 text-base font-semibold text-foreground">Changes to this policy</h2>
          <p>Material changes are governed by the Terms of Service and notified by email to billing and security contacts at least 30 days before they take effect. Historical versions are kept in the Trust Center.</p>
        </div>
        <p className="pt-4 text-xs">Questions? Contact <a className="underline" href="mailto:privacy@reconiq.example">privacy@reconiq.example</a>.</p>
      </section>

    </main>
  );
}
