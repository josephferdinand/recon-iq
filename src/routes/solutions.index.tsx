import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { BackButton } from "@/components/back-button";
import { SOLUTIONS_NAV } from "@/components/solution-page";
import { SOLUTIONS } from "@/lib/solutions-data";

export const Route = createFileRoute("/solutions/")({
  component: SolutionsIndex,
  head: () => ({
    meta: [
      { title: "Solutions — ReconIQ" },
      { name: "description", content: "Purpose-built AI reconciliation for cash & nostro, securities, payments, intercompany and regulatory reporting — designed for Tier-1 banks and regulated financial institutions." },
      { property: "og:title", content: "Reconciliation solutions by use case — ReconIQ" },
      { property: "og:description", content: "Cash, securities, payments, intercompany and regulatory reconciliation — AI-native, audit-grade, sovereign." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://app-fvi.reconiq.example/solutions" },
    ],
    links: [{ rel: "canonical", href: "https://app-fvi.reconiq.example/solutions" }],
  }),
});

function SolutionsIndex() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fvi-marketing-header sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <FviApprovedLogo className="h-11 w-11 rounded-sm" />
            <span className="font-display text-sm font-semibold">ReconIQ</span>
          </Link>
          <div className="flex items-center gap-3">
            <BackButton fallbackTo="/" label="Back to home" className="fvi-marketing-header-back" />
            <Link
              to="/book-demo"
              data-marketing-cta
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Book demo
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="inline-flex items-center rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          Solutions
        </div>
        <h1 className="mt-6 font-display text-4xl font-medium tracking-tight md:text-5xl">
          Reconciliation, purpose-built for your use case.
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-muted-foreground">
          One AI-native platform. Five deeply-modelled reconciliation domains. Choose the workflow closest to yours.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {SOLUTIONS_NAV.map((nav) => {
            const spec = SOLUTIONS[nav.slug];
            return (
              <Link
                key={nav.slug}
                to="/solutions/$slug"
                params={{ slug: nav.slug }}
                className="group rounded-xl border border-border/60 bg-card p-6 transition hover:border-primary/50 hover:bg-muted/30"
              >
                <div className="text-xs uppercase tracking-widest text-muted-foreground">{spec.eyebrow}</div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <h2 className="font-display text-xl font-medium tracking-tight">{spec.title}</h2>
                  <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{spec.subtitle}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {spec.heroStat.slice(0, 3).map((s) => (
                    <span key={s.label} className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
                      <strong className="text-foreground">{s.value}</strong> · {s.label}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </main>

      <footer className="mt-16 border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} ReconIQ. All rights reserved.
      </footer>
    </div>
  );
}

export { notFound };
