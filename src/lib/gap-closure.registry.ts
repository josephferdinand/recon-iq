/**
 * Gap Closure evidence registry.
 *
 * A catalogue entry is not a delivery claim. Status is derived from registered
 * evidence: runtime/test evidence is verified, a live consumer is wired, and
 * an entry without either remains catalogued. This prevents roadmap labels
 * such as "shipped" from being presented as operational evidence.
 */

export type GapCategory =
  | "Billing & Revenue"
  | "Contracts & Compliance"
  | "Identity & Policy"
  | "AI Risk"
  | "Lifecycle & Deploy"
  | "UX & Automation"
  | "Ops & Reliability"
  | "Security Hardening";

export type GapEvidenceKind = "consumer" | "automated-test" | "runtime-readback";
export type GapEvidenceStatus = "verified" | "wired" | "catalogued";

export type GapEvidence = {
  kind: GapEvidenceKind;
  ref: string;
  note: string;
  verifiedAt?: string;
};

export type GapItem = {
  id: string;
  title: string;
  description: string;
  category: GapCategory;
  /** platform.tsx PAGES key (?page=…) OR full absolute path (/…) */
  target: string;
  /** true if the target is a full path, false = platform ?page= */
  external?: boolean;
  evidence: readonly GapEvidence[];
};

const GAP_EVIDENCE: Readonly<Record<string, readonly GapEvidence[]>> = {
  "password-policy": [
    {
      kind: "runtime-readback",
      ref: "CODEX.md#supabase-auth-hardening--2026-09-01-1610-ist",
      note: "PROD and DEV enforce the verified 12-character minimum.",
      verifiedAt: "2026-09-01T16:10:00+05:30",
    },
  ],
  "theme-palettes": [
    {
      kind: "consumer",
      ref: "src/components/seeded-palette-switcher.tsx",
      note: "The UI imports and invokes listThemePalettes.",
    },
  ],
  benchmarks: [
    {
      kind: "consumer",
      ref: "src/components/platform-benchmarks-tab.tsx",
      note: "The Platform UI invokes the backing performance function.",
    },
  ],
  migrations: [
    {
      kind: "consumer",
      ref: "src/components/platform-migrations-tab.tsx",
      note: "The Platform UI invokes migration list and rerun functions.",
    },
  ],
  "schema-drift": [
    {
      kind: "consumer",
      ref: "src/components/platform-schema-drift-tab.tsx",
      note: "The Platform UI invokes drift listing and rebaseline functions.",
    },
  ],
  "cross-recon": [
    {
      kind: "consumer",
      ref: "src/components/platform-cross-recon-tab.tsx",
      note: "The Platform UI invokes the cross-reconciliation function.",
    },
  ],
  "policy-auditor": [
    {
      kind: "consumer",
      ref: "src/components/platform-policy-auditor-tab.tsx",
      note: "The Platform UI invokes the policy-audit function.",
    },
  ],
  "mfa-enrollment": [
    {
      kind: "consumer",
      ref: "src/components/mfa-enrollment-panel.tsx",
      note: "The authenticated UI invokes the MFA enrollment functions.",
    },
  ],
  "audit-chain-verify": [
    {
      kind: "automated-test",
      ref: "tests/verify-audit-chain-rbac.spec.ts",
      note: "The audit-chain verification authorization contract is tested.",
      verifiedAt: "2026-09-01T05:33:00+05:30",
    },
    {
      kind: "runtime-readback",
      ref: "CODEX.md#current-verified-checkpoint--2026-09-01-1510-ist",
      note: "PROD and DEV audit graph and anchor evidence were read back.",
      verifiedAt: "2026-09-01T15:10:00+05:30",
    },
  ],
};

type GapDefinition = Omit<GapItem, "evidence">;

const gap = (definition: GapDefinition): GapItem => ({
  ...definition,
  evidence: GAP_EVIDENCE[definition.id] ?? [],
});

export function getGapEvidenceStatus(item: GapItem): GapEvidenceStatus {
  if (
    item.evidence.some(
      (entry) => entry.kind === "runtime-readback" || entry.kind === "automated-test",
    )
  ) {
    return "verified";
  }
  if (item.evidence.some((entry) => entry.kind === "consumer")) return "wired";
  return "catalogued";
}

export const GAP_ITEMS: GapItem[] = [
  // Billing & Revenue (7)
  gap({
    id: "revenue-snapshots",
    title: "Revenue snapshots",
    description: "MRR/ARR history + plan mix",
    category: "Billing & Revenue",
    target: "modules",
  }),
  gap({
    id: "invoices",
    title: "Invoices",
    description: "Per-tenant invoice ledger + status",
    category: "Billing & Revenue",
    target: "modules",
  }),
  gap({
    id: "billing-alerts",
    title: "Billing alerts",
    description: "Overage, past-due, dispute escalations",
    category: "Billing & Revenue",
    target: "modules",
  }),
  gap({
    id: "tax-configs",
    title: "Tax configuration",
    description: "Per-country VAT / GST / sales tax rules",
    category: "Billing & Revenue",
    target: "modules",
  }),
  gap({
    id: "dunning-events",
    title: "Dunning events",
    description: "Retry ladder + hand-off to collections",
    category: "Billing & Revenue",
    target: "modules",
  }),
  gap({
    id: "revenue-forecasts",
    title: "Revenue forecasts",
    description: "Rolling 90/180/365 day models",
    category: "Billing & Revenue",
    target: "modules",
  }),
  gap({
    id: "chargebacks",
    title: "Chargebacks",
    description: "Provider disputes + evidence packs",
    category: "Billing & Revenue",
    target: "modules",
  }),

  // Contracts & Compliance (5)
  gap({
    id: "contracts",
    title: "Contracts",
    description: "MSA / DPA / order-form registry",
    category: "Contracts & Compliance",
    target: "modules",
  }),
  gap({
    id: "compliance-bundles",
    title: "Compliance bundles",
    description: "SOC 2, ISO 27001, DORA, PCI evidence packs",
    category: "Contracts & Compliance",
    target: "soc2-monitor",
  }),
  gap({
    id: "phi-markers",
    title: "PHI markers",
    description: "HIPAA data-class markers on tenants",
    category: "Contracts & Compliance",
    target: "pii-events",
  }),
  gap({
    id: "risk-register",
    title: "Risk register",
    description: "Enterprise risk log with owner + treatment",
    category: "Contracts & Compliance",
    target: "modules",
  }),
  gap({
    id: "exceptions",
    title: "Policy exceptions",
    description: "Time-bound waivers with dual approval",
    category: "Contracts & Compliance",
    target: "modules",
  }),

  // Identity & Policy (5)
  gap({
    id: "password-policy",
    title: "Global password policy",
    description: "Length, complexity, rotation, breach checks",
    category: "Identity & Policy",
    target: "auth-providers",
  }),
  gap({
    id: "session-policy",
    title: "Global session policy",
    description: "Idle, absolute, concurrent-session caps",
    category: "Identity & Policy",
    target: "sessions-security",
  }),
  gap({
    id: "data-classification",
    title: "Data classification",
    description: "PII / PHI / PCI tags on columns",
    category: "Identity & Policy",
    target: "policy-auditor",
  }),
  gap({
    id: "policy-simulations",
    title: "Policy simulations",
    description: "Dry-run RLS/RBAC changes on live traffic",
    category: "Identity & Policy",
    target: "policy-auditor",
  }),
  gap({
    id: "geo-restrictions",
    title: "Geo restrictions",
    description: "Country allow/deny + IP CIDR gates",
    category: "Identity & Policy",
    target: "residency",
  }),

  // AI Risk (3)
  gap({
    id: "ai-models-risk",
    title: "AI model risk register",
    description: "Per-model risk rating + owner",
    category: "AI Risk",
    target: "ai-control-plane",
  }),
  gap({
    id: "model-risk-rating",
    title: "Set model risk",
    description: "Update tier + reviewer sign-off",
    category: "AI Risk",
    target: "ai-control-plane",
  }),
  gap({
    id: "hallucination-metrics",
    title: "Hallucination metrics",
    description: "Rolling p50/p90 fabrication rate",
    category: "AI Risk",
    target: "ai-control-plane",
  }),

  // Lifecycle & Deploy (6)
  gap({
    id: "lifecycle-ops",
    title: "Lifecycle operations",
    description: "Suspend, resume, purge, clone tenants",
    category: "Lifecycle & Deploy",
    target: "tenants",
  }),
  gap({
    id: "environments",
    title: "Environments",
    description: "Dev / UAT / Prod segregation",
    category: "Lifecycle & Deploy",
    target: "modules",
  }),
  gap({
    id: "deployments",
    title: "Deployments",
    description: "Requested / approved / rolled-back log",
    category: "Lifecycle & Deploy",
    target: "promo",
  }),
  gap({
    id: "rollback",
    title: "One-click rollback",
    description: "Revert last deploy with audit trail",
    category: "Lifecycle & Deploy",
    target: "promo",
  }),
  gap({
    id: "rca-hints",
    title: "RCA hints",
    description: "Auto-suggested root-cause pointers",
    category: "Lifecycle & Deploy",
    target: "ops-console",
  }),
  gap({
    id: "capacity-forecasts",
    title: "Capacity forecasts",
    description: "CPU / DB / storage 30-day forecasts",
    category: "Lifecycle & Deploy",
    target: "benchmarks",
  }),

  // UX & Automation (5)
  gap({
    id: "theme-palettes",
    title: "Theme palettes",
    description: "Tenant seeded palettes (Falcon default)",
    category: "UX & Automation",
    target: "modules",
  }),
  gap({
    id: "command-registry",
    title: "Command registry",
    description: "Global palette + keyboard shortcuts",
    category: "UX & Automation",
    target: "modules",
  }),
  gap({
    id: "saved-commands",
    title: "Saved commands",
    description: "User + workspace favourites",
    category: "UX & Automation",
    target: "modules",
  }),
  gap({
    id: "tenant-health-scores",
    title: "Tenant health scores",
    description: "Adoption + risk composite score",
    category: "UX & Automation",
    target: "tenants",
  }),
  gap({
    id: "persona-journeys",
    title: "Persona journeys",
    description: "End-to-end scorecards per persona",
    category: "UX & Automation",
    target: "persona-journeys",
  }),

  // Ops & Reliability (5)
  gap({
    id: "benchmarks",
    title: "Benchmarks",
    description: "Recon perf p50/p95, worker throughput",
    category: "Ops & Reliability",
    target: "benchmarks",
  }),
  gap({
    id: "migrations",
    title: "Migrations",
    description: "History + re-run failed imports",
    category: "Ops & Reliability",
    target: "migrations",
  }),
  gap({
    id: "schema-drift",
    title: "Schema drift",
    description: "Detected drift vs baseline + re-baseline",
    category: "Ops & Reliability",
    target: "schema-drift",
  }),
  gap({
    id: "cross-recon",
    title: "Cross-recon intel",
    description: "Duplicate/related recons across tenants",
    category: "Ops & Reliability",
    target: "cross-recon",
  }),
  gap({
    id: "policy-auditor",
    title: "Policy auditor",
    description: "RLS/permission audit + fixes",
    category: "Ops & Reliability",
    target: "policy-auditor",
  }),

  // Security Hardening (5)
  gap({
    id: "mfa-enrollment",
    title: "MFA enrollment",
    description: "TOTP + WebAuthn enrollment flows",
    category: "Security Hardening",
    target: "sessions-security",
  }),
  gap({
    id: "sms-otp",
    title: "SMS OTP (Twilio)",
    description: "BYO-Twilio SMS OTP via Vault-managed creds",
    category: "Security Hardening",
    target: "vault",
  }),
  gap({
    id: "session-anomalies",
    title: "Session anomalies",
    description: "Impossible travel / new device alerts",
    category: "Security Hardening",
    target: "session-anomalies",
  }),
  gap({
    id: "break-glass",
    title: "Break-glass access",
    description: "Time-boxed elevated grants + audit",
    category: "Security Hardening",
    target: "break-glass",
  }),
  gap({
    id: "audit-chain-verify",
    title: "Audit chain verify",
    description: "HMAC verification of audit ledger",
    category: "Security Hardening",
    target: "audit",
  }),
];

export const GAP_COUNT = GAP_ITEMS.length;
