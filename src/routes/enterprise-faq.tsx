import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ShieldCheck, MessageSquare, FileText, Building2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

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
      { q: "How do you prevent cross-tenant data leakage?", a: "Row-Level Security (RLS) on every tenant-scoped table, security-definer helpers (never expressed in client code), and a nightly cross-tenant fuzz test that asserts zero row leakage across 20 seeded tenants." },
      { q: "What is your incident response SLA?", a: "P1 acknowledgement within 15 minutes, containment within 60 minutes, and confirmed-tenant notification within 60 minutes of confirmed material impact." },
      { q: "Where are keys stored for BYO-LLM?", a: "Per-tenant encrypted vault row with envelope encryption. Keys never leave the server runtime and are never returned to the client. Every unwrap is audit-logged." },
      { q: "Have you completed an external penetration test?", a: "External pen test is scheduled in the current cycle. Continuous internal scans (SAST + dependency + RLS fuzz) run on every PR. The attestation letter is shareable under NDA when complete." },
      { q: "How is the admin surface protected?", a: "Cloudflare Access (Zero Trust) enforces SSO + device posture on all /admin/* routes, plus WAF Managed Rules and Bot Management at the edge." },
    ],
  },
  {
    key: "compliance",
    icon: FileText,
    title: "Compliance & audit",
    items: [
      { q: "Which certifications do you have today?", a: "SOC 2 Type I readiness letter today. SOC 2 Type II fieldwork begins day 120 of the current program. ISO 27001 target is 12-15 months. SOC 1 Type II (ICFR-relevant) is planned in the certify phase." },
      { q: "How is audit evidence provided to enterprise buyers?", a: "A downloadable SOC 2 evidence bundle is available on demand from the in-app Security & Compliance Appendix — a ZIP containing categorized audit logs, control mapping, IR runbook, tenant-isolation summary, and a manifest." },
      { q: "How long are audit logs retained?", a: "Data mutation and admin action logs are retained for 7 years. Read and authentication logs are retained for 400 days. All rows are append-only and hash-chained for tamper-evidence." },
      { q: "How do you handle regional data residency?", a: "Regional Supabase projects give in-region residency (India ap-south-1, EU eu-central-1, US us-east-1, APAC ap-southeast-1). GCC tenants receive a dedicated in-country custody path." },
    ],
  },
  {
    key: "commercial",
    icon: Building2,
    title: "Commercial & operations",
    items: [
      { q: "What is your uptime commitment?", a: "99.95% monthly with SLA credits under the paid-tier infrastructure. An error-budget policy governs release velocity." },
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
      { property: "og:description", content: "Boardroom-grade answers on tenant isolation, SOC 2 posture, SLA, exit, sub-processors, and AI/data usage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EnterpriseFaqPage,
});

function EnterpriseFaqPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Enterprise buyers</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">Enterprise FAQ</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted-foreground">
          The questions we get most often from CISO, procurement, and audit teams. If your question isn&apos;t
          here, request the full <Link to="/security" className="text-primary underline">Security &amp; Compliance</Link> pack.
        </p>
      </header>

      <div className="grid gap-6">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <Card key={cat.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  {cat.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {cat.items.map((item, i) => (
                    <AccordionItem key={i} value={`${cat.key}-${i}`}>
                      <AccordionTrigger className="text-left text-base font-medium">{item.q}</AccordionTrigger>
                      <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
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

      <section className="mt-10 rounded-lg border border-border bg-muted/50 p-6">
        <h2 className="text-lg font-semibold text-foreground">Need deeper answers?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed-in enterprise admins can generate a live SOC 2 evidence bundle from the
          in-app <span className="font-medium text-foreground">Security &amp; Compliance Appendix</span>.
          For pen-test attestation letters, sub-processor register, or a CISO deep-dive, contact
          your account team.
        </p>
      </section>
    </main>
  );
}
