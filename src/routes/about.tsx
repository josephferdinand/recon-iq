import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Compass, ShieldCheck, Sparkles } from "lucide-react";
import { FviApprovedLogo } from "@/components/fvi-approved-logo";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/about")({
  component: About,
  head: () => ({
    meta: [
      { title: "About — ReconIQ" },
      { name: "description", content: "ReconIQ builds AI-native reconciliation for global banks and financial institutions. Our mission, principles, and how we work." },
      { property: "og:title", content: "About ReconIQ" },
      { property: "og:description", content: "AI-native reconciliation, built for regulated finance." },
      { property: "og:type", content: "website" },
    ],
  }),
});

const PRINCIPLES = [
  {
    icon: Compass,
    title: "AI-native, not AI-bolted",
    body: "Every workflow — matching, break triage, exception routing, audit — is designed around agentic reasoning first, with deterministic rails around it.",
  },
  {
    icon: ShieldCheck,
    title: "Sovereignty by default",
    body: "Bring-your-own-LLM, bring-your-own-KMS, tenant-isolated data, hash-chained audit. Your data never trains anyone else's model.",
  },
  {
    icon: Sparkles,
    title: "Enterprise craft",
    body: "Every interaction — from the Break Manager to the audit export — is engineered to the standard of a Tier-1 trading floor tool.",
  },
];

function About() {
  return (
    <div
      className="min-h-screen font-sans antialiased"
      style={{
        background:
          "radial-gradient(1200px 700px at 20% -10%, rgba(20,29,51,0.55), transparent 60%)," +
          "radial-gradient(900px 600px at 90% 10%, rgba(212,181,129,0.08), transparent 55%)," +
          "linear-gradient(180deg, #030508 0%, #05080f 40%, #030508 100%)",
        color: "var(--brand-cream)",
      }}
    >
      {/* subtle grain */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 0.85 0 0 0 0 0.5 0 0 0 0.35 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />

      <header
        className="fvi-marketing-header sticky top-0 z-40 backdrop-blur-xl"
        style={{
          background: "color-mix(in oklab, var(--ink-void) 78%, transparent)",
          borderBottom: "1px solid color-mix(in oklab, var(--brand-gold) 14%, transparent)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <FviApprovedLogo className="h-11 w-11 rounded-sm" />
            <span className="font-display text-sm font-semibold" style={{ color: "var(--brand-cream)" }}>
              ReconIQ
            </span>
          </Link>
          <BackButton fallbackTo="/" label="Back to home" className="fvi-marketing-header-back" />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-4xl px-6 py-20">
        <div
          className="inline-flex items-center rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.25em]"
          style={{
            color: "var(--brand-gold)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)",
            background: "color-mix(in oklab, var(--brand-gold) 8%, transparent)",
          }}
        >
          About
        </div>
        <h1
          className="mt-6 font-display text-4xl font-medium leading-tight tracking-tight md:text-6xl"
          style={{ color: "var(--brand-cream)" }}
        >
          Reconciliation, reimagined for the AI era.
        </h1>
        <p
          className="mt-6 max-w-2xl text-lg leading-relaxed"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}
        >
          ReconIQ (ReconIQ) is an enterprise-grade platform built to modernise how global banks and financial institutions run reconciliation — from cash and securities to intercompany, GL, and complex multi-party flows.
        </p>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold" style={{ color: "var(--brand-cream)" }}>
            Our mission
          </h2>
          <p className="mt-3 leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}>
            To retire the batch-era reconciliation stack and replace it with an intelligent control plane where breaks explain themselves, remediation is proposed by AI and approved by humans, and every action is cryptographically sealed for the regulator.
          </p>
        </section>

        <section className="mt-16 grid gap-6 md:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div
              key={p.title}
              className="rounded-xl p-6"
              style={{
                background: "color-mix(in oklab, var(--brand-coffee-deep) 45%, transparent)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 20%, transparent)",
                boxShadow: "0 30px 80px -50px rgba(0,0,0,0.75)",
              }}
            >
              <div
                className="grid h-10 w-10 place-items-center rounded-lg"
                style={{
                  background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)",
                }}
              >
                <p.icon className="h-5 w-5" style={{ color: "var(--brand-gold)" }} />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold" style={{ color: "var(--brand-cream)" }}>
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}>
                {p.body}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold" style={{ color: "var(--brand-cream)" }}>
            How we work
          </h2>
          <p className="mt-3 leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}>
            ReconIQ is engineered by a small, senior team with hands-on experience in banking operations, capital markets technology, applied ML, and enterprise security. We partner directly with launch customers — no long implementation queues, no channel resellers between you and the engineers who build the platform.
          </p>
        </section>

        <section
          className="mt-16 rounded-2xl p-8"
          style={{
            background: "color-mix(in oklab, var(--brand-coffee-deep) 50%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 22%, transparent)",
            boxShadow: "0 40px 100px -50px rgba(0,0,0,0.75)",
          }}
        >
          <h2 className="font-display text-xl font-semibold" style={{ color: "var(--brand-cream)" }}>
            Talk to us
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}>
            Whether you're evaluating a platform replacement, running a pilot, or exploring an AI overlay on your existing stack — we'd like to hear from you.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/book-demo"
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:brightness-110"
              style={{ background: "var(--brand-gold)", color: "var(--ink-void)" }}
            >
              Book a demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:bg-white/5"
              style={{
                border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)",
                color: "var(--brand-cream)",
              }}
            >
              Contact us
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
