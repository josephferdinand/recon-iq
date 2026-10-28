import { createFileRoute, Link } from "@tanstack/react-router";
import { listPublicRetentionPolicies } from "@/lib/retention.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/retention")({
  loader: () => listPublicRetentionPolicies(),
  errorComponent: () => (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-medium text-[#f5f5f7]">Something Didn't Go As Planned</h1>
      <p className="mt-3 text-sm text-[#a1a1a6]">
        We couldn't load the retention policy just now. Please try again in a few moments.
      </p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-medium text-[#f5f5f7]">Nothing To Display Yet</h1>
      <p className="mt-3 text-sm text-[#a1a1a6]">
        We couldn't find the page you were looking for. Please check the address, or return to the homepage.
      </p>
    </div>
  ),
  head: () => ({
    meta: [
      { title: "Data Retention Policy — ReconIQ" },
      { name: "description", content: "How long ReconIQ keeps each class of customer data, the regulatory basis, and how to request a copy or erasure under GDPR Articles 15 and 17." },
      { property: "og:title", content: "Data Retention Policy — ReconIQ" },
      { property: "og:description", content: "Default retention windows, archival posture, and GDPR data-subject request process for the ReconIQ platform." },
      { property: "og:url", content: "https://reconintelligence.app/retention" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/retention" }],
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
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[#86868b]">
            <ShieldCheck className="h-3.5 w-3.5" /> ReconIQ
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Data Retention &amp; Archival Policy</h1>
          <p className="mt-3 leading-relaxed text-[#a1a1a6]">
            ReconIQ retains customer data only as long as required to deliver the service, satisfy legal and regulatory obligations, and support audit. Tenants may extend retention per data class; reductions below the platform minimum are not permitted.
          </p>
        </header>

        <Card className="border-white/10 bg-[#161617] text-[#f5f5f7] shadow-none">
          <CardHeader>
            <CardTitle>Platform defaults</CardTitle>
            <CardDescription className="text-[#a1a1a6]">Minimum retention periods applied across all tenants.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <h2 className="font-display text-lg font-medium text-[#f5f5f7]">Nothing To Display Yet</h2>
                <p className="mt-2 text-sm text-[#a1a1a6]">
                  No retention policies are published right now. Please check back later, or contact us via the contact form if you need a copy today.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-white/10 bg-white/5 text-left text-xs uppercase text-[#86868b]">
                  <tr><th className="px-4 py-2">Data class</th><th className="px-4 py-2">Retention</th><th className="px-4 py-2">Basis</th></tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => {
                    const h = HUMAN[r.table_name] ?? { title: r.table_name, desc: "" };
                    return (
                      <tr key={r.table_name} className="border-b border-white/10 align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#f5f5f7]">{h.title}</div>
                          <div className="text-xs text-[#a1a1a6]">{h.desc}</div>
                        </td>
                        <td className="px-4 py-3"><Badge variant="outline" className="border-white/20 text-[#f5f5f7]">{r.retention_days} days</Badge></td>
                        <td className="px-4 py-3 text-xs text-[#a1a1a6]">{r.regulatory_basis ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <section className="mt-12 space-y-6 text-sm leading-6 text-[#a1a1a6]">
          <div>
            <h2 className="mb-2 text-base font-semibold text-[#f5f5f7]">What we store and why</h2>
            <p>We store the records you upload (statements, trades, GL extracts), the matches and breaks our engine produces, and the operational metadata needed to audit, secure, bill, and improve the service. We do not sell customer data and we do not use it to train third-party models.</p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-[#f5f5f7]">Tenant overrides</h2>
            <p>Tenant administrators can extend retention for any tenant-configurable class up to 10 years from <code className="rounded bg-white/10 px-1.5 py-0.5 text-[#f5f5f7]">Tenant Admin → Settings → Data retention</code>. Reductions below the platform floor are rejected by the database. The <strong className="text-[#f5f5f7]">audit_log</strong> class is regulatory-fixed and not configurable.</p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-[#f5f5f7]">Purge cadence &amp; cold-storage archive</h2>
            <p>Nightly server-side jobs purge data past its effective retention; every purge bucket emits a <code className="rounded bg-white/10 px-1.5 py-0.5 text-[#f5f5f7]">security_events</code> row of type <code className="rounded bg-white/10 px-1.5 py-0.5 text-[#f5f5f7]">retention.purge</code>. Where an archive prefix is configured, rows are copied to write-once, region-pinned object storage with SHA-256 anchoring before deletion.</p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-[#f5f5f7]">How to request a copy of your data (GDPR Art. 15)</h2>
            <p>Contact us via <Link className="text-[#2997ff] underline underline-offset-4" to="/contact">the contact form</Link> from the account-owner address. We respond within 30 days with a verified-identity machine-readable export covering every system of record listed above.</p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-[#f5f5f7]">How to request deletion (GDPR Art. 17)</h2>
            <p>Account-closure deletion completes within 30 days. Records we are obliged to retain by law — primarily the hash-chained audit log under SOX / SOC 2 — are preserved in immutable storage until their statutory window expires, and you receive a written list of what was retained and why.</p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-[#f5f5f7]">Sub-processors</h2>
            <p>Our current sub-processor list, with regions and processing purposes, lives at <a className="text-[#2997ff] underline underline-offset-4" href="/sub-processors">/sub-processors</a> and is versioned in the Trust Center.</p>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold text-[#f5f5f7]">Changes to this policy</h2>
            <p>Material changes are governed by the Terms of Service and notified by email to billing and security contacts at least 30 days before they take effect. Historical versions are kept in the Trust Center.</p>
          </div>
          <p className="pt-4 text-xs">Questions? Contact us via <Link className="text-[#2997ff] underline underline-offset-4" to="/contact">the contact form</Link>.</p>
        </section>

      </main>
      <MarketingFooter />
    </div>
  );
}
