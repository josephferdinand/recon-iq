import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { appUrl } from "@/lib/cross-domain";

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

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]";
const PANEL = "rounded-2xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)]";
const BODY = "text-[var(--mkt-text-2)]";

export function SolutionPage({ spec }: { spec: SolutionSpec }) {
  return (
    <div className="min-h-screen bg-[var(--mkt-bg)] text-[var(--mkt-text)] transition-colors duration-300">
      <MarketingNav />

      {/* Solutions sub-nav */}
      <div className="border-b border-[var(--mkt-line)] bg-[var(--mkt-bg-soft)]">
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-6 py-2.5 text-xs">
          <Link
            to="/solutions"
            className="mr-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--mkt-line)] px-3 py-1.5 text-[var(--mkt-text-2)] transition hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All solutions
          </Link>
          {SOLUTIONS_NAV.map((s) => {
            const active = s.slug === spec.slug;
            return (
              <Link
                key={s.slug}
                to="/solutions/$slug"
                params={{ slug: s.slug }}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 transition ${
                  active
                    ? "bg-[var(--mkt-btn-bg)] font-medium text-[var(--mkt-btn-text)]"
                    : "text-[var(--mkt-text-2)] hover:bg-[var(--mkt-surface-2)] hover:text-[var(--mkt-text)]"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        {/* Hero */}
        <section>
          <p className={EYEBROW}>{spec.eyebrow}</p>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl">
            {spec.title}
          </h1>
          <p className={`mt-5 max-w-2xl text-lg leading-relaxed ${BODY}`}>{spec.subtitle}</p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              to="/book-demo"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--mkt-btn-bg)] px-6 py-3 text-sm font-medium text-[var(--mkt-btn-text)] transition hover:opacity-85"
            >
              Book a demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/roi"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--mkt-line)] px-6 py-3 text-sm font-medium text-[var(--mkt-text)] transition hover:bg-[var(--mkt-surface-2)]"
            >
              Estimate your ROI
            </Link>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {spec.heroStat.map((s) => (
              <div key={s.label} className={`${PANEL} p-6`}>
                <div className="font-display text-2xl font-medium tracking-tight text-[var(--mkt-text)]">{s.value}</div>
                <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--mkt-text-3)]">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {spec.personas.map((p) => (
              <span key={p} className="rounded-full border border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3 py-1 text-xs text-[var(--mkt-text-2)]">
                For {p}
              </span>
            ))}
          </div>
        </section>

        {/* Pain points */}
        <section className="mt-24">
          <p className={EYEBROW}>The problem</p>
          <h2 className="mt-4 font-display text-3xl font-medium tracking-tight md:text-4xl">
            The reconciliation problems this solves
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {spec.painPoints.map((p) => (
              <div key={p.title} className={`${PANEL} p-7`}>
                <div className="text-sm font-semibold text-[var(--mkt-text)]">{p.title}</div>
                <p className={`mt-2 text-sm leading-relaxed ${BODY}`}>{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Capabilities */}
        <section className="mt-24">
          <p className={EYEBROW}>Capabilities</p>
          <h2 className="mt-4 font-display text-3xl font-medium tracking-tight md:text-4xl">
            What ReconIQ does for this use case
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {spec.capabilities.map((c) => (
              <div key={c.title} className={`${PANEL} p-6`}>
                <c.icon className="h-5 w-5 text-[var(--mkt-accent)]" />
                <div className="mt-3 text-sm font-semibold text-[var(--mkt-text)]">{c.title}</div>
                <p className={`mt-1.5 text-sm leading-relaxed ${BODY}`}>{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Data sources + outcomes */}
        <section className="mt-24 grid gap-4 md:grid-cols-2">
          <div className={`${PANEL} p-7`}>
            <p className={EYEBROW}>Data sources supported</p>
            <ul className="mt-5 space-y-2.5 text-sm text-[var(--mkt-text)]">
              {spec.dataSources.map((d) => (
                <li key={d} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mkt-accent)]" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={`${PANEL} p-7`}>
            <p className={EYEBROW}>What this gives you</p>
            <div className="mt-5 grid grid-cols-2 gap-6">
              {spec.outcomes.map((o) => (
                <div key={o.label}>
                  <div className="font-display text-xl font-medium tracking-tight text-[var(--mkt-text)]">{o.metric}</div>
                  <div className={`mt-1 text-xs leading-relaxed ${BODY}`}>{o.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Compliance */}
        <section className={`mt-24 ${PANEL} p-8 md:p-10`}>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-[var(--mkt-accent)]" />
            <div>
              <h2 className="font-display text-2xl font-medium tracking-tight md:text-3xl">Designed with reference to the frameworks that matter here</h2>
              <p className={`mt-3 max-w-2xl text-sm leading-relaxed ${BODY}`}>
                Controls are designed with reference to these frameworks and regimes. See{" "}
                <Link to="/security" className="text-[var(--mkt-accent)] hover:underline">Security &amp; Compliance</Link>{" "}
                for the full picture.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {spec.compliance.map((c) => (
                  <span key={c} className="rounded-full border border-[var(--mkt-line)] bg-[var(--mkt-surface-2)] px-3 py-1 text-xs text-[var(--mkt-text)]">{c}</span>
                ))}
              </div>
              <p className="mt-6 max-w-2xl text-xs leading-relaxed text-[var(--mkt-text-3)]">
                ReconIQ does not hold SOC 2 or ISO 27001 certification. Entries marked
                &ldquo;(target)&rdquo; or &ldquo;(aligned)&rdquo; describe design references and
                roadmap targets, not certifications we have earned.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-24">
          <p className={EYEBROW}>Questions</p>
          <h2 className="mt-4 font-display text-3xl font-medium tracking-tight md:text-4xl">Frequently asked</h2>
          <div className="mt-10 divide-y divide-[var(--mkt-line)] rounded-2xl border border-[var(--mkt-line)] bg-[var(--mkt-surface)]">
            {spec.faq.map((f) => (
              <details key={f.q} className="group p-6">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-[var(--mkt-text)]">
                  {f.q}
                  <span className="text-[var(--mkt-text-3)] transition group-open:rotate-45">+</span>
                </summary>
                <p className={`mt-3 text-sm leading-relaxed ${BODY}`}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mt-24 py-10 text-center">
          <h2 className="font-display text-3xl font-medium tracking-tight md:text-4xl">See it on your data.</h2>
          <p className={`mx-auto mt-4 max-w-xl text-sm leading-relaxed ${BODY}`}>
            Try the live demo, or book a session to walk a {spec.eyebrow.toLowerCase()} workflow end to end.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={appUrl("/auth")} className="inline-flex items-center gap-2 rounded-full bg-[var(--mkt-btn-bg)] px-6 py-3 text-sm font-medium text-[var(--mkt-btn-text)] transition hover:opacity-85">
              Try the live demo <ArrowRight className="h-4 w-4" />
            </a>
            <Link to="/book-demo" className="inline-flex items-center gap-2 rounded-full border border-[var(--mkt-line)] px-6 py-3 text-sm font-medium text-[var(--mkt-text)] transition hover:bg-[var(--mkt-surface-2)]">
              Book a demo
            </Link>
            <Link to="/due-diligence" className="inline-flex items-center gap-2 rounded-full border border-[var(--mkt-line)] px-6 py-3 text-sm font-medium text-[var(--mkt-text)] transition hover:bg-[var(--mkt-surface-2)]">
              Request due-diligence pack
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

export { SOLUTIONS_NAV };
