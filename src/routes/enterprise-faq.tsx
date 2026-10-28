import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ShieldCheck, MessageSquare, FileText, Building2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

const CATEGORIES: Array<{
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: Array<{ q: string; a: string }>;
}> = [
  {
    key: "security",
    icon: ShieldCheck,
    title: "Security & tenant isolation",
    items: [
      { q: "How do you prevent cross-tenant data leakage?", a: "Row-Level Security (RLS) on every tenant-scoped table, with security-definer helpers enforced on the server — never trusted from client code. Tenant boundaries are enforced in the database and checked in the server functions that run with the caller's session." },
      { q: "What is your incident response SLA?", a: "Our incident-response playbook covers triage, containment, eradication, recovery, and post-incident review. Customers are notified of confirmed security incidents affecting their tenant without undue delay, in line with contractual and statutory obligations — see the Security page for the full model." },
      { q: "Where are keys stored for BYO-LLM?", a: "Per-tenant encrypted vault row with envelope encryption. Keys never leave the server runtime and are never returned to the client. Every unwrap is audit-logged." },
      { q: "Have you completed an external penetration test?", a: "External pen test is scheduled in the current cycle. Continuous internal scans (SAST + dependency + RLS checks) run on every PR. The attestation letter is shareable under NDA when complete." },
      { q: "How is the admin surface protected?", a: "Cloudflare Access (Zero Trust) enforces SSO + device posture on all /admin/* routes, plus WAF Managed Rules and Bot Management at the edge." },
    ],
  },
  {
    key: "compliance",
    icon: FileText,
    title: "Compliance & audit",
    items: [
      { q: "Which certifications do you have today?", a: "None today — and we say so plainly. Controls are designed with reference to the SOC 2 Trust Services Criteria and ISO 27001 Annex A practices, and formal certification is on our roadmap. The Security page lists exactly what is aligned by design versus what is formally certified; we don't claim certifications we haven't earned." },
      { q: "How is audit evidence provided to enterprise buyers?", a: "A downloadable evidence bundle is available on demand from the in-app Security & Compliance Appendix — a ZIP containing categorized audit logs, control mapping, incident-response runbook, tenant-isolation summary, and a manifest. It supports your vendor-risk review today; it is not a SOC 2 report." },
      { q: "How long are audit logs retained?", a: "Data mutation and admin action logs are retained for 7 years. Read and authentication logs are retained for 400 days. All rows are append-only and hash-chained for tamper-evidence." },
      { q: "How do you handle regional data residency?", a: "Regional Supabase projects give in-region residency (India ap-south-1, EU eu-central-1, US us-east-1, APAC ap-southeast-1). GCC tenants receive a dedicated in-country custody path." },
    ],
  },
  {
    key: "commercial",
    icon: Building2,
    title: "Commercial & operations",
    items: [
      { q: "What is your uptime commitment?", a: "We publish a target availability on the Security page. Any contractual service-level commitment, and whether credits apply, is set out in your signed order form rather than promised on this page." },
      { q: "Can we get on-prem or private-cloud deployment?", a: "Today, SaaS-only on Cloudflare (edge) + Supabase (backend). Private-link tenancy is planned for anchor customers in the expand phase." },
      { q: "What is your data-portability / exit plan?", a: "Full CSV/Parquet export on demand plus a 30-day post-termination access window. Audit log export is included and tenant-scoped." },
      { q: "What sub-processors do you use?", a: "Cloudflare (CDN/WAF/Zero Trust), Supabase (Postgres/Auth/Storage), ReconIQ AI Router (BYO-LLM), and email/monitoring providers per tenant preference. Full sub-processor register with DPA dates available under NDA." },
    ],
  },
  {
    key: "ai",
    icon: MessageSquare,
    title: "AI & data usage",
    items: [
      { q: "Is our data used to train models?", a: "No. Tenant data is never used for training. The default AI Gateway is configured with no-training terms; BYO-LLM is optional and per-tenant." },
      { q: "How do you prevent AI hallucination in reconciliation?", a: "AI produces suggestions, never auto-approvals. Human-in-the-loop is the default. Confidence thresholds and audit trails apply. All AI-suggested actions are reversible." },
      { q: "Can we bring our own LLM keys?", a: "Yes. Per-tenant BYOK is supported for Muse, Anthropic, Azure Muse, and AWS Bedrock. Keys are stored envelope-encrypted and never returned to the client." },
      { q: "How do you handle prompt injection?", a: "Prompt firewall, tool allowlist per tenant, and RLS-enforced retrieval on any grounding data. Regular red-team eval targets reconciliation-specific jailbreaks." },
    ],
  },
];

export const Route = createFileRoute("/enterprise-faq")({
  head: () => ({
    meta: [
      { title: "Enterprise FAQ — ReconIQ" },
      { name: "description", content: "Self-serve answers to the most common enterprise security, compliance, commercial, and AI questions about ReconIQ." },
      { property: "og:title", content: "Enterprise FAQ — ReconIQ" },
      { property: "og:description", content: "Boardroom-grade answers on tenant isolation, security posture, SLA, exit, sub-processors, and AI/data usage." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/enterprise-faq" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/enterprise-faq" }],
  }),
  component: EnterpriseFaqPage,
});

function EnterpriseFaqPage() {
  return (
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
        <header className="mb-12 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#86868b]">Enterprise buyers</p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Enterprise FAQ</h1>
          <p className="mt-5 text-lg leading-relaxed text-[#a1a1a6]">
            The questions we get most often from CISO, procurement, and audit teams. If your question isn&apos;t
            here, request the full <Link to="/security" className="text-[#2997ff] underline underline-offset-4">Security &amp; Compliance</Link> pack.
          </p>
        </header>

        <div className="grid gap-6">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <Card key={cat.key} className="border-white/10 bg-[#161617] text-[#f5f5f7] shadow-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Icon className="h-5 w-5 text-[#2997ff]" aria-hidden />
                    {cat.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible className="w-full">
                    {cat.items.map((item, i) => (
                      <AccordionItem key={i} value={`${cat.key}-${i}`} className="border-white/10">
                        <AccordionTrigger className="text-left text-base font-medium text-[#f5f5f7] hover:text-white">{item.q}</AccordionTrigger>
                        <AccordionContent className="text-sm leading-relaxed text-[#a1a1a6]">
                          {item.a}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <section className="mt-12 rounded-2xl border border-white/10 bg-[#161617] p-6">
          <h2 className="text-lg font-semibold text-[#f5f5f7]">Need deeper answers?</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#a1a1a6]">
            Signed-in enterprise admins can generate a live evidence bundle from the
            in-app <span className="font-medium text-[#f5f5f7]">Security &amp; Compliance Appendix</span>.
            For pen-test attestation letters, sub-processor register, or a CISO deep-dive,{" "}
            <Link to="/contact" className="text-[#2997ff] underline underline-offset-4">contact us via the contact form</Link>.
          </p>
          <div className="mt-5">
            <Link
              to="/due-diligence"
              className="inline-flex items-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/85"
            >
              Request the due-diligence pack
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
