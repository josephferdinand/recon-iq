import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Compass, ShieldCheck, Sparkles } from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { appUrl } from "@/lib/cross-domain";

export const Route = createFileRoute("/about")({
  component: About,
  head: () => ({
    meta: [
      { title: "About — ReconIQ" },
      { name: "description", content: "ReconIQ builds AI-native reconciliation for finance teams. Our mission, principles, and how we work." },
      { property: "og:title", content: "About ReconIQ" },
      { property: "og:description", content: "AI-native reconciliation, built for regulated finance." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/about" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/about" }],
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
    body: "Every interaction — from the Break Manager to the audit export — is engineered for clarity, control, and auditability.",
  },
];

function About() {
  return (
    <div className="min-h-screen bg-black font-sans text-[#f5f5f7] antialiased">
      <MarketingNav />

      <main className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#86868b]">
          About
        </p>
        <h1 className="mt-6 font-display text-4xl font-medium leading-tight tracking-tight md:text-6xl">
          Reconciliation, reimagined for the AI era.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#a1a1a6]">
          ReconIQ is an enterprise-grade platform built to modernise how finance teams run reconciliation — from cash and securities to intercompany, GL, and complex multi-party flows.
        </p>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold">Our mission</h2>
          <p className="mt-3 leading-relaxed text-[#a1a1a6]">
            To retire the batch-era reconciliation stack and replace it with an intelligent control plane where breaks explain themselves, remediation is proposed by AI and approved by humans, and every action is sealed in a hash-chained audit trail.
          </p>
        </section>

        <section className="mt-16 grid gap-6 md:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-white/10 bg-[#161617] p-6"
            >
              <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/5">
                <p.icon className="h-5 w-5 text-[#2997ff]" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#a1a1a6]">
                {p.body}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold">How we work</h2>
          <p className="mt-3 leading-relaxed text-[#a1a1a6]">
            The best way to see how we work is in the product itself. ReconIQ is live — you can open the working demo, run a reconciliation, and inspect the audit trail before you ever speak to us. When you do evaluate with us, you work directly with the team that builds the platform.
          </p>
          <div className="mt-6">
            <a
              href={appUrl("/auth")}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#2997ff] hover:underline"
            >
              Try the live product <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>

        <section className="mt-16 rounded-2xl border border-white/10 bg-[#161617] p-8">
          <h2 className="font-display text-xl font-semibold">Talk to us</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#a1a1a6]">
            Whether you're evaluating a platform replacement, running a pilot, or exploring an AI overlay on your existing stack — we'd like to hear from you.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/book-demo"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/85"
            >
              Book a demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-[#f5f5f7] transition hover:bg-white/10"
            >
              Contact us
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
