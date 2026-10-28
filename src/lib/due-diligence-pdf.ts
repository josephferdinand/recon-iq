import { jsPDF } from "jspdf";

export type PackRecipient = {
  recipient: string;
  company: string;
  email: string;
  role: string;
  reference: string;
};

const GOLD = "#2997ff";
const INK = "#000000";
const CREAM = "#f5f5f7";
const MUTED = "#a1a1a6";

export async function generateDueDiligencePdf(r: PackRecipient): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  const contentW = W - M * 2;
  const today = new Date().toISOString().slice(0, 10);
  const refShort = (r.reference || "PENDING").slice(0, 8).toUpperCase();

  // ---------- Cover ----------
  doc.setFillColor(INK);
  doc.rect(0, 0, W, H, "F");
  doc.setFillColor(GOLD);
  doc.rect(0, 0, W, 6, "F");

  doc.setTextColor(GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("RECONIQ", M, 72);

  doc.setTextColor(CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.text("Due-Diligence Pack", M, 150);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(CREAM);
  doc.text(
    "Enterprise security, architecture, and compliance overview for\nInfoSec, Operational Risk, Data Privacy, Legal, and Procurement teams.",
    M,
    182
  );

  // Recipient card
  const cardY = 260;
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.6);
  doc.roundedRect(M, cardY, contentW, 130, 8, 8, "S");

  doc.setTextColor(GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("PREPARED FOR", M + 18, cardY + 24);

  doc.setTextColor(CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(r.recipient, M + 18, cardY + 46);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(CREAM);
  doc.text(`${r.company}  ·  ${r.role}`, M + 18, cardY + 66);
  doc.setTextColor(MUTED);
  doc.text(r.email, M + 18, cardY + 84);

  doc.setDrawColor(GOLD);
  doc.line(M + 18, cardY + 96, M + contentW - 18, cardY + 96);

  doc.setTextColor(MUTED);
  doc.setFontSize(9);
  doc.text(`Reference: ${refShort}`, M + 18, cardY + 114);
  doc.text(`Issued: ${today}`, M + contentW - 18, cardY + 114, { align: "right" });

  // Footer / disclaimer
  doc.setTextColor(MUTED);
  doc.setFontSize(8);
  doc.text(
    "Confidential. Shared for vendor evaluation purposes. Redistribution requires ReconIQ's written consent.",
    M,
    H - 40
  );
  doc.text("reconintelligence.app  ·  via the contact form at reconintelligence.app/contact", M, H - 26);

  // ---------- Content pages ----------
  for (const section of SECTIONS) {
    doc.addPage();
    renderContentPage(doc, section, r);
  }

  // ---------- Back page ----------
  doc.addPage();
  renderBackPage(doc, r);

  doc.save(`ReconIQ-Due-Diligence-Pack-${refShort}.pdf`);
}

function renderContentPage(
  doc: jsPDF,
  section: Section,
  r: PackRecipient
): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;

  // header strip
  doc.setFillColor(INK);
  doc.rect(0, 0, W, H, "F");
  doc.setFillColor(GOLD);
  doc.rect(0, 0, W, 3, "F");

  doc.setTextColor(GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`ReconIQ · ${section.eyebrow}`, M, 48);

  doc.setTextColor(CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(section.title, M, 78);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(CREAM);
  const introLines = doc.splitTextToSize(section.intro, W - M * 2);
  doc.text(introLines, M, 108);

  let y = 108 + introLines.length * 14 + 12;

  for (const item of section.items) {
    if (y > H - 90) break;
    // bullet
    doc.setFillColor(GOLD);
    doc.circle(M + 3, y - 3, 2, "F");

    doc.setTextColor(CREAM);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(item.label, M + 14, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    const bodyLines = doc.splitTextToSize(item.body, W - M * 2 - 14);
    doc.text(bodyLines, M + 14, y + 14);
    y += 14 + bodyLines.length * 12 + 10;
  }

  // footer
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.3);
  doc.line(M, H - 54, W - M, H - 54);
  doc.setTextColor(MUTED);
  doc.setFontSize(8);
  doc.text(`Reference ${(r.reference || "PENDING").slice(0, 8).toUpperCase()}  ·  Confidential`, M, H - 38);
  doc.text("reconintelligence.app", W - M, H - 38, { align: "right" });
}

function renderBackPage(doc: jsPDF, r: PackRecipient): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;

  doc.setFillColor(INK);
  doc.rect(0, 0, W, H, "F");
  doc.setFillColor(GOLD);
  doc.rect(0, 0, W, 3, "F");

  doc.setTextColor(GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("ReconIQ · NEXT STEPS", M, 48);

  doc.setTextColor(CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Next steps for your review", M, 84);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(CREAM);
  const lines = doc.splitTextToSize(
    "This pack summarizes controls that are built and testable in-product today. Formal third-party attestations (SOC 2 Type II, ISO 27001) are on the roadmap and will be published as they complete — ReconIQ does not claim certifications it has not yet earned.",
    W - M * 2
  );
  doc.text(lines, M, 114);

  let y = 114 + lines.length * 14 + 16;
  const nextSteps: [string, string][] = [
    ["1  ·  NDA & full evidence", "Mutual NDA execution unlocks the full SIG Lite, CAIQ, DPA, subprocessor list, and sample audit-log bundle."],
    ["2  ·  Second-line review", "Joint sessions with InfoSec, Op-Risk, Compliance, and Data Privacy against your control catalogue."],
    ["3  ·  Controlled pilot", "Time-boxed, sandbox-only reconciliation on masked datasets with success criteria signed off up-front."],
    ["4  ·  Production onboarding", "Progressive rollout — sandbox → limited production → BAU — with change-control and rollback checkpoints."],
  ];
  for (const [k, v] of nextSteps) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GOLD);
    doc.text(k, M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(CREAM);
    const b = doc.splitTextToSize(v, W - M * 2);
    doc.text(b, M, y + 14);
    y += 14 + b.length * 12 + 12;
  }

  // Contact block
  y = Math.max(y + 8, H - 200);
  doc.setDrawColor(GOLD);
  doc.roundedRect(M, y, W - M * 2, 120, 8, 8, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(GOLD);
  doc.text("Enterprise contacts", M + 18, y + 26);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(CREAM);
  doc.text("All enquiries — Security & Compliance, Enterprise Sales, and", M + 18, y + 48);
  doc.text("Data Protection — via the contact form at", M + 18, y + 66);
  doc.text("reconintelligence.app/contact", M + 18, y + 84);
  doc.setTextColor(MUTED);
  doc.setFontSize(9);
  doc.text(
    `Prepared for ${r.recipient} (${r.company}) · reference ${(r.reference || "PENDING").slice(0, 8).toUpperCase()}`,
    M + 18,
    y + 104
  );

  doc.setTextColor(MUTED);
  doc.setFontSize(8);
  doc.text("© ReconIQ · Confidential", M, H - 26);
}

type SectionItem = { label: string; body: string };
type Section = { eyebrow: string; title: string; intro: string; items: SectionItem[] };

const SECTIONS: Section[] = [
  {
    eyebrow: "01  ·  OVERVIEW",
    title: "Platform overview",
    intro:
      "ReconIQ is an AI-native reconciliation platform for Tier-1 financial institutions. Multi-tenant SaaS with optional VPC/private-cloud deployment, engineered against tier-1 banking control expectations.",
    items: [
      { label: "Deployment model", body: "Multi-tenant SaaS by default; dedicated VPC and private-cloud options for regulated tenants with per-tenant KMS and network isolation." },
      { label: "Data domains supported", body: "One-sided, two-sided, and tri-party reconciliation across cash, securities, positions, trades, custody, corporate actions, fees, and intercompany." },
      { label: "AI posture", body: "AI is core — not an add-on. Includes auto-mapping, exception triage, break clustering, agentic workflows with 4-eyes approval, and copilot with tenant-scoped context." },
      { label: "Integration surface", body: "SFTP, S3/GCS/Azure Blob, Kafka, REST, JDBC, Snowflake, and native ERP connectors. Signed webhooks and streaming outputs to downstream ledgers." },
    ],
  },
  {
    eyebrow: "02  ·  SECURITY",
    title: "Security architecture",
    intro: "Defense-in-depth across identity, network, data, and workload layers. All controls are testable in-product and covered by the audit-log evidence bundle.",
    items: [
      { label: "Identity & access", body: "SSO via SAML 2.0 and OIDC, SCIM 2.0 provisioning, MFA enforcement, RBAC + ABAC predicates, SoD rules, and step-up authentication for privileged actions." },
      { label: "Encryption", body: "TLS 1.2+ in transit, AES-256 at rest, per-tenant KMS keys, and BYOK/CMEK support with customer-managed rotation policies." },
      { label: "Network", body: "Private networking with VPC peering / PrivateLink for VPC tenants, per-tenant IP allowlists, and egress restriction for outbound integrations." },
      { label: "Application security", body: "Signed artifacts, dependency scanning, static and dynamic analysis in CI, and quarterly third-party penetration testing (summary available under NDA)." },
    ],
  },
  {
    eyebrow: "03  ·  ISOLATION",
    title: "Multi-tenant isolation",
    intro: "Tenant boundaries are enforced at the database, application, and infrastructure layers — never trusted from client input.",
    items: [
      { label: "Database isolation", body: "PostgreSQL Row-Level Security on every tenant-scoped table; a public.has_role() security-definer function enforces role checks without recursion." },
      { label: "Query-time enforcement", body: "All server functions run with the caller's session; a requireSupabaseAuth middleware injects userId and RLS-bound clients. Service-role access is limited to verified webhooks and admin routines." },
      { label: "Silo option", body: "Regulated tenants can be pinned to a dedicated silo tier with per-tenant KMS, encrypted columns, and separate compute pool." },
      { label: "Isolation violation detection", body: "tenant_isolation_violations table records any cross-tenant probe with alerting to the security operations channel." },
    ],
  },
  {
    eyebrow: "04  ·  AUDIT & EVIDENCE",
    title: "Audit, evidence, and retention",
    intro: "Every state-changing action is captured and cryptographically chained. Retention is configurable per tenant with a 7-year default aligned to typical banking record-keeping.",
    items: [
      { label: "Hash-chained audit", body: "Each event stores SHA-256 hash of prior event + payload; verifier utility replays the chain to prove tamper-evidence." },
      { label: "Evidence bundles", body: "Recon runs emit signed evidence packs containing inputs, matches, exceptions, approvals, and reviewer identities." },
      { label: "WORM ledger", body: "worm_evidence_ledger provides append-only anchoring for regulatory retention scenarios." },
      { label: "Retention", body: "Default 7-year audit retention; per-tenant overrides supported. Deletion runs on schedule with signed proof-of-erasure." },
    ],
  },
  {
    eyebrow: "05  ·  COMPLIANCE",
    title: "Regulatory alignment",
    intro: "ReconIQ is architected against tier-1 banking control expectations. Formal certifications not yet earned are on the roadmap; they will be published as they complete.",
    items: [
      { label: "DORA (EU 2022/2554)", body: "ICT risk management, incident classification, TSR register, exit plans, and third-party register are modeled in-product." },
      { label: "BCBS 239", body: "Data lineage, quality controls, timeliness metrics, and completeness reporting map to the 14 principles." },
      { label: "SOC 2 / ISO 27001", body: "Controls implemented and evidenced; formal Type II / ISO certification on roadmap." },
      { label: "SIG Lite & CAIQ", body: "Both questionnaires maintained; latest revisions available under NDA on request." },
    ],
  },
  {
    eyebrow: "06  ·  OPERATIONS",
    title: "Resilience & operations",
    intro: "24×7 platform operations with tiered resilience objectives and documented disaster-recovery drills.",
    items: [
      { label: "Availability target", body: "99.95% monthly for the SaaS tier (target benchmark, not a contractual commitment prior to signed order form)." },
      { label: "RPO / RTO", body: "RPO ≤ 15 min, RTO ≤ 60 min for tier-1 tenants with multi-region active-passive DR." },
      { label: "Change management", body: "Progressive delivery with change-freeze windows, per-tenant feature flags, and full rollback via signed release artifacts." },
      { label: "Incident response", body: "24×7 on-call; sev-1 acknowledgement within 15 minutes and initial customer notification within 4 hours." },
    ],
  },
];
