import type React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  Lock,
  KeyRound,
  Building2,
  FileText,
  Workflow,
  AlertTriangle,
  Mail,
  ArrowRight,
  BookOpen,
  Database,
  Layers,
} from "lucide-react";
import { trackCtaEvent } from "@/lib/cta-tracking";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

const LAST_UPDATED = "October 2026";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security & Compliance — ReconIQ" },
      {
        name: "description",
        content:
          "How ReconIQ approaches security, privacy, resilience, and compliance — including what we support today versus what is formally certified.",
      },
      { property: "og:title", content: "Security & Compliance — ReconIQ" },
      {
        property: "og:description",
        content:
          "Scope, shared-responsibility model, technical and organisational controls, and honest disclosure of what is formally certified today.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://reconintelligence.app/security" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: "https://reconintelligence.app/security" }],
  }),
  component: SecurityPage,
});

/* ------------------------------------------------------------------ */

const SUPPORT_CONTROLS: Array<{
  icon: typeof ShieldCheck;
  title: string;
  summary: string;
  items: string[];
}> = [
  {
    icon: Lock,
    title: "Identity & access",
    summary: "Enterprise-grade authentication with least-privilege authorization.",
    items: [
      "SSO via SAML 2.0 and OIDC; SCIM 2.0 user & group provisioning",
      "TOTP multi-factor authentication with step-up for sensitive actions",
      "Role-based access control with maker–checker (four-eyes) approvals",
      "IP allow-listing and configurable session-inactivity policies",
    ],
  },
  {
    icon: Building2,
    title: "Tenant isolation & residency",
    summary: "Logical and, where required, physical separation between customers.",
    items: [
      "Row-level security enforced in the database for every tenant boundary",
      "Deployment options: pooled SaaS, dedicated silo, or single-tenant VPC",
      "Configurable regional residency across EU, UK, US, APAC & Middle East",
      "Per-tenant configuration of retention windows above platform minimums",
    ],
  },
  {
    icon: KeyRound,
    title: "Encryption & key management",
    summary: "Data protected in transit and at rest using modern cryptography.",
    items: [
      "TLS 1.2+ for all customer traffic; HSTS enforced on public endpoints",
      "AES-256 at rest for primary storage and managed backups",
      "Bring-your-own-key (BYO-KMS) available on dedicated deployments",
      "Secrets held in a managed vault; no long-lived credentials in code",
    ],
  },
  {
    icon: FileText,
    title: "Audit, evidence & governance",
    summary: "Every state change is captured for downstream audit and investigation.",
    items: [
      "Append-only, hash-chained audit log across platform and tenant actions",
      "Immutable evidence pack for reconciliation runs, breaks, and approvals",
      "Time-boxed break-glass access with full session capture and attestation",
      "Change-management workflow with signed release notes per environment",
    ],
  },
  {
    icon: Workflow,
    title: "Secure software development",
    summary: "Security is part of engineering, not an inspection at the end.",
    items: [
      "Peer review and mandatory checks in the CI pipeline for every change",
      "Static analysis, dependency scanning, and secret detection on each commit",
      "Segregated Development, UAT, and Production environments",
      "Third-party penetration testing conducted on a recurring cadence",
    ],
  },
  {
    icon: Database,
    title: "Resilience & recovery",
    summary: "Designed to recover quickly from infrastructure and process failures.",
    items: [
      "Target availability of 99.95% on production plans",
      "Recovery objectives: RPO ≤ 5 minutes, RTO ≤ 30 minutes (dedicated)",
      "Encrypted backups with periodic restore verification",
      "Documented business-continuity plan tested at least annually",
    ],
  },
];

const FRAMEWORK_ALIGNMENT: Array<{
  framework: string;
  status: "Aligned by design" | "In progress" | "Not certified";
  note: string;
  scope: string;
  fviResponsibilities: string[];
  customerResponsibilities: string[];
  evidence: string[];
}> = [
  {
    framework: "SOC 2 (Trust Services Criteria)",
    status: "Aligned by design",
    note: "Controls mapped to Security, Availability, and Confidentiality criteria. Type II attestation is on the roadmap; a report is not yet available.",
    scope: "The ReconIQ multi-tenant SaaS control plane and data plane, covering the Security, Availability and Confidentiality Trust Services Criteria. Privacy and Processing Integrity are not currently in scope of the planned attestation.",
    fviResponsibilities: [
      "Operate the SOC 2 control framework, including change management, access review, monitoring and incident response",
      "Retain control evidence continuously so the auditor observation window is uninterrupted",
      "Engage an AICPA-registered CPA firm for the Type I and Type II attestation",
    ],
    customerResponsibilities: [
      "Configure SSO, RBAC and least-privilege inside your tenant per your own SOC 2 scope",
      "Review the SOC 2 report annually as part of your vendor-risk file",
      "Report suspected control failures via the documented incident channel",
    ],
    evidence: [
      "Draft control matrix (TSC → ReconIQ control) available under NDA",
      "Auditor-facing artefacts: access-review logs, change tickets, vuln scans, on-call records",
      "Type I / Type II reports will be published to Tier-1 tenants when issued",
    ],
  },
  {
    framework: "ISO/IEC 27001:2022",
    status: "Aligned by design",
    note: "Information Security Management System practices modelled on Annex A controls. External certification is planned; no certificate is yet issued.",
    scope: "The ReconIQ ISMS covering the design, development, operation and support of the reconciliation platform and the personnel and systems supporting it. Statement of Applicability targets all 93 Annex A controls with documented exclusions where appropriate.",
    fviResponsibilities: [
      "Maintain the ISMS: risk register, Statement of Applicability, internal audit, management review",
      "Operate Annex A controls (A.5–A.8) with documented policies and evidence of effectiveness",
      "Engage an accredited certification body for Stage 1 and Stage 2 audits",
    ],
    customerResponsibilities: [
      "Maintain your own ISMS for the customer side of the shared-responsibility boundary",
      "Provide security requirements in the contract so ReconIQ can flow them into its own SoA",
    ],
    evidence: [
      "ISMS policy pack (Information Security, Access Control, Cryptography, Supplier, Incident, BCM)",
      "Risk register and treatment plan sample under NDA",
      "Certificate and Statement of Applicability will be published upon issuance",
    ],
  },
  {
    framework: "GDPR / UK GDPR",
    status: "Aligned by design",
    note: "Lawful-basis and data-subject-rights workflows are supported. A Data Processing Addendum is available on request.",
    scope: "ReconIQ acts as a data processor on documented tenant instructions for all personal data processed inside the tenant boundary. Applies to EU/UK personal data regardless of tenant home region, with SCCs and UK IDTA as required.",
    fviResponsibilities: [
      "Provide a DPA with Standard Contractual Clauses and the UK International Data Transfer Addendum",
      "Assist with data-subject requests, DPIAs and regulator engagement within statutory windows",
      "Notify controllers of a personal-data breach without undue delay (target ≤ 72 hours)",
    ],
    customerResponsibilities: [
      "Act as controller: determine lawful basis, purpose and retention for personal data",
      "Configure retention, PII masking and access controls consistent with your privacy notice",
      "Handle data-subject communications with the individuals concerned",
    ],
    evidence: [
      "DPA template with SCCs, IDTA and sub-processor register",
      "Records of Processing Activities extract relevant to your tenant",
      "Transfer Impact Assessment supporting materials on request",
    ],
  },
  {
    framework: "DORA (Digital Operational Resilience Act)",
    status: "Aligned by design",
    note: "Architecture and contractual annexes support Chapter II governance and Article 28–30 third-party requirements.",
    scope: "ReconIQ as an ICT third-party service provider to EU-regulated financial entities. Covers Chapter II (ICT risk management), Chapter III (incident reporting support), Chapter IV (digital operational resilience testing) and Chapter V (third-party risk, Articles 28–30).",
    fviResponsibilities: [
      "Include DORA Article 30 mandatory clauses in the standard Order Form / MSA",
      "Support your ICT third-party register with LEI, function criticality and substitutability inputs",
      "Cooperate with competent authorities, participate in TLPT where the tenant is in scope",
    ],
    customerResponsibilities: [
      "Classify the ReconIQ service in your Important Business Service catalogue and set Impact Tolerances",
      "Register ReconIQ as an ICT third-party (and, if applicable, as supporting a critical/important function)",
      "Perform your own concentration-risk assessment across your ICT third-party estate",
    ],
    evidence: [
      "DORA contractual addendum with Article 28 & 30 clauses",
      "Register-of-information data pack (JSON + CSV) matching the RTS templates",
      "Exit plan, BCP/DR test evidence and sub-processor change-notification workflow",
    ],
  },
  {
    framework: "BCBS 239 principles",
    status: "Aligned by design",
    note: "Data lineage, aggregation, and reporting practices designed for risk-data aggregation principles.",
    scope: "Applies where ReconIQ processes risk-relevant data feeding books-and-records or regulatory reporting. Principles 3 (accuracy & integrity), 4 (completeness), 5 (timeliness), 6 (adaptability), 7 (accuracy of reporting) and 8 (comprehensiveness) are the primary design anchors.",
    fviResponsibilities: [
      "Preserve end-to-end lineage from source ingestion to matched output in the hash-chained audit",
      "Provide reconciliation completeness and timeliness metrics per run",
      "Retain evidence for the tenant-configured period (default 7 years)",
    ],
    customerResponsibilities: [
      "Own upstream data quality and the definition of the risk data being reconciled",
      "Integrate ReconIQ outputs into your risk-reporting and governance forums",
    ],
    evidence: [
      "Lineage export per reconciliation run (source → normalisation → match → outcome)",
      "Signed hash-chain verification bundle for any window on demand",
      "Completeness and timeliness KPI reports through the analytics API",
    ],
  },
  {
    framework: "SR 11-7 / PRA SS1/23 (Model Risk Management)",
    status: "Aligned by design",
    note: "Model inventory, validation evidence, and challenger-model workflows for AI-assisted matching.",
    scope: "All AI/ML models used by ReconIQ that materially influence a reconciliation outcome: auto-mapping, fuzzy-match scoring, break-triage suggestions and any LLM used for extraction or narrative generation. Deterministic rule engines are treated as models where they drive automated decisions.",
    fviResponsibilities: [
      "Maintain a per-model documentation pack: intended use, data, limitations, known failure modes",
      "Publish validation evidence: benchmarks, calibration, drift, champion/challenger comparisons",
      "Notify tenants of material model changes ahead of deployment",
    ],
    customerResponsibilities: [
      "Register ReconIQ models in your own Model Inventory and set the appropriate risk tier",
      "Perform independent model validation to the depth your MRM policy requires",
      "Own the human-in-the-loop approval decisions inside the four-eyes workflow",
    ],
    evidence: [
      "Model documentation and validation pack per model version",
      "Explainability record for every AI decision inside the hash-chained audit",
      "Per-tenant model allow-list configuration and BYO-LLM routing evidence",
    ],
  },
  {
    framework: "MAS TRM (Singapore)",
    status: "Aligned by design",
    note: "Controls aligned to the MAS Technology Risk Management Guidelines (2021) for FIs operating in Singapore.",
    scope: "Applies to Singapore-regulated FI tenants. Covers TRM sections on third-party risk, access control, cryptography, systems reliability, cyber-security operations and incident management as they relate to the ReconIQ service.",
    fviResponsibilities: [
      "Support MAS Notice 655 / 644 incident-notification timelines through the security channel",
      "Provide TRM-aligned control evidence and threat-model documentation on request",
      "Offer Singapore-region data residency where operationally available",
    ],
    customerResponsibilities: [
      "Complete your outsourcing risk assessment and notify MAS where required",
      "Configure access, encryption and monitoring inside the tenant per your TRM policy",
    ],
    evidence: [
      "TRM control-mapping worksheet",
      "Incident-management runbook extract",
      "Residency confirmation letter for Singapore-pinned tenants",
    ],
  },
  {
    framework: "APRA CPS 234 (Australia)",
    status: "Aligned by design",
    note: "Information-security controls aligned to APRA Prudential Standard CPS 234 for Australian regulated entities.",
    scope: "Applies to APRA-regulated tenants (ADIs, insurers, RSE licensees). Focused on information-asset classification, control implementation commensurate with the criticality of information assets, testing of controls and incident notification.",
    fviResponsibilities: [
      "Classify tenant information assets processed by ReconIQ at the highest applicable sensitivity",
      "Test information-security controls on a defined cadence and share summary results",
      "Support APRA-required notification timelines (72 hours for material incidents)",
    ],
    customerResponsibilities: [
      "Maintain your own CPS 234 information-security capability and Board reporting",
      "Notify APRA of material information-security incidents affecting your entity",
    ],
    evidence: [
      "Control-testing summary aligned to CPS 234 paragraphs 20–26",
      "Incident-notification workflow with named APRA-liaison contact on your side",
    ],
  },
  {
    framework: "ISO 22301 (Business Continuity)",
    status: "Aligned by design",
    note: "Business Continuity Management System designed to ISO 22301; independent certification is on the roadmap.",
    scope: "Continuity of the ReconIQ reconciliation service for enterprise tenants, including cross-AZ high availability by default, cross-region DR on request, and personnel / supplier continuity for the ReconIQ operating team.",
    fviResponsibilities: [
      "Maintain a BCMS with Business Impact Analysis, risk assessment and continuity plans",
      "Execute quarterly DR drills and an annual full-scenario BCP exercise",
      "Publish RTO ≤ 1 hour and RPO ≤ 5 minutes targets and report against them",
    ],
    customerResponsibilities: [
      "Include ReconIQ in your own BCP scenarios and confirm your side of the runbook",
      "Nominate BCP contacts on both sides for invocation and communications",
    ],
    evidence: [
      "BCMS policy and BIA summary",
      "Most recent DR-drill and BCP-exercise reports (redacted, under NDA)",
      "Documented Exit Plan with data-return format and timeline",
    ],
  },
  {
    framework: "PCI DSS",
    status: "Not certified",
    note: "The platform is not designed to store cardholder data (PAN). Customers should not route PAN through the service.",
    scope: "Out of scope. ReconIQ is not designed as a Cardholder Data Environment (CDE) and does not accept, store, process or transmit Primary Account Numbers (PAN) or Sensitive Authentication Data.",
    fviResponsibilities: [
      "Design controls to keep the service out of the CDE",
      "Provide guidance on tokenising PAN upstream before ingestion",
    ],
    customerResponsibilities: [
      "Do not send PAN or SAD to ReconIQ; tokenise or truncate before ingestion",
      "Handle any PCI-DSS obligations inside your own CDE, not inside ReconIQ",
    ],
    evidence: [
      "Statement of non-applicability available on request",
    ],
  },
  {
    framework: "HIPAA",
    status: "Not certified",
    note: "The platform is not offered as a HIPAA-covered service and no Business Associate Agreement is available.",
    scope: "Out of scope. ReconIQ is not offered as a HIPAA Business Associate and does not sign Business Associate Agreements. The service should not be used to process Protected Health Information (PHI).",
    fviResponsibilities: [
      "Decline BAA requests and clearly communicate non-applicability",
    ],
    customerResponsibilities: [
      "Do not process PHI in ReconIQ; use a HIPAA-covered service for that workload",
    ],
    evidence: [
      "Statement of non-applicability available on request",
    ],
  },
];


const SHARED_RESPONSIBILITY: Array<{ party: string; scope: string; examples: string[] }> = [
  {
    party: "ReconIQ",
    scope: "The platform, its infrastructure, and platform-level controls.",
    examples: [
      "Product security, tenant isolation, encryption, and audit logging",
      "Availability of the service against the published target",
      "Vulnerability management for platform code and dependencies",
    ],
  },
  {
    party: "Customer administrators",
    scope: "How your organization configures and operates the service.",
    examples: [
      "User lifecycle, role assignment, and periodic access review",
      "SSO / MFA enforcement and IP allow-list policies",
      "Approval of connectors, sub-processors of your own, and data flows",
    ],
  },
  {
    party: "Underlying cloud providers",
    scope: "Physical infrastructure and hyperscaler-managed services.",
    examples: [
      "Datacentre physical security and environmental controls",
      "Host-level patching for managed compute and storage",
      "Hyperscaler certifications (SOC 2, ISO 27001, etc.) inherited by tenants",
    ],
  },
];

/* ------------------------------------------------------------------ */

function SectionHeading({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
}) {
  return (
    <div className="mb-8 max-w-3xl">
      <div
        className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em]"
        style={{ color: "var(--mkt-text-3)" }}
      >
        {eyebrow}
      </div>
      <h2
        className="font-display text-2xl font-semibold md:text-3xl"
        style={{ color: "var(--mkt-text)" }}
      >
        {title}
      </h2>
      {intro ? (
        <p
          className="mt-3 text-[15px] leading-relaxed"
          style={{ color: "color-mix(in oklab, var(--mkt-text) 72%, transparent)" }}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}

function SecurityPage() {
  return (
    <div className="min-h-screen bg-[var(--mkt-bg)] text-[var(--mkt-text)] transition-colors duration-300">
      <MarketingNav />
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pt-24 pb-16">
        <div className="max-w-3xl">
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 5%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 10%, transparent)",
              color: "var(--mkt-text-2)",
            }}
          >
            <ShieldCheck className="h-3 w-3" /> Security &amp; Compliance overview
          </div>
          <h1
            className="font-display text-3xl font-semibold tracking-tight md:text-5xl"
            style={{ color: "var(--mkt-text)" }}
          >
            Security, privacy, and resilience at ReconIQ.
          </h1>
          <p
            className="mt-4 text-base leading-relaxed md:text-lg"
            style={{ color: "color-mix(in oklab, var(--mkt-text) 72%, transparent)" }}
          >
            This page is maintained by ReconIQ (&ldquo;ReconIQ&rdquo;) to answer common
            security, privacy, and compliance questions about the ReconIQ reconciliation platform. It
            describes controls that are enabled today, our shared-responsibility model, and — plainly
            — which frameworks we are aligned with by design versus which are formally certified.
          </p>
          <p
            className="mt-3 text-[13px] leading-relaxed"
            style={{ color: "color-mix(in oklab, var(--mkt-text) 55%, transparent)" }}
          >
            Last reviewed: {LAST_UPDATED}. This overview is app-owned editable content and is not an
            independent assurance report or certification.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/due-diligence"
              onClick={() =>
                trackCtaEvent("click", {
                  cta_id: "due_diligence_cta",
                  source: "security_page_hero",
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--mkt-btn-bg)] px-4 py-2 text-[12px] font-semibold text-[var(--mkt-btn-text)] transition hover:opacity-85"
              style={{
                border: "1px solid var(--mkt-btn-bg)",
              }}
            >
              Request the due-diligence pack <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              to="/retention"
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition hover:brightness-110"
              style={{
                background: "color-mix(in oklab, var(--mkt-text) 6%, transparent)",
                border: "1px solid color-mix(in oklab, var(--mkt-text) 22%, transparent)",
                color: "color-mix(in oklab, var(--mkt-text) 85%, transparent)",
              }}
            >
              <BookOpen className="h-3.5 w-3.5" /> Data retention policy
            </Link>
          </div>
        </div>
      </section>

      {/* Scope & disclaimer callout */}
      <section className="mx-auto max-w-7xl px-6 pb-4">
        <div
          className="flex gap-4 rounded-2xl p-5 md:p-6"
          style={{
            background: "color-mix(in oklab, var(--mkt-text) 6%, transparent)",
            border: "1px solid color-mix(in oklab, var(--mkt-text) 22%, transparent)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 flex-none"
            style={{ color: "var(--mkt-accent)" }}
            aria-hidden="true"
          />
          <div className="space-y-2 text-[13.5px] leading-relaxed">
            <p style={{ color: "color-mix(in oklab, var(--mkt-text) 88%, transparent)" }}>
              <span className="font-semibold" style={{ color: "var(--mkt-text)" }}>
                Scope.
              </span>{" "}
              This overview applies to the ReconIQ reconciliation platform hosted by ReconIQ
              Intelligence for enterprise customers. It does not cover customer-owned systems, data
              you export, or third-party services you integrate at your discretion.
            </p>
            <p style={{ color: "color-mix(in oklab, var(--mkt-text) 72%, transparent)" }}>
              <span className="font-semibold" style={{ color: "var(--mkt-text)" }}>
                Honest disclosure.
              </span>{" "}
              We describe our architecture as &ldquo;aligned with&rdquo; recognised frameworks where
              we have designed controls to their guidance. We do not claim certifications that have
              not been issued, and we identify each framework&rsquo;s current status in the table
              below.
            </p>
          </div>
        </div>
      </section>

      {/* Shared responsibility */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          eyebrow="Shared-responsibility model"
          title="Who is accountable for what."
          intro="Enterprise security is a partnership. The controls below are grouped by the party best positioned to operate them."
        />
        <div className="grid gap-5 md:grid-cols-3">
          {SHARED_RESPONSIBILITY.map(({ party, scope, examples }) => (
            <div
              key={party}
              className="rounded-2xl p-5"
              style={{
                background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
                border: "1px solid color-mix(in oklab, var(--mkt-text) 12%, transparent)",
              }}
            >
              <div className="flex items-center gap-2">
                <Layers
                  className="h-4 w-4"
                  style={{ color: "var(--mkt-accent)" }}
                  aria-hidden="true"
                />
                <h3
                  className="text-[14px] font-semibold tracking-tight"
                  style={{ color: "var(--mkt-text)" }}
                >
                  {party}
                </h3>
              </div>
              <p
                className="mt-2 text-[12.5px] leading-relaxed"
                style={{ color: "color-mix(in oklab, var(--mkt-text) 62%, transparent)" }}
              >
                {scope}
              </p>
              <ul className="mt-3 space-y-1.5">
                {examples.map((e) => (
                  <li
                    key={e}
                    className="flex gap-2 text-[12.5px] leading-relaxed"
                    style={{ color: "color-mix(in oklab, var(--mkt-text) 78%, transparent)" }}
                  >
                    <span
                      className="mt-1.5 h-1 w-1 flex-none rounded-full"
                      style={{ background: "var(--mkt-text)" }}
                    />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Controls we support */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          eyebrow="Controls we support today"
          title="Enabled platform capabilities."
          intro="These controls are live in the platform and available to enterprise customers, subject to plan and deployment topology."
        />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {SUPPORT_CONTROLS.map(({ icon: Icon, title, summary, items }) => (
            <div
              key={title}
              className="flex flex-col gap-3 rounded-2xl p-6"
              style={{
                background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
                border: "1px solid color-mix(in oklab, var(--mkt-text) 12%, transparent)",
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="grid h-9 w-9 place-items-center rounded-lg"
                  style={{
                    background: "color-mix(in oklab, var(--mkt-text) 12%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--mkt-text) 32%, transparent)",
                    color: "var(--mkt-accent)",
                  }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <h3
                  className="text-[15px] font-semibold tracking-tight"
                  style={{ color: "var(--mkt-text)" }}
                >
                  {title}
                </h3>
              </div>
              <p
                className="text-[13px] leading-relaxed"
                style={{ color: "color-mix(in oklab, var(--mkt-text) 62%, transparent)" }}
              >
                {summary}
              </p>
              <ul className="space-y-2">
                {items.map((it) => (
                  <li
                    key={it}
                    className="flex items-start gap-2 text-[12.5px] leading-relaxed"
                    style={{ color: "color-mix(in oklab, var(--mkt-text) 78%, transparent)" }}
                  >
                    <span
                      className="mt-1.5 h-1 w-1 flex-none rounded-full"
                      style={{ background: "var(--mkt-text)" }}
                    />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Framework alignment — interactive expander */}
      <section id="aligned-vs-certified" className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          eyebrow="Aligned vs. certified"
          title="Expand any control to see scope and shared-responsibility detail."
          intro="Each framework below is deliberately labelled with its current state — aligned, in progress, or not certified. Open a row to see what is in scope, who does what, and which evidence ReconIQ can share."
        />

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className="rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.18em]"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 12%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 32%, transparent)",
              color: "var(--mkt-accent)",
            }}
          >
            Aligned by design — controls built to the framework, no third-party attestation yet
          </span>
          <span
            className="rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.18em]"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 4%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 18%, transparent)",
              color: "color-mix(in oklab, var(--mkt-text) 70%, transparent)",
            }}
          >
            Not certified — out of scope for the ReconIQ service
          </span>
        </div>

        <div
          className="mt-6 overflow-hidden rounded-2xl"
          style={{
            background: "color-mix(in oklab, var(--mkt-text) 2.5%, transparent)",
            border: "1px solid color-mix(in oklab, var(--mkt-text) 14%, transparent)",
          }}
        >
          {FRAMEWORK_ALIGNMENT.map((row, idx) => (
            <details
              key={row.framework}
              className="group border-t first:border-t-0"
              style={{ borderColor: "color-mix(in oklab, var(--mkt-text) 10%, transparent)" }}
            >
              <summary
                className="flex cursor-pointer list-none items-start gap-4 px-5 py-4 transition hover:bg-[var(--mkt-surface-2)]"
                onClick={() =>
                  trackCtaEvent("click", {
                    cta_id: `framework_expand_${idx}`,
                    source: "security_aligned_vs_certified",
                  })
                }
              >
                <span
                  aria-hidden
                  className="mt-1 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full transition group-open:rotate-90"
                  style={{
                    background: "color-mix(in oklab, var(--mkt-text) 14%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--mkt-text) 32%, transparent)",
                    color: "var(--mkt-accent)",
                  }}
                >
                  <ArrowRight className="h-3 w-3" />
                </span>
                <span className="flex-1">
                  <span
                    className="block text-[14px] font-semibold"
                    style={{ color: "var(--mkt-text)" }}
                  >
                    {row.framework}
                  </span>
                  <span
                    className="mt-1 block text-[12.5px] leading-relaxed"
                    style={{ color: "color-mix(in oklab, var(--mkt-text) 68%, transparent)" }}
                  >
                    {row.note}
                  </span>
                </span>
                <span className="flex-none pt-0.5">
                  <StatusBadge status={row.status} />
                </span>
              </summary>

              <div
                className="grid gap-5 px-5 pb-6 pt-2 md:grid-cols-2"
                style={{ background: "color-mix(in oklab, var(--mkt-text) 1.5%, transparent)" }}
              >
                <ExpanderBlock title="Scope">
                  <p
                    className="text-[12.5px] leading-relaxed"
                    style={{ color: "color-mix(in oklab, var(--mkt-text) 78%, transparent)" }}
                  >
                    {row.scope}
                  </p>
                </ExpanderBlock>
                <ExpanderBlock title="Evidence ReconIQ can share">
                  <ExpanderList items={row.evidence} />
                </ExpanderBlock>
                <ExpanderBlock title="ReconIQ is responsible for">
                  <ExpanderList items={row.fviResponsibilities} />
                </ExpanderBlock>
                <ExpanderBlock title="Customer is responsible for">
                  <ExpanderList items={row.customerResponsibilities} />
                </ExpanderBlock>
              </div>
            </details>
          ))}
        </div>

        <p
          className="mt-4 text-[11.5px]"
          style={{ color: "color-mix(in oklab, var(--mkt-text) 50%, transparent)" }}
        >
          &ldquo;Aligned by design&rdquo; means the platform&rsquo;s architecture and processes were
          shaped by the referenced framework. It does not constitute an audit opinion, certificate, or
          regulatory approval. Formal reports are pursued as the platform matures.
        </p>
      </section>


      {/* Privacy & subprocessors */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          eyebrow="Data privacy"
          title="Personal data, retention, and subject rights."
          intro="We process customer data as a processor under GDPR (and equivalents) on the documented instructions of each customer."
        />

        <div className="grid gap-5 md:grid-cols-2">
          <div
            className="rounded-2xl p-5"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 12%, transparent)",
            }}
          >
            <h3
              className="text-[14px] font-semibold"
              style={{ color: "var(--mkt-text)" }}
            >
              Personal data &amp; retention
            </h3>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--mkt-text) 72%, transparent)" }}
            >
              Data classes, minimum retention windows, and the legal basis for each are published on
              the{" "}
              <Link to="/retention" className="underline underline-offset-2" style={{ color: "var(--mkt-accent)" }}>
                Data Retention Policy
              </Link>
              . Tenant administrators may extend, but not reduce below, platform minimums.
            </p>
          </div>

          <div
            className="rounded-2xl p-5"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 12%, transparent)",
            }}
          >
            <h3
              className="text-[14px] font-semibold"
              style={{ color: "var(--mkt-text)" }}
            >
              Subprocessors
            </h3>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--mkt-text) 72%, transparent)" }}
            >
              A current list of subprocessors — including their role, region, and safeguards — is
              provided as part of the Data Processing Addendum on request via{" "}
              <Link to="/contact" className="underline underline-offset-2" style={{ color: "var(--mkt-accent)" }}>
                the contact form
              </Link>
              . Material changes are notified in accordance with the DPA.
            </p>
          </div>

          <div
            className="rounded-2xl p-5"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 12%, transparent)",
            }}
          >
            <h3
              className="text-[14px] font-semibold"
              style={{ color: "var(--mkt-text)" }}
            >
              Data-subject requests
            </h3>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--mkt-text) 72%, transparent)" }}
            >
              End-user requests (access, rectification, erasure, portability) should be routed
              through the controller — typically your organisation. ReconIQ supports the controller in
              responding within statutory timelines.
            </p>
          </div>

          <div
            className="rounded-2xl p-5"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 12%, transparent)",
            }}
          >
            <h3
              className="text-[14px] font-semibold"
              style={{ color: "var(--mkt-text)" }}
            >
              International transfers
            </h3>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--mkt-text) 72%, transparent)" }}
            >
              Where personal data leaves the customer&rsquo;s selected region, transfers rely on
              Standard Contractual Clauses (SCCs) and, where applicable, the UK IDTA, supported by
              technical measures such as encryption in transit and at rest.
            </p>
          </div>
        </div>
      </section>

      {/* Incident response & vulnerability disclosure */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          eyebrow="Incident response &amp; disclosure"
          title="How to reach us on a security matter."
        />
        <div className="grid gap-5 md:grid-cols-2">
          <div
            className="rounded-2xl p-6"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 12%, transparent)",
            }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle
                className="h-4 w-4"
                style={{ color: "var(--mkt-accent)" }}
                aria-hidden="true"
              />
              <h3
                className="text-[14px] font-semibold"
                style={{ color: "var(--mkt-text)" }}
              >
                Security incidents
              </h3>
            </div>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--mkt-text) 75%, transparent)" }}
            >
              Customers are notified of confirmed security incidents affecting their tenant without
              undue delay, in line with contractual and statutory obligations. Our incident-response
              playbook covers triage, containment, eradication, recovery, and post-incident review.
            </p>
            <Link
              to="/contact"
              className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
              style={{ color: "var(--mkt-accent)" }}
            >
              <Mail className="h-3.5 w-3.5" /> Contact us via the contact form
            </Link>
            <a
              href="mailto:security@reconintelligence.app"
              className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold"
              style={{ color: "var(--mkt-accent)" }}
            >
              <Mail className="h-3.5 w-3.5" /> security@reconintelligence.app
            </a>
          </div>

          <div
            className="rounded-2xl p-6"
            style={{
              background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--mkt-text) 12%, transparent)",
            }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="h-4 w-4"
                style={{ color: "var(--mkt-accent)" }}
                aria-hidden="true"
              />
              <h3
                className="text-[14px] font-semibold"
                style={{ color: "var(--mkt-text)" }}
              >
                Vulnerability disclosure
              </h3>
            </div>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--mkt-text) 75%, transparent)" }}
            >
              Researchers who believe they have identified a vulnerability affecting the platform
              are invited to report it privately. We do not pursue legal action against good-faith
              testing that respects user privacy, data integrity, and service availability.
            </p>
            <Link
              to="/contact"
              className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
              style={{ color: "var(--mkt-accent)" }}
            >
              <Mail className="h-3.5 w-3.5" /> Report privately via the contact form
            </Link>
          </div>
        </div>
      </section>

      {/* Closing note */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div
          className="rounded-2xl p-6 md:p-7"
          style={{
            background: "color-mix(in oklab, var(--mkt-text) 2.5%, transparent)",
            border: "1px solid color-mix(in oklab, var(--mkt-text) 14%, transparent)",
          }}
        >
          <h3
            className="text-[15px] font-semibold"
            style={{ color: "var(--mkt-text)" }}
          >
            Need something not published here?
          </h3>
          <p
            className="mt-2 text-[13.5px] leading-relaxed"
            style={{ color: "color-mix(in oklab, var(--mkt-text) 72%, transparent)" }}
          >
            Enterprise customers can request the full due-diligence pack — including completed SIG
            Core and CAIQ v4, current penetration-test summary, SBOM, DPA and sub-processor register,
            and architecture diagrams — under mutual NDA.
          </p>
          <div className="mt-4">
            <Link
              to="/contact"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--mkt-btn-bg)] px-4 py-2 text-[12px] font-semibold text-[var(--mkt-btn-text)] transition hover:opacity-85"
              style={{
                border: "1px solid var(--mkt-btn-bg)",
              }}
            >
              Contact the ReconIQ trust team <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </main>
      <MarketingFooter />
    </div>
  );
}

function ExpanderBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "color-mix(in oklab, var(--mkt-text) 3%, transparent)",
        border: "1px solid color-mix(in oklab, var(--mkt-text) 14%, transparent)",
      }}
    >
      <div
        className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.2em]"
        style={{ color: "var(--mkt-accent)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function ExpanderList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="flex gap-2 text-[12.5px] leading-relaxed"
          style={{ color: "color-mix(in oklab, var(--mkt-text) 78%, transparent)" }}
        >
          <span
            aria-hidden
            className="mt-1.5 h-1 w-1 flex-none rounded-full"
            style={{ background: "var(--mkt-text)" }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: "Aligned by design" | "In progress" | "Not certified" }) {
  const tone =
    status === "Aligned by design"
      ? { bg: 12, border: 32, color: "var(--mkt-accent)" }
      : status === "In progress"
        ? { bg: 8, border: 24, color: "var(--mkt-accent)" }
        : { bg: 4, border: 18, color: "color-mix(in oklab, var(--mkt-text) 70%, transparent)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] whitespace-nowrap"
      style={{
        background: `color-mix(in oklab, var(--mkt-text) ${tone.bg}%, transparent)`,
        border: `1px solid color-mix(in oklab, var(--mkt-text) ${tone.border}%, transparent)`,
        color: tone.color,
      }}
    >
      {status}
    </span>
  );
}
