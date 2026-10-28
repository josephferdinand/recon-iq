import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { SOLUTIONS_NAV } from "@/components/solution-page";
import { SOLUTIONS } from "@/lib/solutions-data";
import { appUrl } from "@/lib/cross-domain";

export const Route = createFileRoute("/solutions/")({
  component: SolutionsIndex,
  head: () => ({
    meta: [
      { title: "Solutions — ReconIQ" },
      { name: "description", content: "Reconciliation for cash and nostro, securities, payments, intercompany and regulatory reporting — deterministic matching, human-approved break resolution, and a hash-chained audit trail." },
      { property: "og:title", content: "Reconciliation solutions by use case — ReconIQ" },
      { property: "og:description", content: "Cash, securities, payments, intercompany and regulatory reconciliation in one platform." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/solutions" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/solutions" }],
  }),
});

function SolutionsIndex() {
  return (
    <div className="min-h-screen bg-black text-[#f5f5f7]">
      <MarketingNav />

      <main className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">
          Solutions
        </p>
        <h1 className="mt-6 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl">
          Reconciliation, purpose-built for your use case.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[#a1a1a6]">
          One platform, five reconciliation domains. Choose the workflow closest to yours.
        </p>

        <div className="mt-16 grid gap-5 md:grid-cols-2">
          {SOLUTIONS_NAV.map((nav) => {
            const spec = SOLUTIONS[nav.slug];
            return (
              <Link
                key={nav.slug}
                to="/solutions/$slug"
                params={{ slug: nav.slug }}
                className="group rounded-2xl border border-white/10 bg-[#161617] p-7 transition hover:border-white/25 hover:bg-[#1c1c1f]"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#86868b]">{spec.eyebrow}</div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <h2 className="font-display text-xl font-medium tracking-tight text-[#f5f5f7]">{spec.title}</h2>
                  <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-[#86868b] transition group-hover:translate-x-1 group-hover:text-[#2997ff]" />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#a1a1a6]">{spec.subtitle}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {spec.heroStat.slice(0, 3).map((s) => (
                    <span key={s.label} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-[#a1a1a6]">
                      <strong className="font-medium text-[#f5f5f7]">{s.value}</strong> · {s.label}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>

        <section className="mt-24 text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight md:text-4xl">See it working.</h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[#a1a1a6]">
            The product is live. Open the demo and run a reconciliation end to end — upload,
            matching, break resolution, and audit trail.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={appUrl("/auth")}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-white/85"
            >
              Try the live demo <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              to="/book-demo"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-[#f5f5f7] transition hover:bg-white/10"
            >
              Book a demo
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

export { notFound };
