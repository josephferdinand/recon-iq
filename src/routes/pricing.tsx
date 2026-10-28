import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowRight } from "lucide-react";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
  head: () => ({
    meta: [
      { title: "Pricing — ReconIQ" },
      { name: "description", content: "Indicative ReconIQ pricing by active reconciliation volume. Plan limits and feature entitlements remain proposals pending application implementation." },
      { property: "og:title", content: "Pricing — ReconIQ" },
      { property: "og:description", content: "Enterprise pricing designed for regulated financial services." },
      { property: "og:type", content: "website" },
    ],
  }),
});

const TIERS = [
  {
    name: "Professional",
    tag: "For teams with up to 50 active reconciliations",
    price: "$60k / yr",
    bullets: [
      "50 active reconciliations total (proposed)",
      "Indicative annual price; final terms subject to agreement",
    ],
    cta: { label: "Request pricing" as const },
  },
  {
    name: "Institutional",
    tag: "For institutions with up to 100 active reconciliations",
    price: "$120k / yr",
    highlight: true,
    bullets: [
      "100 active reconciliations total (proposed)",
      "Indicative annual price; final terms subject to agreement",
    ],
    cta: { label: "Talk to sales" as const },
  },
  {
    name: "Enterprise",
    tag: "For custom active reconciliation volumes",
    price: "Custom",
    bullets: [
      "Volume and commercial scope confirmed with sales",
      "Feature entitlements pending application implementation",
    ],
    cta: { label: "Request briefing" as const },
  },
];

function Pricing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fvi-marketing-header sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <FviApprovedLogo className="h-11 w-11 rounded-sm" />
            <span className="font-display text-sm font-semibold">ReconIQ</span>
          </Link>
          <BackButton fallbackTo="/" label="Back to home" className="fvi-marketing-header-back" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <div className="inline-flex items-center rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            Pricing
          </div>
          <h1 className="mt-6 font-display text-4xl font-medium tracking-tight md:text-6xl">
            Priced for enterprise scale — <span className="text-primary">not per seat</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Published prices and active reconciliation counts are proposals pending application entitlement implementation. Request a commercial discussion to review fit.
          </p>
        </div>

        <p className="mx-auto mt-6 max-w-3xl rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          Published prices and reconciliation limits are proposals, not active subscription controls. Feature entitlements, including AI capabilities, are pending application implementation. Requesting pricing does not create a subscription or provision access.
        </p>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-2xl border p-8 ${
                t.highlight ? "border-primary/60 bg-primary/5 shadow-xl" : "border-border bg-card"
              }`}
            >
              {t.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground">
                  Most requested
                </div>
              )}
              <h2 className="font-display text-2xl font-semibold">{t.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t.tag}</p>
              <div className="mt-6 font-display text-3xl font-medium">{t.price}</div>
              <ul className="mt-8 space-y-3 text-sm">
                {t.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-8">
                <a
                  href={`/contact?plan=${encodeURIComponent(t.name)}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:brightness-110"
                >
                  {t.cta.label} <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 rounded-xl border border-border bg-card p-8 text-center">
          <h3 className="font-display text-xl font-semibold">Need to model the ROI first?</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Use the interactive ROI estimator to project MTTR reduction, cost avoidance and payback period against your current recon volumes.
          </p>
          <Link to="/roi" className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent">
            Open ROI estimator <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}
