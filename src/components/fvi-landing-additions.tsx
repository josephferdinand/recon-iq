import { Link } from "@tanstack/react-router";
import { ArrowRight, Lock, ShieldCheck } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Regulatory alignment — honest, reference-only language             */
/* ------------------------------------------------------------------ */

const REFERENCE_FRAMEWORKS = [
  { label: "DORA", icon: Lock },
  { label: "SOC 2", icon: ShieldCheck },
  { label: "ISO 27001", icon: ShieldCheck },
  { label: "SEC 17a-4", icon: Lock },
] as const;

const CAPABILITY_PILLARS = [
  { label: "Governance", icon: ShieldCheck },
  { label: "Auditability", icon: ShieldCheck },
  { label: "Security", icon: Lock },
  { label: "Operational Resilience", icon: Lock },
] as const;

export function RegulatoryAlignment() {
  return (
    <section
      aria-label="Compliance-ready architecture"
      className="mx-auto max-w-7xl px-6 py-24"
    >
      <div className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--mkt-text-3)]">
          Compliance-ready architecture
        </p>
        <h2 className="mt-4 font-display text-4xl font-medium tracking-tight text-[var(--mkt-text)] md:text-5xl">
          Built for organisations in regulated environments.
        </h2>
        <p className="mt-4 text-base leading-relaxed text-[var(--mkt-text-2)]">
          The platform is designed with reference to industry frameworks
          including DORA, SOC 2, ISO 27001, and SEC 17a-4 — supporting
          governance, auditability, security, and operational resilience
          requirements.
        </p>
      </div>

      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--mkt-text-3)]">
            Reference frameworks
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {REFERENCE_FRAMEWORKS.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--mkt-line)] bg-[var(--mkt-surface)] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--mkt-text)]"
              >
                <Icon className="h-3.5 w-3.5 text-[var(--mkt-text-2)]" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--mkt-text-3)]">
            Capability pillars
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {CAPABILITY_PILLARS.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--mkt-line)] bg-[var(--mkt-surface)] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--mkt-text-2)]"
              >
                <Icon className="h-3.5 w-3.5 text-[var(--mkt-text-3)]" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-12 flex flex-col gap-4 border-t border-[var(--mkt-line)] pt-8 md:flex-row md:items-center md:justify-between">
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--mkt-text-3)]">
          Framework references describe design intent. ReconIQ does not
          currently hold SOC 2 or ISO 27001 certification; formal certifications
          and attestations are pursued as the platform matures.
        </p>
        <Link
          to="/security"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--mkt-accent)] hover:underline"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Security &amp; compliance overview
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* JSON-LD structured data                                            */
/* ------------------------------------------------------------------ */

export function StructuredData() {
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ReconIQ",
    url: "https://reconintelligence.app",
    logo: "https://reconintelligence.app/apple-touch-icon.png",
    description:
      "AI-assisted reconciliation platform for finance teams in regulated environments.",
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        url: "https://reconintelligence.app/contact",
      },
    ],
  };

  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ReconIQ",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    url: "https://reconintelligence.app",
    description:
      "Deterministic reconciliation matching with AI explanations under human approval and a hash-chained audit trail.",
    featureList: [
      "Deterministic matching rules",
      "AI break explanations with human approval",
      "Hash-chained audit trail",
      "Multi-tenant access controls",
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(software) }}
      />
    </>
  );
}
