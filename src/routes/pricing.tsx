import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowRight } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
  head: () => ({
    meta: [
      { title: "Pricing — ReconIQ" },
      { name: "description", content: "ReconIQ is priced by scope, not per seat. Tell us about your reconciliation volumes and controls, and we will propose a plan that fits." },
      { property: "og:title", content: "Pricing — ReconIQ" },
      { property: "og:description", content: "Enterprise reconciliation, priced by scope. Contact us for a plan that fits." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/pricing" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/pricing" }],
  }),
});

const TIERS = [
  {
    name: "Professional",
    tag: "For teams standardising reconciliation across a focused set of accounts",
    bullets: [
      "Deterministic matching and break management",
      "AI-assisted break explanations with human approval",
      "Hash-chained, exportable audit trail",
      "Support by email",
    ],
    cta: { label: "Contact us" as const },
  },
  {
    name: "Institutional",
    tag: "For institutions reconciling across entities, currencies, and control teams",
    highlight: true,
    bullets: [
      "Everything in Professional",
      "Multi-entity reconciliation scope",
      "Roles, approvals, and segregation of duties",
      "Single sign-on (SSO) configuration",
      "Priority support",
    ],
    cta: { label: "Contact us" as const },
  },
  {
    name: "Enterprise",
    tag: "For custom volumes, complex estates, and formal vendor due diligence",
    bullets: [
      "Everything in Institutional",
      "Custom volumes and onboarding plan",
      "Security review and due-diligence pack",
      "Named support contact",
    ],
    cta: { label: "Contact us" as const },
  },
];

function Pricing() {
  return (
    <div className="min-h-screen bg-[var(--mkt-bg)] text-[var(--mkt-text)] transition-colors duration-300">
      <MarketingNav />

      <main className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">
            Pricing
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl">
            Priced for enterprise scale — not per seat
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[var(--mkt-text-2)]">
            ReconIQ is scoped to your reconciliation volumes, data sources, and control
            requirements, so we don&rsquo;t publish a rate card. Tell us what you reconcile
            and we&rsquo;ll propose a plan that fits.
          </p>
        </div>

        <div className="mt-16 grid gap-5 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`flex flex-col rounded-2xl border p-8 ${
                t.highlight ? "border-[var(--mkt-line-strong)] bg-[var(--mkt-surface-2)]" : "border-[var(--mkt-line)] bg-[var(--mkt-surface)]"
              }`}
            >
              <h2 className="font-display text-2xl font-medium tracking-tight">{t.name}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--mkt-text-2)]">{t.tag}</p>
              <ul className="mt-8 space-y-3 text-sm">
                {t.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mkt-accent)]" />
                    <span className="text-[var(--mkt-text-2)]">{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-8">
                <a
                  href={`/contact?plan=${encodeURIComponent(t.name)}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--mkt-btn-bg)] px-5 py-2.5 text-sm font-medium text-[var(--mkt-btn-text)] transition hover:opacity-85"
                >
                  {t.cta.label} <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-3xl rounded-2xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)] p-5 text-center text-sm leading-relaxed text-[var(--mkt-text-2)]">
          Every engagement starts with a short scoping conversation. Scope, terms, and
          pricing are confirmed in writing before any access is provisioned — requesting
          a plan does not create a subscription.
        </p>

        <div className="mt-20 text-center">
          <h2 className="font-display text-2xl font-medium tracking-tight md:text-3xl">Need to model the ROI first?</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--mkt-text-2)]">
            Use the interactive ROI estimator to project MTTR reduction, cost avoidance and payback period against your current recon volumes.
          </p>
          <Link to="/roi" className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--mkt-line)] px-6 py-3 text-sm font-medium text-[var(--mkt-text)] transition hover:bg-[var(--mkt-surface-2)]">
            Open ROI estimator <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
