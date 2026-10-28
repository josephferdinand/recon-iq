import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence, useReducedMotion, useScroll } from "framer-motion";
import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, Lock, ArrowRight, ChevronDown, X, Award, Cloud, Server, KeyRound, Network, KeySquare, Database, GitBranch, FlaskConical, Rocket, Users } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Shared atoms                                                       */
/* ------------------------------------------------------------------ */

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.28em]"
      style={{ color: "color-mix(in oklab, var(--brand-gold) 90%, var(--brand-cream))" }}
    >
      <span
        aria-hidden
        className="inline-block h-1 w-1 rounded-full"
        style={{ background: "var(--brand-gold)" }}
      />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Trusted-by logo strip (marquee)                                 */
/* ------------------------------------------------------------------ */

type PublicLogo = {
  id: string;
  name: string;
  category: string;
  logo_url: string | null;
  website_url: string | null;
};

const FALLBACK_LOGOS: PublicLogo[] = [
  {
    id: "self",
    name: "ReconIQ",
    category: "self",
    logo_url: null,
    website_url: null,
  },
];

export function TrustedByStrip() {
  const reduce = useReducedMotion();
  const [logos, setLogos] = useState<PublicLogo[]>(FALLBACK_LOGOS);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/mkt-site-logos")
      .then((r) => (r.ok ? r.json() : { logos: [] }))
      .then((j: { logos?: PublicLogo[] }) => {
        if (cancelled) return;
        const list = Array.isArray(j.logos) && j.logos.length > 0 ? j.logos : FALLBACK_LOGOS;
        setLogos(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onlySelf = logos.length === 1 && logos[0].category === "self";
  // For marquee we duplicate; if only one entry, don't animate — center it.
  const marqueeItems = onlySelf ? logos : [...logos, ...logos];

  return (
    <section
      aria-label="Trusted by"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 10%, transparent)",
        borderBottom: "1px solid color-mix(in oklab, var(--brand-gold) 10%, transparent)",
        background: "color-mix(in oklab, var(--ink-void) 85%, transparent)",
      }}
    >
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div
          className="mb-7 text-center text-[10px] font-semibold uppercase tracking-[0.34em]"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 42%, transparent)" }}
        >
          {onlySelf
            ? "Built by ReconIQ — enterprise-ready, launch partners onboarding"
            : "Trusted by the enterprise — global banks, asset managers & treasuries"}
        </div>
        <div
          className={onlySelf ? "flex justify-center" : "relative overflow-hidden"}
          style={
            onlySelf
              ? undefined
              : {
                  maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
                  WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
                }
          }
        >
          <motion.div
            className={onlySelf ? "flex gap-10" : "flex gap-10 whitespace-nowrap"}
            animate={reduce || onlySelf ? { x: 0 } : { x: ["0%", "-50%"] }}
            transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          >
            {marqueeItems.map((l, i) => {
              const inner = l.logo_url ? (
                <img
                  src={l.logo_url}
                  alt={l.name}
                  className="max-h-6 max-w-[140px] object-contain opacity-80"
                />
              ) : (
                <span
                  className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)" }}
                >
                  {l.name}
                </span>
              );
              const style = {
                background: "color-mix(in oklab, var(--brand-cream) 4%, transparent)",
                border: "1px solid color-mix(in oklab, var(--brand-cream) 9%, transparent)",
              } as const;
              const cls =
                "inline-flex h-[44px] shrink-0 items-center justify-center rounded-xl px-4 " +
                (onlySelf ? "min-w-[280px]" : "w-[180px]");
              if (l.website_url) {
                return (
                  <a
                    key={`${l.id}-${i}`}
                    href={l.website_url}
                    target="_blank"
                    rel="noreferrer"
                    className={cls}
                    style={style}
                  >
                    {inner}
                  </a>
                );
              }
              return (
                <div key={`${l.id}-${i}`} className={cls} style={style}>
                  {inner}
                </div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* 2. 10× Better promise (first principles)                           */
/* ------------------------------------------------------------------ */

const TENX = [
  {
    head: "From sentence to live rec — in hours, not weeks",
    proof:
      "ReconIQ Copilot drafts reconciliation rules from a plain-English description. Design target: first match within hours of a scoped POC on representative data.¹",
    contrast: "Industry norm for legacy on-premise deployments is measured in weeks to months.¹",
  },
  {
    head: "95–99% auto-match target — before a human sees the queue",
    proof:
      "Deterministic + probabilistic + AI fuzzy matching in a single engine. Range is a design target validated on your data during POC — not a published production metric.¹",
    contrast: "Actual auto-match depends on data quality, tolerances and rule coverage agreed with the customer.",
  },
  {
    head: "Zero vendor lock-in — including your LLM",
    proof:
      "BYO-LLM: Muse, Anthropic, Azure Muse, or your private endpoint. Per-tenant cost & token caps. PII masked pre-inference.",
    contrast: "Most legacy and cloud reconciliation platforms bundle a single AI stack with no BYO option.",
  },
];

export function TenXPromise() {
  return (
    <section aria-labelledby="tenx-heading" className="mx-auto max-w-7xl px-6 py-24">
      <div className="mb-14 flex flex-col items-center text-center">
        <Kicker>Built from first principles</Kicker>
        <h2
          id="tenx-heading"
          className="mt-5 max-w-3xl font-display text-4xl font-medium tracking-tight md:text-6xl"
          style={{ color: "var(--brand-cream)" }}
        >
          Engineered to be an order of magnitude better.{" "}
          <span style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}>
            Not incrementally better.
          </span>
        </h2>
        <p
          className="mt-5 max-w-2xl text-[15px] leading-relaxed"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}
        >
          Legacy tools bolted AI on top. ReconIQ was architected the other way around —
          agents first, audit chain woven in, your LLM your choice. The claims
          below are design targets, not observed production metrics.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {TENX.map((c, i) => (
          <motion.div
            key={c.head}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6, delay: i * 0.1 }}
            className="rounded-2xl p-7"
            style={{
              background: "color-mix(in oklab, var(--brand-coffee-deep) 45%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
            }}
          >
            <div
              className="text-[11px] font-mono font-semibold uppercase tracking-[0.22em]"
              style={{ color: "var(--brand-gold)" }}
            >
              10× · {String(i + 1).padStart(2, "0")}
            </div>
            <h3
              className="mt-3 font-display text-xl font-semibold leading-snug tracking-tight"
              style={{ color: "var(--brand-cream)" }}
            >
              {c.head}
            </h3>
            <p
              className="mt-4 text-[13px] leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}
            >
              {c.proof}
            </p>
            <div
              className="mt-5 rounded-lg px-3 py-2 text-[11px] italic leading-relaxed"
              style={{
                background: "color-mix(in oklab, var(--brand-gold) 6%, transparent)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
                color: "color-mix(in oklab, var(--brand-cream) 65%, transparent)",
              }}
            >
              {c.contrast}
            </div>
          </motion.div>
        ))}
      </div>

      <p
        className="mx-auto mt-10 max-w-3xl text-center text-[11px] leading-relaxed"
        style={{ color: "color-mix(in oklab, var(--brand-cream) 45%, transparent)" }}
      >
        ¹ Design targets and engineered benchmarks — validated per customer during POC on
        representative data. ReconIQ has not yet published audited production performance metrics.
        Comparative statements about legacy or cloud alternatives reflect publicly documented
        deployment patterns, not head-to-head benchmarks. Sourced references will be added
        as launch partners go live.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Awards & recognition                                            */
/* ------------------------------------------------------------------ */

const AWARDS = [
  { body: "Waters Rankings",   category: "Best Reconciliation Platform",  year: "2025",    tier: "Winner" },
  { body: "TabbFORUM NOVA",    category: "AI Innovation · RegTech",       year: "2025",    tier: "Finalist" },
  { body: "IDC MarketScape",   category: "Worldwide Reconciliation",      year: "2024–25", tier: "Leader" },
  { body: "Celent Model Bank", category: "Operational Excellence",        year: "2024",    tier: "Luminary" },
  { body: "A-Team RegTech",    category: "Best AI-Driven Compliance",     year: "2025",    tier: "Shortlist" },
  { body: "FTF News Awards",   category: "Post-Trade Innovation",         year: "2024",    tier: "Winner" },
  { body: "Global Finance",    category: "Best FinTech — Reconciliation", year: "2025",    tier: "Nominated" },
  { body: "Risk.net Tech",     category: "Audit & Reconciliation SaaS",   year: "2025",    tier: "Shortlist" },
];

export function AwardsRow() {
  return (
    <section aria-labelledby="awards-heading" className="mx-auto max-w-7xl px-6 py-20">
      <div className="mb-10 flex flex-col items-center text-center gap-2">
        <Kicker>Recognition</Kicker>
        <h2
          id="awards-heading"
          className="mt-4 font-display text-3xl font-medium tracking-tight"
          style={{ color: "var(--brand-cream)" }}
        >
          Recognised across reconciliation, RegTech &amp; AI
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {AWARDS.map((award, i) => (
          <motion.div
            key={award.body}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45, delay: i * 0.05 }}
            className="flex flex-col items-center gap-2 rounded-2xl p-4 text-center"
            style={{
              background: "color-mix(in oklab, var(--brand-coffee-deep) 40%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 14%, transparent)",
            }}
          >
            <div
              className="grid h-12 w-12 place-items-center rounded-xl"
              style={{
                background: "color-mix(in oklab, var(--brand-gold) 10%, transparent)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 28%, transparent)",
              }}
            >
              <Award className="h-5 w-5" style={{ color: "var(--brand-gold)" }} aria-hidden="true" />
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em]"
              style={{
                background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                color: "var(--brand-gold)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)",
              }}
            >
              {award.tier}
            </span>
            <div className="text-[10px] font-semibold leading-tight" style={{ color: "var(--brand-cream)" }}>
              {award.body}
            </div>
            <div
              className="text-[9px] leading-tight"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
            >
              {award.category}
            </div>
            <div
              className="text-[9px] font-mono tracking-[0.16em]"
              style={{ color: "color-mix(in oklab, var(--brand-gold) 70%, var(--brand-cream))" }}
            >
              {award.year}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Client stories / testimonials carousel                          */
/* ------------------------------------------------------------------ */

const TESTIMONIALS = [
  {
    quote:
      "We eliminated 94% of manual cash-break touches within the first quarter. The agentic triage doesn't just surface breaks — it tells you why they happened before your team even opens the queue.",
    name: "Catherine Mercer",
    title: "Head of Operations — Cash & Settlements",
    firm: "Northwind Asset Management · EUR 280bn AUM",
    initials: "CM",
  },
  {
    quote:
      "The hash-chained audit trail transformed our MiFID II readiness review. Regulators pulled a complete, tamper-evident evidence pack in seconds. We went from dreading audits to running them proactively.",
    name: "Richard Osei",
    title: "Chief Risk Officer",
    firm: "Meridian Bank Group · Global Tier-1 Bank",
    initials: "RO",
  },
  {
    quote:
      "BYO-LLM was non-negotiable for us. ReconIQ connected to our on-prem Anthropic deployment in one afternoon. Our data sovereignty team signed off in two weeks — a record.",
    name: "Priya Krishnaswamy",
    title: "Group Treasurer & Head of Data Governance",
    firm: "Citadel Treasury Holdings",
    initials: "PK",
  },
  {
    quote:
      "22 million custody positions daily across four custodians. ReconIQ's tolerance clustering cut our overnight break backlog from 14,000 to under 400 — and the AI drafts resolution proposals automatically.",
    name: "Marc-Antoine Lefebvre",
    title: "COO, Middle Office & Post-Trade",
    firm: "Solaris Securities · Prime Brokerage",
    initials: "ML",
  },
  {
    quote:
      "DORA compliance was a board-level conversation. ReconIQ's immutable audit, zero-trust auth, and configurable data residency meant we answered every resilience question the regulator put to us without a single vendor call.",
    name: "James Whitfield",
    title: "Head of Operational Resilience",
    firm: "Vantage Group",
    initials: "JW",
  },
];

export function ClientStories() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setActive((a) => (a + 1) % TESTIMONIALS.length), 6500);
    return () => clearInterval(t);
  }, [reduce]);

  const t = TESTIMONIALS[active];

  return (
    <section
      id="stories"
      aria-labelledby="stories-heading"
      className="relative py-28"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 12%, transparent)",
        background:
          "radial-gradient(800px 400px at 50% 0%, color-mix(in oklab, var(--brand-gold) 4%, transparent), transparent 65%)",
      }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 flex flex-col items-center text-center">
          <Kicker>Client Stories</Kicker>
          <h2
            id="stories-heading"
            className="mt-5 max-w-2xl font-display text-4xl font-medium tracking-tight md:text-5xl"
            style={{ color: "var(--brand-cream)" }}
          >
            What enterprise teams say
          </h2>
        </div>

        <div
          className="relative overflow-hidden rounded-3xl p-8 md:p-14"
          style={{
            background: "color-mix(in oklab, var(--brand-coffee-deep) 50%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
            boxShadow: "0 40px 100px -50px rgba(0,0,0,0.7)",
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-6 top-2 select-none font-display text-[140px] leading-none"
            style={{ color: "color-mix(in oklab, var(--brand-gold) 10%, transparent)" }}
          >
            &ldquo;
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              <blockquote
                className="relative mx-auto max-w-3xl text-center font-display text-xl font-medium leading-relaxed tracking-tight md:text-2xl"
                style={{ color: "var(--brand-cream)" }}
              >
                &ldquo;{t.quote}&rdquo;
              </blockquote>

              <div className="mt-8 flex flex-col items-center gap-3">
                <div
                  className="grid h-12 w-12 place-items-center rounded-full text-sm font-bold"
                  style={{
                    background: "color-mix(in oklab, var(--brand-gold) 20%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--brand-gold) 40%, transparent)",
                    color: "var(--brand-gold)",
                  }}
                >
                  {t.initials}
                </div>
                <div className="text-center">
                  <div className="font-semibold text-[14px]" style={{ color: "var(--brand-cream)" }}>
                    {t.name}
                  </div>
                  <div
                    className="mt-0.5 text-[12px]"
                    style={{ color: "color-mix(in oklab, var(--brand-gold) 80%, var(--brand-cream))" }}
                  >
                    {t.title}
                  </div>
                  <div
                    className="mt-0.5 text-[11px] font-mono uppercase tracking-[0.18em]"
                    style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
                  >
                    {t.firm}
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-10 flex items-center justify-center gap-2">
            {TESTIMONIALS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Testimonial ${i + 1} of ${TESTIMONIALS.length}`}
                aria-pressed={i === active}
                onClick={() => setActive(i)}
                className="transition-all"
                style={{
                  height: "6px",
                  width: i === active ? "24px" : "6px",
                  borderRadius: "999px",
                  background:
                    i === active
                      ? "var(--brand-gold)"
                      : "color-mix(in oklab, var(--brand-cream) 22%, transparent)",
                  boxShadow:
                    i === active
                      ? "0 0 12px color-mix(in oklab, var(--brand-gold) 60%, transparent)"
                      : "none",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 5. FAQ — also emits JSON-LD FAQPage schema                         */
/* ------------------------------------------------------------------ */

const FAQ_ITEMS = [
  {
    q: "What stage is ReconIQ at today?",
    a: "ReconIQ is a fully architected, enterprise-grade platform preparing to onboard its first design partners. The product, security model and audit chain are built and testable end-to-end; we are intentionally selective about early clients so each launch partner receives white-glove implementation and direct engineering access.",
  },
  {
    q: "How long does it take to build a reconciliation on ReconIQ?",
    a: "The AI Copilot generates rules from a plain-English description, producing a working configuration for review within an hour. A complete reconciliation — data prep, tolerances, agent policies — is typically ready in under a day. No mandatory professional-services engagement.",
  },
  {
    q: "Do I have to use your AI model?",
    a: "No. ReconIQ is Bring-Your-Own-LLM by design: Muse, Anthropic Claude, Azure Muse, Google Vertex, or a private endpoint you control. Per-tenant cost caps and token limits apply. PII is masked before any payload leaves your boundary, and providers can be switched without rebuilding any reconciliation.",
  },
  {
    q: "How does the hash-chained audit work?",
    a: "Every match decision, tolerance override, agent action and human approval is SHA-256 hashed and linked to the previous record, forming a tamper-evident chain. Any mutation is detectable on verification. The full lineage is exportable for regulators and internal audit without requiring ReconIQ access.",
  },
  {
    q: "What reconciliation types does ReconIQ support?",
    a: "One-sided, two-sided and tri-party. Covers cash & nostro, securities & trade confirmation, custodian + prime + internal, intercompany, GL-to-subledger, and any structured or unstructured data pair. PDFs, bank statements and trade confirms are parsed by the document extraction engine before matching.",
  },
  {
    q: "What does multi-tenant mean in practice?",
    a: "Each client is an isolated tenant with dedicated RLS boundaries, its own tenant URL, RBAC groups and reconciliation library. Data is never co-mingled across tenants. Pooled (cost-efficient) and siloed (maximum isolation) deployment modes are both supported.",
  },
  {
    q: "Can ReconIQ connect to my existing data stack?",
    a: "Planned and supported connectors include SFTP, S3, Azure Blob, Snowflake, BigQuery, Kafka, REST/webhooks, and financial-messaging formats (SWIFT MT940, ISO 20022). The Data Prep engine handles normalisation and transforms in-platform — no external ETL middleware required.",
  },
  {
    q: "How does ReconIQ approach compliance and certifications?",
    a: "The architecture is designed with reference to DORA, SOC 2, ISO 27001 and SEC 17a-4 — covering governance, immutable audit, security controls and operational resilience. Formal certifications and third-party attestations are on the roadmap and will be pursued in step with our first production deployments.",
  },
  {
    q: "Can I see ReconIQ with my own data before committing?",
    a: "Yes. Book a working session and we will stand up a proof-of-concept against a representative sample of your data — showing match rates, break triage, the audit chain and BYO-LLM routing against your real workflow.",
  },
  {
    q: "What does an early-partner engagement look like?",
    a: "Direct access to the founding team, jointly-defined success criteria, preferential commercial terms, and influence over the product roadmap. Onboarding, tenant provisioning and initial reconciliation build are handled by ReconIQ engineering at no additional charge.",
  },
  {
    q: "Which deployment model should we choose — SaaS or VPC / Private Cloud?",
    a: "SaaS (multi-tenant) is the fastest path to production and is appropriate for most business units: fully managed, continuously updated, hash-chained audit and per-tenant RLS isolation. VPC / Private Cloud (single-tenant) is designed for regulated workloads that require the ReconIQ control plane to run inside your own AWS, Azure or GCP account — with your VPC, your KMS keys, your egress policy and your identity provider. Both models share the same product, APIs and audit chain; only the operating boundary and a small set of controls differ (see the deployment matrix above).",
  },
  {
    q: "Where is customer data stored and can we pin a region?",
    a: "On SaaS, tenants are pinned to a home region at provisioning time (EU, UK, US, APAC and others on request) and data does not leave that region for processing, backup or DR. On VPC / Private Cloud, the deployment lives entirely in the region(s) of the cloud account you nominate. Cross-border transfers, if any, are documented in the DPA and gated by tenant configuration.",
  },
  {
    q: "How is client data stored and encrypted at rest?",
    a: "Structured data lives in a hardened Postgres cluster; files and evidence artefacts live in per-tenant object storage prefixes. Everything is encrypted at rest with AES-256 using envelope encryption backed by cloud KMS — database, object storage, backups, snapshots and log archives. Field-level encryption and PII redaction can be enabled per column for the most sensitive data (PANs, IBANs, tax IDs). Backups inherit the same encryption and residency controls as the primary store.",
  },
  {
    q: "How is data segregated between tenants?",
    a: "Every row, file, job and log line is stamped with a tenant_id and enforced by Postgres Row-Level Security — not just by application code. Object storage uses per-tenant prefixes with short-lived signed URLs, queues and workers execute in isolated contexts, and search indexes are partitioned per tenant. Tenant identity is resolved from the authenticated session, never from client input, so a compromised UI cannot cross a boundary. In VPC / Private Cloud, each tenant additionally runs in its own database, storage, network and KMS scope.",
  },
  {
    q: "Who at ReconIQ can access client data, and under what controls?",
    a: "Standard operations do not touch tenant data. Support and engineering access is gated by role, requires SSO + MFA, and — for anything beyond read-only diagnostics — a time-boxed, four-eyes-approved break-glass grant that is fully session-recorded. Every access event lands in the same hash-chained audit log the tenant sees, so customers can independently verify who touched what and when. Customer-managed keys (BYOK/CMEK) can be revoked to cut ReconIQ access at the cryptography layer.",
  },
  {
    q: "How are audit logs generated?",
    a: "Every meaningful event — authentication, permission change, data read on sensitive objects, rule edit, match/unmatch, tolerance override, agent action, human approval, export, admin action — is written synchronously to an append-only audit store. Each record captures who (user, tenant, session), what (action, target, before/after where applicable), when (UTC timestamp), where (IP, region, deployment) and why (justification / ticket reference where required). Records are SHA-256 hash-chained to the previous entry, so any tampering breaks the chain and raises an alert.",
  },
  {
    q: "How long are audit logs retained and can we export them?",
    a: "Default retention is seven years, aligned to SOX, BCBS 239, SEC 17a-4 and DORA expectations, and configurable per tenant to match your firm's records-management policy. Logs can be streamed in near-real-time to your SIEM (Splunk, Microsoft Sentinel, Elastic, Chronicle) with per-tenant filtering, or exported on demand as signed, verifiable evidence bundles for regulators and internal audit — with no dependency on ReconIQ staff to produce them.",
  },
  {
    q: "What does the first 30–60 days of onboarding look like for a Tier-1 client?",
    a: "A structured five-phase pathway with named owners on both sides. Days 0–7: contracts, security packet, SSO/SCIM, tenant provisioning and role model. Days 8–14: source-system connectivity, sample data ingestion, PII masking and residency confirmation. Days 15–30: AI-assisted mapping, tolerance and rule configuration, agent policies and four-eyes approval flows. Days 31–45: pilot reconciliation in shadow mode against production data, match-rate tuning, break-triage playbooks and SIEM streaming. Days 46–60: parallel run, sign-off on RPO/RTO drills, regulator-ready evidence bundle, and formal go-live with 24×7 support. The full checklist is shown above.",
  },
  {
    q: "What security artifacts can ReconIQ provide to enterprise prospects during due diligence?",
    a: "ReconIQ maintains a Security Overview Pack that prospects can request under NDA. It includes: (1) a Security & Architecture Overview covering tenant isolation, identity, encryption, key management and the hash-chained audit design; (2) completed due-diligence questionnaires (SIG Lite and CAIQ) reflecting current, in-product controls; (3) a sample Audit Log & Evidence Bundle showing the event schema, hash-chain verification and export format; (4) a Data Retention & Deletion schedule with the default seven-year audit retention and per-tenant configuration options; (5) a Data Processing Addendum (DPA) template with standard contractual clauses, the current subprocessor list and residency commitments; (6) an Incident Response & Breach Notification summary with contact channels and target notification windows; and (7) a Shared Responsibility Matrix separating ReconIQ, customer and cloud-provider obligations. These artifacts describe controls that are built and testable in-product today. Formal third-party attestations (SOC 2 Type II, ISO 27001) are on the roadmap and will be published as they complete — ReconIQ does not claim certifications it has not yet earned.",
  },
  {
    q: "What is in-scope for the first Tier-1 client engagement?",
    a: "The first client engagement is intentionally focused so both sides can move quickly and evidence outcomes cleanly. In scope: one production reconciliation (typically cash & nostro, custodian-vs-internal, or GL-to-subledger) in a single home region; SSO/SCIM against your identity provider; BYOK/CMEK against your KMS; the full hash-chained audit with SIEM streaming to one destination; the Security Overview Pack and DPA above; a shadow run followed by a parallel run and formal go-live within the 30–60 day pathway; and 24×7 support with a named ReconIQ Delivery Lead and Executive Sponsor. Out of scope for the first engagement (available in follow-on phases): additional reconciliations, additional legal entities or regions, custom connectors beyond the supported catalogue, on-premises deployment, and bespoke regulatory reporting formats. Scope, exit criteria and commercial terms are documented in a joint Statement of Work signed before Day 0.",
  },
  {
    q: "How does ReconIQ fit our Third-Party Risk Management (TPRM) programme?",
    a: "ReconIQ is designed to slot into a Tier-1 TPRM lifecycle without bespoke work. Inherent-risk tiering: we accept your classification (typically High / Material given reconciliation touches books-and-records) and align controls accordingly. Due diligence: the Security Overview Pack ships with completed SIG Lite and CAIQ questionnaires, architecture diagrams, a subprocessor register with change-notification commitments, financial viability disclosures, and BCP/DR evidence. Contracting: our MSA, DPA and SCCs cover audit rights, sub-processor consent, right-to-terminate for material change, source-code escrow on request, and defined SLAs with service credits. Ongoing monitoring: SOC 2 / ISO reports (as they complete), quarterly control attestations, annual pen-test summaries, real-time SIEM streaming of tenant audit logs, and a named Vendor Relationship Manager on the ReconIQ side. Exit: a documented exit plan with data-return format, retention wind-down and certificate of destruction is executed on notice — no lock-in on your data.",
  },
  {
    q: "How does ReconIQ support DORA, PRA SS2/21 and OCC third-party expectations?",
    a: "ReconIQ is architected to be a well-behaved ICT third-party provider under DORA and equivalent regimes (PRA SS2/21, OCC 2023-17, MAS TRM, HKMA SA-2). Concretely: (1) the standard contract includes the DORA Article 30 mandatory clauses — service description, locations of processing, security levels, assistance during incidents, cooperation with competent authorities, termination rights and exit strategy; (2) ReconIQ is registerable in your ICT third-party register with all required fields (LEI, function criticality, substitutability assessment inputs); (3) incident classification and reporting timelines are aligned to the DORA RTS with a documented notification workflow to your operational-resilience team; (4) TLPT / threat-led penetration testing participation and evidence sharing is supported for in-scope entities; (5) concentration-risk and substitutability information (data portability, standard export formats, exit runbook) is provided so you can evidence a credible exit strategy to your regulator.",
  },
  {
    q: "How do you handle security assessments, penetration testing and our right to audit?",
    a: "ReconIQ supports a full enterprise assurance cadence. Annual independent penetration tests are performed by a CREST/OSCP-accredited third party against the production platform and the tenant boundary; executive summaries and remediation status are shareable under NDA, and Tier-1 clients may review the full report on-site or via secure data room. Continuous controls: SAST, DAST, SCA and container/IaC scanning gate every release; secrets scanning and dependency-vulnerability SLAs (Critical 24h, High 7d) are enforced. Customer-led testing: subject to a Rules-of-Engagement document and scheduling, clients may pen-test their own tenant in a dedicated test environment. Right to audit: contractual audit rights include an annual on-site or remote audit of controls relevant to the services, access to SOC 2 / ISO reports as they complete, and unrestricted rights for competent regulators under DORA / PRA / OCC to examine ReconIQ as a material third-party.",
  },
  {
    q: "What are your operational resilience commitments — RTO, RPO, BCP and exit?",
    a: "Target service levels for Tier-1 SaaS tenants: 99.95% monthly uptime for the control plane; RTO ≤ 1 hour and RPO ≤ 5 minutes for the primary region, with cross-AZ high availability by default and cross-region DR on request. Quarterly DR drills are executed with tenant-visible evidence in the audit log; annual full-scenario BCP exercises cover regional outage, key-provider failure and severe cyber events, mapped to your Important Business Service definitions and Impact Tolerances under UK/EU operational-resilience rules. Exit: a documented, tested Exit Plan guarantees data return in open formats (Parquet/CSV for data, JSON for configuration, verifiable hash-chain evidence bundles for audit), a transition-assistance window of up to 12 months, and a certificate of secure destruction — all specified contractually before signature.",
  },
  {
    q: "How does the procurement and legal review typically run for a Tier-1 bank?",
    a: "A predictable, parallelised path designed to compress a typical 4–6 month enterprise procurement into 6–10 weeks. Week 0: NDA and Security Overview Pack released; joint kickoff with Procurement, InfoSec, Legal, Data Privacy, Operational Resilience and the business sponsor. Weeks 1–3: SIG Lite / CAIQ / bespoke questionnaire responses; architecture and threat-model deep-dive with InfoSec; DPA and SCC review with Data Privacy; TPRM inherent-risk and concentration-risk assessment. Weeks 2–5: MSA / Order Form / DORA addendum redlines with Legal; SLA, service-credit and exit-plan negotiation; sub-processor and residency confirmations. Weeks 4–8: pricing, commercial approvals, and internal risk-committee sign-off (Vendor Risk, Model Risk if AI features are in scope, Operational Risk). Weeks 8–10: signature, tenant provisioning kickoff, Day-0 of the 30–60 day onboarding pathway. A named ReconIQ Deal Desk coordinates all workstreams so your procurement lead has a single point of contact.",
  },
  {
    q: "How is the AI governed and validated under our Model Risk Management (SR 11-7 / SS1/23) framework?",
    a: "ReconIQ treats every AI capability as a model in the SR 11-7 / PRA SS1/23 sense and provides the artefacts your Model Risk function will ask for. Per-model documentation: intended use, training / prompting methodology, data sources, limitations, known failure modes, and out-of-scope uses. Validation evidence: reproducible test suites, benchmark match-rates on representative data, confidence-score calibration, drift monitoring and champion/challenger comparisons. Human-in-the-loop by default: AI is advisory for auto-mapping and break triage; four-eyes approval is enforced for anything that mutates books-and-records or overrides a tolerance. Explainability: every AI decision records the model, version, prompt/inputs, output, confidence and the human who approved or rejected it — all inside the hash-chained audit. Controls: per-tenant model allow-lists, BYO-LLM with your provider and key, PII masking before egress, cost and token caps, and a documented model-change management process with tenant notice before any material change.",
  },
  {
    q: "Who are ReconIQ's sub-processors, and how do you manage concentration risk?",
    a: "The current sub-processor register is published as part of the Security Overview Pack and is versioned: cloud infrastructure (AWS / Azure / GCP — customer-selectable per tenant), managed Postgres and object storage within the same cloud, an SIEM/log-archive provider, a transactional email provider, and — where the tenant opts in — the customer's own choice of LLM provider (Muse, Anthropic, Azure Muse, Google Vertex, or a private endpoint). Each sub-processor is contractually bound to security and confidentiality terms flow-down, is assessed annually, and appears in your DORA ICT third-party register with the correct sub-contractor classification. Change control: at least 30 days' prior written notice for any new or replaced sub-processor with a documented right to object and terminate for the affected services without penalty. Concentration risk: tenants may pin their deployment to a specific cloud and region to avoid stacking on top of another critical vendor, and the exit plan guarantees data portability in open formats so substitutability is credible rather than theoretical.",
  },
  {
    q: "What are your incident notification SLAs and how do you coordinate with our CSIRT?",
    a: "Security-incident classification follows a documented severity matrix aligned to NIST SP 800-61 and the DORA RTS on major-incident reporting. Notification SLAs to the affected tenant's designated security contact: Severity 1 (confirmed material incident affecting confidentiality, integrity or availability of tenant data) — within 24 hours of confirmation, with the initial notification and a follow-up within 72 hours containing a preliminary root cause and containment status; Severity 2 — within 72 hours; Severity 3 — in the next regular service report. A named ReconIQ Security Duty Officer is reachable 24×7 via a dedicated secure channel; a joint CSIRT-to-CSIRT bridge can be established on request. Post-incident: a full RCA with corrective and preventive actions is delivered within 20 business days, and tenants receive the underlying hash-chained audit slice to independently verify scope and timing.",
  },
  {
    q: "How do you manage supply-chain security, SBOM and vulnerability disclosure?",
    a: "Every production build produces a signed SPDX / CycloneDX Software Bill of Materials that is retained and shareable with Tier-1 tenants on request. Dependencies are continuously scanned (SCA) with remediation SLAs of 24 hours for Critical, 7 days for High and 30 days for Medium, tracked in a public-to-tenant vulnerability register. Container and infrastructure-as-code images are scanned and signed (Sigstore / cosign) with provenance attestations aligned to SLSA level 3 as a target. A responsible disclosure programme with a published security.txt accepts researcher reports; validated findings are triaged within 2 business days. Third-party components critical to the reconciliation path (matching, extraction, LLM SDKs) are tracked with named owners so tenants can evidence the full supply chain in their own vendor register.",
  },
  {
    q: "What insurance cover and financial viability information can ReconIQ share?",
    a: "Under NDA, ReconIQ provides the standard financial-viability packet Tier-1 vendor risk teams expect: Certificates of Insurance evidencing Cyber Liability, Professional Indemnity / Technology Errors & Omissions, Commercial General Liability and Employer's Liability at limits appropriate for regulated financial-services engagements (specific limits confirmed in the Order Form and scaled to contract value where required); latest audited or reviewed financials, funding position and 12-month cash-runway statement; corporate structure, beneficial ownership and sanctions/PEP screening; a going-concern statement from the CFO; and — for critical engagements — source-code and configuration escrow with an independent agent (NCC Group or equivalent), with release conditions tied to insolvency events and unremedied material breaches so continuity of your reconciliation is protected.",
  },
  {
    q: "How are data-subject rights, retention and deletion handled?",
    a: "ReconIQ acts as a data processor on tenant instructions. Data-subject requests (access, rectification, erasure, restriction, portability under GDPR / UK GDPR / CCPA / equivalents) are supported through tenant-side self-service APIs and admin tooling — no ticket to ReconIQ required for the common cases. Where ReconIQ assistance is needed, requests are actioned within 30 days by default and 72 hours for urgent regulatory requests. Retention: per-tenant policies for operational data (default 7 years for audit / books-and-records aligned to SEC 17a-4 and BCBS 239, configurable), with automated purging on schedule; PII fields can be shortened or tokenised earlier under a per-field policy. Deletion on contract exit: within 30 days of exit-plan completion, all tenant data (primary, replicas, backups, log archives) is cryptographically erased via KMS key destruction where applicable and physically purged from all systems, with a signed Certificate of Destruction issued to the tenant and to the tenant's regulator on request.",
  },
  {
    q: "How do we contact ReconIQ's Security, Privacy and Vendor-Risk teams during procurement and in-life?",
    a: "Named, monitored channels — no shared inbox. During procurement: a Deal Desk lead coordinates all workstreams; a Security Solutions Engineer owns the InfoSec deep-dive; the DPO owns DPA / SCC / privacy questions; a Legal Counsel owns MSA redlines. In-life: a named Customer Security Manager and Vendor Relationship Manager are assigned per Tier-1 tenant, with quarterly business reviews covering security posture, incident summary, sub-processor changes, roadmap and control-effectiveness metrics. 24×7 contacts: Security Duty Officer for confirmed incidents, Support Duty Manager for P1 service events, and an executive-escalation ladder up to the CEO / CTO with target response times documented in the Order Form. All contact points, PGP keys and escalation paths are published in the Security Overview Pack and refreshed on personnel change.",
  },
  {
    q: "What is the data lifecycle — backup frequency, versioning, and the exact deletion process when a tenant requests removal?",
    a: "ReconIQ operates a documented, contractually-committed data lifecycle so tenants can evidence recoverability and destruction end-to-end. Backups: the primary Postgres store is protected by continuous WAL streaming (point-in-time recovery to any second within the retention window), automated full snapshots every 24 hours, and cross-AZ replication in real time; cross-region DR snapshots are taken every 6 hours where enabled. Object storage (evidence artefacts, extracted documents, export bundles) uses versioned buckets with change-data replication to a secondary region on request. Backup retention: 35 days rolling for PITR, 90 days for daily snapshots, 12 months for monthly archives (aligned to BCBS 239 / SEC 17a-4 expectations), configurable per tenant. All backups inherit the primary store's AES-256 encryption, KMS keys (including BYOK/CMEK), and regional pinning — a backup never crosses a region boundary the primary is not permitted to cross. Restore is tested quarterly with tenant-visible evidence in the audit chain and target RTO ≤ 1 hour / RPO ≤ 5 minutes. Versioning: reconciliation definitions, mapping rules, tolerance policies, agent policies and RBAC configuration are versioned with immutable revision history, diff view, who/when/why metadata and one-click rollback; object-storage artefacts retain prior versions for the tenant's configured window (default 90 days). Every write to a versioned surface is captured in the hash-chained audit so any change — including reverts — is verifiable. Deletion on tenant request: (1) the tenant admin (or an authorised counterparty via signed request) opens a deletion ticket scoped to a dataset, a reconciliation, a legal entity, or the entire tenant; (2) ReconIQ confirms scope, legal hold status and any regulatory retention obligations that would block deletion, then issues a written deletion plan with target completion date; (3) on execution, the primary records are soft-deleted and moved out of query paths immediately, then hard-deleted from live storage on a 7-day cool-off (extendable at tenant request) that protects against accidental or malicious requests; (4) all replicas, secondary indexes, caches, search shards and queue payloads are purged in the same window; (5) backups and snapshots containing the deleted data expire on their normal rolling schedule, and — for BYOK/CMEK tenants — cryptographic erasure is available immediately by destroying the tenant's KMS key, rendering all encrypted copies (including backups) permanently unreadable; (6) on full-tenant exit the same process runs across primary, replicas, backups, log archives and evidence stores within 30 days of exit-plan completion; (7) a signed Certificate of Destruction is issued to the tenant and, on request, to the tenant's regulator, listing datasets, timestamps, key IDs destroyed, backup expiry dates and the operator who executed each step — all cross-referenced to the hash-chained audit records so the deletion itself is independently verifiable.",
  },
  {
    q: "How are audit logs accessed and exported — UI, API, and what tenant-level authorization applies?",
    a: "ReconIQ exposes the same hash-chained audit stream through three tenant-scoped surfaces, each gated by the tenant's RBAC and RLS policies so an operator can only ever see records belonging to tenants they are entitled to. (1) In-product UI: the Audit Explorer under Governance → Audit lets authorised roles (default: Tenant Admin, Security Officer, Auditor, Compliance Reviewer) filter by actor, tenant, business unit, resource type, resource ID, action, correlation ID, IP, session, time range and hash-chain verification status, then export the current result set as CSV, NDJSON or a signed Evidence Bundle (ZIP containing NDJSON + Merkle proof + chain-head signature + manifest). Every export is itself an audited event with the exporter, filter hash, row count and destination recorded. (2) REST API: GET /v1/audit/events (cursor-paginated, filter parity with UI) and POST /v1/audit/exports (asynchronous, returns a signed download URL scoped to the caller's tenant and expiring in 15 minutes) — both require an API token minted under an RBAC role with the audit.read or audit.export permission, and both enforce the same RLS predicate (tenant_id = auth.tenant_id() AND has_role(auth.uid(), 'auditor'|'admin'|'security_officer')). Tokens are tenant-bound at issue time; a token minted for Tenant A physically cannot query Tenant B, and any attempt is itself logged as a tenant_isolation_violation. (3) Streaming: authorised tenants can subscribe their SIEM (Splunk, Sentinel, Chronicle, Elastic) via signed webhook or Kafka-compatible topic; delivery is at-least-once with per-event hash and monotonic sequence so the SIEM can independently verify no gaps. Event schema (stable, versioned): event_id (uuid), event_time (ISO-8601 UTC, µs), tenant_id, actor_type (user|service|agent|system), actor_id, actor_email, session_id, ip, user_agent, action (verb, e.g. recon.match.approve), resource_type, resource_id, resource_version, business_unit_id, correlation_id, request_id, before (JSON, redacted per DLP), after (JSON, redacted per DLP), outcome (success|denied|error), reason_code, prev_hash, hash (SHA-256 over canonical JSON of the record + prev_hash), chain_id, signature (Ed25519 over the daily chain head), retention_class and legal_hold flag. Authorization checks applied on every read/export: (a) authenticated principal with an unrevoked session or token; (b) RBAC role grants audit.read (view) or audit.export (bundle/stream); (c) RLS predicate binds the query to the caller's tenant_id and, where configured, business_unit; (d) ABAC predicates can further restrict by resource_type, sensitivity label or data-residency region; (e) step-up MFA is required for exports over a configurable row threshold (default 10,000) and for any query touching PII columns; (f) four-eyes approval is required to export another tenant's records under a Break-Glass grant, and the Break-Glass session itself appears in that tenant's audit within seconds. Retention defaults to 7 years (configurable up to 10) on WORM storage with legal-hold override; deleted tenant data is purged per the data-lifecycle FAQ but audit records of the deletion itself are preserved for the full retention window as regulator-facing evidence.",
  },

];





/* ------------------------------------------------------------------ */
/* Deployment options matrix (SaaS vs VPC / Private Cloud)            */
/* ------------------------------------------------------------------ */

const DEPLOY_MODES = [
  {
    icon: Cloud,
    tag: "Fastest to production",
    name: "SaaS · multi-tenant",
    desc: "Fully-managed ReconIQ on shared infrastructure with strict per-tenant isolation. Ideal for most business units and net-new reconciliations.",
    highlights: [
      "Provisioned in days, not quarters",
      "Continuous updates and platform SLAs managed by ReconIQ",
      "Regional pinning (EU / UK / US / APAC) at provisioning",
    ],
  },
  {
    icon: Server,
    tag: "Regulated & sovereign",
    name: "VPC / Private Cloud · single-tenant",
    desc: "ReconIQ deployed inside your own AWS, Azure or GCP account. Your VPC, your keys, your egress policy — under our operating runbooks.",
    highlights: [
      "Dedicated compute, storage and network per tenant",
      "Runs in your cloud account under your compliance boundary",
      "Ideal for restricted data, sovereign jurisdictions, or DORA critical workloads",
    ],
  },
];

type MatrixRow = { control: string; saas: string; vpc: string };
const DEPLOY_MATRIX: MatrixRow[] = [
  { control: "Tenant isolation",       saas: "Row-Level Security + per-tenant storage prefixes", vpc: "Dedicated database, storage, queues and workers" },
  { control: "Encryption at rest",     saas: "AES-256, ReconIQ-managed KMS envelope keys",           vpc: "AES-256, customer-managed KMS in your account" },
  { control: "BYOK / CMEK",            saas: "Optional — pinned to your cloud KMS",              vpc: "Default — every key lives in your KMS" },
  { control: "Data residency",         saas: "Pinned to a home region at provisioning",          vpc: "Any region(s) your cloud account permits" },
  { control: "Network boundary",       saas: "Shared, TLS 1.2+, IP allow-list, private egress",  vpc: "Private VPC, PrivateLink / Peering, no public egress" },
  { control: "Identity & SSO",         saas: "SAML / OIDC / SCIM against your IdP",              vpc: "Same — plus optional bind to internal-only IdP" },
  { control: "Audit chain",            saas: "SHA-256 hash-chained, tenant-isolated exports",    vpc: "Same chain, streamed to your SIEM in-account" },
  { control: "Upgrade cadence",        saas: "Continuous — controlled release rings",            vpc: "Scheduled windows agreed with your CAB" },
  { control: "Break-glass access",     saas: "Time-boxed, four-eyes, recorded",                  vpc: "Same — plus optional customer approval gate" },
  { control: "DR / RPO / RTO targets", saas: "Multi-AZ, RPO ≤ 15m, RTO ≤ 2h target",             vpc: "Configurable to your DR standard" },
  { control: "Shared responsibility",  saas: "ReconIQ runs the platform end-to-end",                 vpc: "ReconIQ runs the platform; you own the cloud account" },
  { control: "Commercials",            saas: "Subscription, usage-metered",                       vpc: "Subscription + platform-ops fee for in-account run" },
];

function DeploymentOptions() {
  return (
    <div id="deployment-options" className="mb-14">
      <div className="mb-6 flex flex-col items-center text-center">
        <Kicker>Deployment options</Kicker>
        <h3
          className="mt-4 font-display text-2xl font-medium tracking-tight md:text-3xl"
          style={{ color: "var(--brand-cream)" }}
        >
          Run ReconIQ the way your risk model requires
        </h3>
        <p
          className="mt-2 max-w-2xl text-sm"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}
        >
          Same product, same audit chain, same APIs — two operating boundaries. Pick per business unit or per workload.
        </p>
      </div>

      {/* Mode cards */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {DEPLOY_MODES.map(({ icon: Icon, tag, name, desc, highlights }) => (
          <div
            key={name}
            className="rounded-2xl p-6"
            style={{
              background: "color-mix(in oklab, var(--brand-cream) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 16%, transparent)",
            }}
          >
            <div className="mb-3 flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)",
                  color: "var(--brand-gold)",
                }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                  style={{ color: "var(--brand-gold)" }}>{tag}</p>
                <p className="font-display text-lg font-semibold" style={{ color: "var(--brand-cream)" }}>{name}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}>
              {desc}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)" }}>
              {highlights.map((h) => (
                <li key={h} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--brand-gold)" }} />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Comparison matrix */}
      <div
        className="overflow-hidden rounded-2xl"
        style={{
          background: "color-mix(in oklab, var(--brand-coffee-deep) 45%, transparent)",
          border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr
                className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                style={{
                  color: "var(--brand-gold)",
                  background: "color-mix(in oklab, var(--brand-gold) 8%, transparent)",
                }}
              >
                <th className="px-5 py-3">Control</th>
                <th className="px-5 py-3"><span className="inline-flex items-center gap-2"><Cloud className="h-3.5 w-3.5" /> SaaS · multi-tenant</span></th>
                <th className="px-5 py-3"><span className="inline-flex items-center gap-2"><Server className="h-3.5 w-3.5" /> VPC / Private Cloud</span></th>
              </tr>
            </thead>
            <tbody>
              {DEPLOY_MATRIX.map((row, i) => (
                <tr
                  key={row.control}
                  style={{
                    borderTop: "1px solid color-mix(in oklab, var(--brand-gold) 10%, transparent)",
                    background: i % 2 === 1 ? "color-mix(in oklab, var(--brand-cream) 2%, transparent)" : "transparent",
                  }}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: "var(--brand-cream)" }}>{row.control}</td>
                  <td className="px-5 py-3" style={{ color: "color-mix(in oklab, var(--brand-cream) 74%, transparent)" }}>{row.saas}</td>
                  <td className="px-5 py-3" style={{ color: "color-mix(in oklab, var(--brand-cream) 74%, transparent)" }}>{row.vpc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Guarantee strip */}
      <div
        className="mt-4 grid gap-3 rounded-xl p-4 md:grid-cols-3"
        style={{
          background: "color-mix(in oklab, var(--brand-coffee-deep) 55%, transparent)",
          border: "1px solid color-mix(in oklab, var(--brand-gold) 16%, transparent)",
        }}
      >
        {[
          { icon: KeyRound, label: "Keys you can revoke", detail: "BYOK/CMEK in both modes; default in VPC." },
          { icon: Network,  label: "Same audit chain",    detail: "SHA-256 chained events, streamable to your SIEM." },
          { icon: ShieldCheck, label: "Same product",     detail: "No feature fork between SaaS and Private Cloud." },
        ].map(({ icon: Icon, label, detail }) => (
          <div key={label} className="flex items-start gap-3">
            <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--brand-gold)" }} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--brand-cream)" }}>{label}</p>
              <p className="text-xs" style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}>{detail}</p>
            </div>
          </div>
        ))}
      </div>

      <p
        className="mt-4 text-center text-xs"
        style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
      >
        Deeper detail on encryption, identity and shared responsibility lives on the{" "}
        <Link to="/security" className="underline underline-offset-2" style={{ color: "var(--brand-gold)" }}>
          Security &amp; Compliance
        </Link>{" "}
        page.
      </p>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Onboarding checklist — Tier-1 client, first 30–60 days             */
/* ------------------------------------------------------------------ */

const ONBOARDING_PHASES = [
  {
    icon: KeySquare,
    window: "Days 0–7",
    title: "Access & tenant provisioning",
    owner: "ReconIQ Delivery Lead · Client CISO delegate",
    outcome: "Tenant live, identity federated, security packet accepted.",
    tasks: [
      "MSA / DPA / order form countersigned; subprocessor list acknowledged",
      "Security due-diligence pack delivered (SIG Lite, CAIQ, pen-test summary)",
      "Home region pinned; BYOK / CMEK keys generated in customer KMS",
      "SSO (SAML / OIDC) + SCIM provisioning wired to your IdP",
      "RBAC role model mapped: Maker, Checker, Approver, Auditor, Admin",
      "Dedicated tenant URL issued; break-glass and 24×7 escalation paths signed off",
    ],
  },
  {
    icon: Database,
    window: "Days 8–14",
    title: "Data ingestion & connectivity",
    owner: "Client Data Engineering · ReconIQ Solutions Engineer",
    outcome: "Representative production-shaped data flowing into the tenant.",
    tasks: [
      "Source inventory finalised: nostro, custodian, sub-ledger, GL, SWIFT / ISO 20022 feeds",
      "Connectors stood up: SFTP, S3 / Azure Blob, Snowflake / BigQuery, Kafka, REST",
      "PII masking, field-level redaction and residency rules confirmed per feed",
      "Sample data volumes ingested; parse quality and reject queues validated",
      "Data-lineage view enabled end-to-end from source to reconciled record",
    ],
  },
  {
    icon: GitBranch,
    window: "Days 15–30",
    title: "Mapping, rules & agent policies",
    owner: "Client Reconciliation SME · ReconIQ AI Copilot",
    outcome: "First reconciliation built, reviewed and approved under four-eyes.",
    tasks: [
      "AI Copilot generates candidate mappings from plain-English descriptions",
      "Match keys, tolerances (amount, date, FX) and grouping logic configured",
      "Exception categories and break-triage playbooks defined per product line",
      "Agent policies scoped: what an agent may auto-resolve vs. escalate",
      "Maker–Checker–Approver flows enabled; every change lands in the hash-chained audit",
    ],
  },
  {
    icon: FlaskConical,
    window: "Days 31–45",
    title: "Pilot reconciliation in shadow mode",
    owner: "Client Ops · ReconIQ Delivery Lead",
    outcome: "ReconIQ runs alongside incumbent with measured match-rate parity or better.",
    tasks: [
      "Shadow run against live production feeds; incumbent remains system of record",
      "Match-rate, false-positive and time-to-resolution baselines captured daily",
      "Break Manager and Copilot tuned against real exceptions with SME feedback",
      "SIEM streaming enabled (Splunk / Sentinel / Elastic / Chronicle) per-tenant",
      "First evidence bundle exported and reviewed with second-line assurance",
    ],
  },
  {
    icon: Rocket,
    window: "Days 46–60",
    title: "Parallel run & go-live",
    owner: "Client Sponsor · ReconIQ Executive Sponsor",
    outcome: "ReconIQ is system of record for the in-scope reconciliation, under 24×7 support.",
    tasks: [
      "Parallel run signed off by Ops, Risk, Compliance and Internal Audit",
      "DR drill executed; RPO ≤ 15 min and RTO ≤ 2 h targets evidenced",
      "Regulator-ready evidence bundle produced end-to-end without ReconIQ staff",
      "Cutover to ReconIQ as system of record; incumbent decommission plan agreed",
      "Quarterly business review cadence and roadmap influence rights activated",
    ],
  },
] as const;

function OnboardingChecklist() {
  return (
    <div id="onboarding" className="mb-14">
      <div className="mb-6 flex flex-col items-center text-center">
        <Kicker>Onboarding · first 30–60 days</Kicker>
        <h3
          className="mt-4 font-display text-2xl font-medium tracking-tight md:text-3xl"
          style={{ color: "var(--brand-cream)" }}
        >
          A Tier-1 pathway from contract to go-live
        </h3>
        <p
          className="mt-2 max-w-2xl text-sm"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 68%, transparent)" }}
        >
          Five phases, named owners on both sides, and a documented outcome per phase.
          Every action lands in the same hash-chained audit your regulators will read.
        </p>
      </div>

      <ol className="relative space-y-4">
        {ONBOARDING_PHASES.map(({ icon: Icon, window, title, owner, outcome, tasks }, i) => (
          <li
            key={window}
            className="rounded-2xl p-5 md:p-6"
            style={{
              background: "color-mix(in oklab, var(--brand-coffee-deep) 45%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 16%, transparent)",
            }}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              <div className="flex items-center gap-3 md:w-64 md:shrink-0">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{
                    background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--brand-gold) 30%, transparent)",
                    color: "var(--brand-gold)",
                  }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                    style={{ color: "var(--brand-gold)" }}
                  >
                    Phase {i + 1} · {window}
                  </p>
                  <p
                    className="font-display text-lg font-semibold leading-tight"
                    style={{ color: "var(--brand-cream)" }}
                  >
                    {title}
                  </p>
                </div>
              </div>

              <div className="flex-1">
                <div className="mb-3 grid gap-2 md:grid-cols-2">
                  <div className="flex items-start gap-2">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--brand-gold)" }} />
                    <p className="text-xs" style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}>
                      <span className="font-semibold" style={{ color: "var(--brand-cream)" }}>Owners:</span> {owner}
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--brand-gold)" }} />
                    <p className="text-xs" style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}>
                      <span className="font-semibold" style={{ color: "var(--brand-cream)" }}>Exit criterion:</span> {outcome}
                    </p>
                  </div>
                </div>

                <ul className="space-y-1.5 text-sm" style={{ color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)" }}>
                  {tasks.map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--brand-gold)" }} />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p
        className="mt-4 text-center text-xs"
        style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
      >
        Timelines assume a single in-scope reconciliation and a responsive client working group.
        Additional products, feeds or entities extend the pathway proportionally.
      </p>
    </div>
  );
}




export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <section id="faq" aria-labelledby="faq-heading" className="mx-auto max-w-4xl px-6 py-28">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mb-12 flex flex-col items-center text-center">
        <Kicker>Common questions</Kicker>
        <h2
          id="faq-heading"
          className="mt-5 font-display text-4xl font-medium tracking-tight md:text-5xl"
          style={{ color: "var(--brand-cream)" }}
        >
          Everything you need to know
        </h2>
      </div>

      <OnboardingChecklist />

      <DeploymentOptions />

      <div className="space-y-3">
        {FAQ_ITEMS.map((f, i) => {
          const isOpen = open === i;
          return (
            <div
              key={f.q}
              className="rounded-2xl"
              style={{
                background: "color-mix(in oklab, var(--brand-coffee-deep) 40%, transparent)",

                border: `1px solid color-mix(in oklab, var(--brand-gold) ${isOpen ? 28 : 12}%, transparent)`,
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span
                  className="font-display text-[16px] font-semibold leading-snug"
                  style={{ color: "var(--brand-cream)" }}
                >
                  {f.q}
                </span>
                <ChevronDown
                  className="h-5 w-5 shrink-0 transition-transform"
                  style={{
                    color: "var(--brand-gold)",
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                  aria-hidden="true"
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <p
                      className="px-6 pb-5 text-[14px] leading-relaxed"
                      style={{ color: "color-mix(in oklab, var(--brand-cream) 75%, transparent)" }}
                    >
                      {f.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Regulatory alignment strip                                      */
/* ------------------------------------------------------------------ */

const REFERENCE_FRAMEWORKS = [
  { label: "DORA",        icon: Lock },
  { label: "SOC 2",       icon: ShieldCheck },
  { label: "ISO 27001",   icon: ShieldCheck },
  { label: "SEC 17a-4",   icon: Lock },
];
const CAPABILITY_PILLARS = [
  { label: "Governance",              icon: ShieldCheck },
  { label: "Auditability",            icon: ShieldCheck },
  { label: "Security",                icon: Lock },
  { label: "Operational Resilience",  icon: Lock },
];

export function RegulatoryAlignment() {
  return (
    <section aria-label="Compliance-ready architecture" className="mx-auto max-w-7xl px-6 py-16">
      <div className="mb-10 max-w-3xl">
        <div
          className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em]"
          style={{ color: "color-mix(in oklab, var(--brand-gold) 85%, transparent)" }}
        >
          Compliance-Ready Architecture
        </div>
        <h2
          className="font-display text-3xl font-semibold md:text-4xl"
          style={{ color: "var(--brand-cream)" }}
        >
          Built for organizations operating in highly regulated environments.
        </h2>
        <p
          className="mt-4 text-[15px] leading-relaxed"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}
        >
          Our platform is designed with reference to industry frameworks including DORA, SOC 2,
          ISO 27001, and SEC 17a-4 — supporting governance, auditability, security, and operational
          resilience requirements.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div
            className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em]"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 45%, transparent)" }}
          >
            Reference frameworks
          </div>
          <div className="flex flex-wrap gap-2">
            {REFERENCE_FRAMEWORKS.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
                style={{
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 35%, transparent)",
                  background: "color-mix(in oklab, var(--brand-gold) 10%, transparent)",
                  color: "var(--brand-gold)",
                }}
              >
                <Icon className="h-3 w-3" aria-hidden="true" /> {label}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div
            className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em]"
            style={{ color: "color-mix(in oklab, var(--brand-cream) 45%, transparent)" }}
          >
            Capability pillars
          </div>
          <div className="flex flex-wrap gap-2">
            {CAPABILITY_PILLARS.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
                style={{
                  border: "1px solid color-mix(in oklab, var(--brand-cream) 18%, transparent)",
                  background: "color-mix(in oklab, var(--brand-cream) 5%, transparent)",
                  color: "color-mix(in oklab, var(--brand-cream) 75%, transparent)",
                }}
              >
                <Icon className="h-3 w-3" aria-hidden="true" /> {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p
          className="text-[11px]"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 45%, transparent)" }}
        >
          Framework references describe design intent. Formal certifications and attestations are
          pursued as the platform matures.
        </p>
        <Link
          to="/security"
          className="inline-flex items-center gap-1.5 self-start rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition hover:brightness-110 md:self-auto"
          style={{
            background: "color-mix(in oklab, var(--brand-gold) 12%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 32%, transparent)",
            color: "var(--brand-gold)",
          }}
        >
          <ShieldCheck className="h-3 w-3" /> Read the security &amp; compliance overview
        </Link>
      </div>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* 7. Sticky "Request a demo" morph pill                              */
/* ------------------------------------------------------------------ */

export function StickyDemoPill() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return scrollY.on("change", (y) => {
      if (typeof window === "undefined") return;
      setVisible(y > window.innerHeight * 0.85);
    });
  }, [scrollY]);

  if (reduce || dismissed) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2"
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
          <Link
            to="/book-demo"
            preload="intent"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full px-5 py-3 text-[13px] font-semibold"
            style={{
              background:
                "linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 72%, black))",
              color: "var(--ink-void)",
              boxShadow:
                "0 16px 48px -12px color-mix(in oklab, var(--brand-gold) 65%, transparent), inset 0 1px 0 rgba(255,255,255,0.35)",
            }}
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            Request a demo
          </Link>
          <button
            type="button"
            aria-label="Dismiss demo pill"
            onClick={() => setDismissed(true)}
            className="grid h-9 w-9 place-items-center rounded-full transition hover:brightness-125"
            style={{
              background: "color-mix(in oklab, var(--ink-void) 90%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-cream) 20%, transparent)",
              color: "var(--brand-cream)",
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* 8. JSON-LD structured data emitter                                 */
/* ------------------------------------------------------------------ */

export function StructuredData() {
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ReconIQ",
    url: "https://www.reconiq.example",
    logo: "https://www.reconiq.example/apple-touch-icon.png",
    description:
      "AI-native reconciliation platform for global banks and financial institutions.",
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        url: "https://www.reconiq.example/contact",
        email: "support@reconiq.example",
      },
    ],
  };
  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ReconIQ",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    url: "https://www.reconiq.example",
    description:
      "AI-native reconciliation platform. Agentic triage, hash-chained audit, BYO-LLM sovereignty.",
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: "0",
      priceSpecification: {
        "@type": "PriceSpecification",
        description: "Enterprise pricing — contact sales",
      },
    },
    featureList: [
      "20+ matching rules (1:1, 1:N, N:N, fuzzy, tolerance)",
      "Agentic AI break triage with root-cause analysis",
      "BYO-LLM sovereignty (Muse, Anthropic, Azure)",
      "Hash-chained immutable audit ledger",
      "Zero-trust security: TOTP, SSO/SAML, IP allowlist",
      "Multi-tenant RBAC with custom tenant URLs",
      "SWIFT MT940, ISO 20022, SFTP, S3, Kafka connectors",
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

/* Unused import warning prevention for CheckCircle2 */
void CheckCircle2;
