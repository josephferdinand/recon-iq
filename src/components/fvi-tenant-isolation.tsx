import { motion } from "framer-motion";
import {
  Building2, ShieldCheck, KeyRound, Lock, ScrollText, Fingerprint,
  Database, Users, Network, Eye,
} from "lucide-react";

/**
 * TenantIsolationModel
 * ----------------------------------------------------------------------------
 * Buyer-friendly explainer of how ReconIQ isolates each
 * customer tenant across four control planes: scoping, access, encryption,
 * and audit. Written for InfoSec, Ops Risk, and Sourcing reviewers.
 */

const PILLARS = [
  {
    icon: Building2,
    tag: "Tenant scoping",
    title: "Every row, file, and job is bound to a tenant.",
    summary:
      "A single tenant_id follows every record from ingestion to archive. Database, object storage, queues, and search indexes all enforce the same boundary — nothing crosses a tenant line by accident or by design.",
    bullets: [
      "Row-Level Security enforced in the database, not just in application code",
      "Per-tenant object storage prefixes with signed, short-lived URLs",
      "Isolated queues and workers — no shared execution context between tenants",
      "Deterministic tenant resolution from the authenticated session, never from client input",
    ],
  },
  {
    icon: Users,
    tag: "Access controls",
    title: "Least-privilege by default, RBAC + ABAC, four-eyes on sensitive actions.",
    summary:
      "Access is granted by role, refined by attribute (business unit, reconciliation, geography), and gated by policy. Privileged operations require independent approval, and every session is bounded by SSO, MFA, and IP allow-lists.",
    bullets: [
      "SSO / SAML / OIDC with SCIM provisioning and de-provisioning",
      "Role-based and attribute-based permissions down to reconciliation and column",
      "Four-eyes (maker-checker) approval for rule changes, break write-offs, and exports",
      "Break-glass access with time-boxed elevation and full session recording",
    ],
  },
  {
    icon: KeyRound,
    tag: "Encryption",
    title: "Encrypted in transit, at rest, and — where required — under your own keys.",
    summary:
      "All traffic is TLS 1.2+ terminated at the edge. Data at rest is encrypted with envelope encryption backed by cloud KMS. Regulated workloads can pin encryption to a customer-managed key (CMEK / BYOK) that you can rotate or revoke.",
    bullets: [
      "TLS 1.2+ everywhere; HSTS, modern cipher suites, perfect forward secrecy",
      "AES-256 at rest for database, object storage, and backups",
      "BYOK / CMEK support with per-tenant key hierarchies and rotation policies",
      "Field-level encryption and PII redaction for sensitive columns",
    ],
  },
  {
    icon: ScrollText,
    tag: "Audit logging",
    title: "Hash-chained, tenant-isolated, tamper-evident — exportable on demand.",
    summary:
      "Every authentication, permission change, data read, rule edit, and reconciliation decision is written to an append-only audit log. Entries are SHA-256 hash-chained so any modification is mathematically detectable, and each tenant sees only its own trail.",
    bullets: [
      "SHA-256 hash chain — tamper attempts break the chain and trigger alerts",
      "Signed, verifiable export packages for regulators and internal auditors",
      "Retention aligned to BCBS 239, DORA, SOX, and firm-specific policies",
      "SIEM streaming (Splunk, Sentinel, Elastic) with per-tenant filtering",
    ],
  },
];

const GUARANTEES = [
  { icon: Network,     label: "No cross-tenant reads",     detail: "Enforced at the database, not just the app layer." },
  { icon: Fingerprint, label: "Every action attributable", detail: "User, tenant, IP, session, and hash on record." },
  { icon: Lock,        label: "Keys you can revoke",       detail: "BYOK/CMEK cuts access instantly when rotated." },
  { icon: Eye,         label: "Continuous evidence",       detail: "Audit exports ready for the next examination." },
];

export function TenantIsolationModel() {
  return (
    <section
      id="tenant-isolation"
      className="relative mx-auto max-w-7xl px-6 py-28"
      aria-labelledby="tenant-isolation-heading"
    >
      {/* Header */}
      <div className="mb-14 max-w-3xl">
        <div
          className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]"
          style={{
            background: "color-mix(in oklab, var(--brand-gold) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--brand-gold) 28%, transparent)",
            color: "var(--brand-gold)",
          }}
        >
          <ShieldCheck className="h-3 w-3" /> Multi-tenant isolation model
        </div>
        <h2
          id="tenant-isolation-heading"
          className="text-3xl font-semibold tracking-tight md:text-5xl"
          style={{ color: "var(--brand-cream)" }}
        >
          One platform. Many banks. Zero shared blast radius.
        </h2>
        <p
          className="mt-4 text-base md:text-lg"
          style={{ color: "color-mix(in oklab, var(--brand-cream) 70%, transparent)" }}
        >
          ReconIQ is multi-tenant by architecture and single-tenant by experience.
          Your data, keys, policies, and audit trail live inside a boundary that is enforced in the
          database, in storage, in compute, and in every log line — not just in the UI.
        </p>
      </div>

      {/* Diagram: tenants → boundary → shared control plane */}
      <div
        className="mb-16 overflow-hidden rounded-2xl p-6 md:p-8"
        style={{
          background: "color-mix(in oklab, var(--brand-cream) 3%, transparent)",
          border: "1px solid color-mix(in oklab, var(--brand-gold) 14%, transparent)",
        }}
      >
        <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr] md:items-center">
          {/* Tenants */}
          <div className="grid grid-cols-3 gap-3">
            {["Tenant A", "Tenant B", "Tenant C", "Tenant D", "Tenant E", "Tenant F"].map((t, i) => (
              <motion.div
                key={t}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: i * 0.04 }}
                className="flex flex-col items-center gap-1 rounded-xl p-3 text-center"
                style={{
                  background: "color-mix(in oklab, var(--brand-coffee-deep) 55%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
                }}
              >
                <Building2 className="h-4 w-4" style={{ color: "var(--brand-gold)" }} />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)" }}>
                  {t}
                </span>
                <span className="text-[9px]"
                  style={{ color: "color-mix(in oklab, var(--brand-cream) 45%, transparent)" }}>
                  own keys · own audit
                </span>
              </motion.div>
            ))}
          </div>

          {/* Boundary arrow */}
          <div className="flex flex-col items-center gap-2 md:px-4">
            <div
              className="h-16 w-px md:h-24"
              style={{ background: "linear-gradient(to bottom, transparent, var(--brand-gold), transparent)" }}
            />
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em]"
              style={{
                background: "color-mix(in oklab, var(--brand-gold) 14%, transparent)",
                color: "var(--brand-gold)",
                border: "1px solid color-mix(in oklab, var(--brand-gold) 32%, transparent)",
              }}
            >
              Isolation boundary
            </span>
            <div
              className="h-16 w-px md:h-24"
              style={{ background: "linear-gradient(to bottom, transparent, var(--brand-gold), transparent)" }}
            />
          </div>

          {/* Shared control plane */}
          <div
            className="rounded-xl p-5"
            style={{
              background: "color-mix(in oklab, var(--brand-coffee-deep) 70%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 22%, transparent)",
            }}
          >
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4" style={{ color: "var(--brand-gold)" }} />
              <span className="text-xs font-semibold uppercase tracking-[0.22em]"
                style={{ color: "var(--brand-cream)" }}>
                Shared control plane
              </span>
            </div>
            <ul className="space-y-2 text-xs" style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}>
              <li>· Matching, agentic AI, and orchestration engines</li>
              <li>· Observability, autoscaling, patching, and DR</li>
              <li>· No tenant data mingled — only the code path is shared</li>
              <li>· Per-tenant secrets, keys, and configuration</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Four pillars */}
      <div className="grid gap-5 md:grid-cols-2">
        {PILLARS.map(({ icon: Icon, tag, title, summary, bullets }, i) => (
          <motion.article
            key={tag}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: i * 0.05 }}
            className="relative flex flex-col gap-4 rounded-2xl p-6"
            style={{
              background: "color-mix(in oklab, var(--brand-cream) 3%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-gold) 14%, transparent)",
            }}
          >
            <div className="flex items-center gap-3">
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
                  style={{ color: "var(--brand-gold)" }}>
                  {tag}
                </p>
                <h3 className="text-lg font-semibold leading-snug md:text-xl"
                  style={{ color: "var(--brand-cream)" }}>
                  {title}
                </h3>
              </div>
            </div>

            <p className="text-sm leading-relaxed"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 72%, transparent)" }}>
              {summary}
            </p>

            <ul className="mt-1 space-y-2 text-sm"
              style={{ color: "color-mix(in oklab, var(--brand-cream) 78%, transparent)" }}>
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--brand-gold)" }}
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </motion.article>
        ))}
      </div>

      {/* Guarantees strip */}
      <div
        className="mt-10 grid gap-3 rounded-2xl p-5 md:grid-cols-4"
        style={{
          background: "color-mix(in oklab, var(--brand-coffee-deep) 55%, transparent)",
          border: "1px solid color-mix(in oklab, var(--brand-gold) 18%, transparent)",
        }}
      >
        {GUARANTEES.map(({ icon: Icon, label, detail }) => (
          <div key={label} className="flex items-start gap-3">
            <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--brand-gold)" }} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em]"
                style={{ color: "var(--brand-cream)" }}>
                {label}
              </p>
              <p className="text-xs"
                style={{ color: "color-mix(in oklab, var(--brand-cream) 62%, transparent)" }}>
                {detail}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p
        className="mt-6 max-w-3xl text-xs"
        style={{ color: "color-mix(in oklab, var(--brand-cream) 55%, transparent)" }}
      >
        Isolation controls described here are enabled by design and covered in our security packet.
        Formal certifications and the shared-responsibility model are detailed on the{" "}
        <a href="/security" className="underline underline-offset-2" style={{ color: "var(--brand-gold)" }}>
          Security &amp; Compliance
        </a>{" "}
        page.
      </p>
    </section>
  );
}
