import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowRight } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
  head: () => ({
    meta: [
      { title: "Pricing — ReconIQ" },
      { name: "description", content: "Indicative ReconIQ pricing by active reconciliation volume. Plan limits and feature entitlements remain proposals pending application implementation." },
      { property: "og:title", content: "Pricing — ReconIQ" },
      { property: "og:description", content: "Enterprise pricing designed for regulated financial services." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/pricing" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/pricing" }],
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
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />

      <main className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
            Pricing
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl">
            Priced for enterprise scale — not per seat
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[#a1a1a6]">
            Published prices and active reconciliation counts are proposals pending application entitlement implementation. Request a commercial discussion to review fit.
          </p>
        </div>

        <p className="mx-auto mt-10 max-w-3xl rounded-2xl border border-white/10 bg-[#161617] p-5 text-center text-sm leading-relaxed text-[#a1a1a6]">
          Published prices and reconciliation limits are proposals, not active subscription controls. Feature entitlements, including AI capabilities, are pending application implementation. Requesting pricing does not create a subscription or provision access.
        </p>

        <div className="mt-16 grid gap-5 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`flex flex-col rounded-2xl border p-8 ${
                t.highlight ? "border-white/25 bg-[#1c1c1f]" : "border-white/10 bg-[#161617]"
              }`}
            >
              <h2 className="font-display text-2xl font-medium tracking-tight">{t.name}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[#a1a1a6]">{t.tag}</p>
              <div className="mt-6 font-display text-3xl font-medium tracking-tight">{t.price}</div>
              <ul className="mt-8 space-y-3 text-sm">
                {t.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#2997ff]" />
                    <span className="text-[#a1a1a6]">{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-8">
                <a
                  href={`/contact?plan=${encodeURIComponent(t.name)}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
                >
                  {t.cta.label} <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-20 text-center">
          <h2 className="font-display text-2xl font-medium tracking-tight md:text-3xl">Need to model the ROI first?</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#a1a1a6]">
            Use the interactive ROI estimator to project MTTR reduction, cost avoidance and payback period against your current recon volumes.
          </p>
          <Link to="/roi" className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-[#f5f5f7] transition hover:bg-white/10">
            Open ROI estimator <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
