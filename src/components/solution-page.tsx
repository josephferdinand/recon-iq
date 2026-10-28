import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { BackButton } from "@/components/back-button";

export interface SolutionSpec {
  slug: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  heroStat: { value: string; label: string }[];
  personas: string[];
  painPoints: { title: string; body: string }[];
  capabilities: { icon: LucideIcon; title: string; body: string }[];
  dataSources: string[];
  outcomes: { metric: string; label: string }[];
  compliance: string[];
  faq: { q: string; a: string }[];
}

const SOLUTIONS_NAV: { slug: string; label: string }[] = [
  { slug: "cash-reconciliation", label: "Cash & Nostro" },
  { slug: "securities-reconciliation", label: "Securities" },
  { slug: "payments-reconciliation", label: "Payments" },
  { slug: "intercompany-reconciliation", label: "Intercompany & GL" },
  { slug: "regulatory-reconciliation", label: "Regulatory Reporting" },
];

export function SolutionPage({ spec }: { spec: SolutionSpec }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="fvi-marketing-header sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <FviApprovedLogo className="h-7 w-7" />
            <span className="font-display text-sm font-semibold">ReconIQ</span>
          </Link>
          <nav className="hidden items-center gap-5 text-xs text-muted-foreground md:flex">
            <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link to="/security" className="hover:text-foreground">Security</Link>
            <Link to="/developers" className="hover:text-foreground">Developers</Link>
            <Link to="/roi" className="hover:text-foreground">ROI</Link>
            <Link to="/contact" className="hover:text-foreground">Contact</Link>
          </nav>
          <Link
            to="/book-demo"
            data-marketing-cta
            className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Book demo
          </Link>
        </div>
      </header>

      {/* Solutions sub-nav */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-6 py-2 text-xs">
          <BackButton fallbackTo="/solutions" label="Back" className="mr-1 shrink-0" />
          <span className="whitespace-nowrap px-2 py-1 text-muted-foreground">Solutions:</span>
          {SOLUTIONS_NAV.map((s) => {
            const active = s.slug === spec.slug;
            return (
              <Link
                key={s.slug}
                to="/solutions/$slug"
                params={{ slug: s.slug }}
                className={`whitespace-nowrap rounded-full px-3 py-1 transition ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-16">
        {/* Hero */}
        <section>
          <div className="inline-flex items-center rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            {spec.eyebrow}
          </div>
          <h1 className="mt-6 font-display text-4xl font-medium tracking-tight md:text-5xl">
            {spec.title}
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-muted-foreground">{spec.subtitle}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/book-demo"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Book a 30-min demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/roi"
              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              Estimate your ROI
            </Link>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {spec.heroStat.map((s) => (
              <div key={s.label} className="rounded-lg border border-border/60 bg-card p-5">
                <div className="font-display text-3xl font-medium tracking-tight">{s.value}</div>
                <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {spec.personas.map((p) => (
              <span key={p} className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                For {p}
              </span>
            ))}
          </div>
        </section>

        {/* Pain points */}
        <section className="mt-20">
          <h2 className="font-display text-2xl font-medium tracking-tight md:text-3xl">
            The reconciliation problems this solves
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {spec.painPoints.map((p) => (
              <div key={p.title} className="rounded-lg border border-border/60 bg-card p-6">
                <div className="text-sm font-semibold">{p.title}</div>
                <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Capabilities */}
        <section className="mt-20">
          <h2 className="font-display text-2xl font-medium tracking-tight md:text-3xl">
            What ReconIQ does for this use case
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {spec.capabilities.map((c) => (
              <div key={c.title} className="rounded-lg border border-border/60 bg-card p-5">
                <c.icon className="h-5 w-5 text-primary" />
                <div className="mt-3 text-sm font-semibold">{c.title}</div>
                <p className="mt-1.5 text-sm text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Data sources + outcomes */}
        <section className="mt-20 grid gap-8 md:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-card p-6">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Data sources supported</div>
            <ul className="mt-4 space-y-2 text-sm">
              {spec.dataSources.map((d) => (
                <li key={d} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-6">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Measurable outcomes</div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {spec.outcomes.map((o) => (
                <div key={o.label}>
                  <div className="font-display text-2xl font-medium">{o.metric}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{o.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Compliance */}
        <section className="mt-20 rounded-xl border border-border/60 bg-gradient-to-br from-muted/40 to-transparent p-8">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-6 w-6 text-primary" />
            <div>
              <h2 className="font-display text-2xl font-medium tracking-tight">Aligned to the regulations that matter here</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Controls designed against the frameworks Tier-1 buyers require. See <Link to="/security" className="underline">Security &amp; Compliance</Link> for the full matrix.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {spec.compliance.map((c) => (
                  <span key={c} className="rounded-full border border-border/60 bg-background px-3 py-1 text-xs">{c}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-20">
          <h2 className="font-display text-2xl font-medium tracking-tight md:text-3xl">Frequently asked</h2>
          <div className="mt-8 divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
            {spec.faq.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
                  {f.q}
                  <span className="text-muted-foreground transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mt-20 rounded-xl border border-border bg-gradient-to-br from-primary/10 via-background to-background p-10 text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight">See it on your data</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            30 minutes with a solutions engineer, walking a real {spec.eyebrow.toLowerCase()} workflow end-to-end.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/book-demo" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
              Book a demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/due-diligence" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium hover:bg-muted">
              Request due-diligence pack
            </Link>
          </div>
        </section>
      </main>

      <footer className="mt-16 border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} ReconIQ. All rights reserved.
      </footer>
    </div>
  );
}

export { SOLUTIONS_NAV };
