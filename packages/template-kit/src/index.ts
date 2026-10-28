/**
 * @fvi/template-kit — Phase 3 Strategic
 *
 * ONE canonical SDK every publisher (recon, regulatory, AML, workflow,
 * report, persona, parser, runbook, preset, email) writes through.
 *
 *   manifestSchema   — one Zod schema for every template kind
 *   sign()           — one signer (Ed25519 over the canonical manifest)
 *   certify()        — one certifier (spec-valid + governance-score >= 80)
 *   install()        — one installer (writes tenant_template_installs)
 *   upgrade()        — one upgrader (bumps installed_version + audit)
 *
 * All domain-specific "publish" UIs deprecate onto Marketplace SDK.
 * This module is bundler-agnostic; the server-fn layer (marketplace
 * functions in src/lib/marketplace.functions.ts) is the runtime.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Manifest — one shape for every template kind.
// ---------------------------------------------------------------------------
export const TemplateKind = z.enum([
  "recon_template",
  "data_prep_pipeline",
  "connector_config",
  "rule_pack",
  "dashboard",
  "regulatory_pack",
  "aml_pack",
  "compliance_pack",
  "workflow",
  "report",
  "persona",
  "parser",
  "runbook",
  "preset",
  "email_template",
  "industry_pack",
  "starter_kit",
]);
export type TemplateKind = z.infer<typeof TemplateKind>;

export const TemplateTier = z.enum(["community", "partner", "official"]);
export type TemplateTier = z.infer<typeof TemplateTier>;

export const TemplateChannel = z.enum(["public", "private", "enterprise"]);
export type TemplateChannel = z.infer<typeof TemplateChannel>;

export const manifestSchema = z.object({
  slug: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/),
  title: z.string().min(3).max(160),
  kind: TemplateKind,
  tier: TemplateTier.default("community"),
  channel: TemplateChannel.default("public"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publisher: z.string().min(2),
  publisher_lei: z.string().length(20).optional(),
  publisher_domain: z.string().optional(),
  summary: z.string().max(500).optional(),
  description: z.string().max(20000).optional(),
  tags: z.array(z.string()).default([]),
  tenant_scope: z.array(z.string().uuid()).default([]), // enterprise-only visibility
  payload: z.record(z.string(), z.unknown()).default({}),
  requires: z
    .object({
      min_plan: z.string().optional(),
      capabilities: z.array(z.string()).default([]),
    })
    .default({ capabilities: [] }),
});
export type TemplateManifest = z.infer<typeof manifestSchema>;

// ---------------------------------------------------------------------------
// Canonicalization + signing
// ---------------------------------------------------------------------------
export function canonicalize(m: TemplateManifest): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortKeys((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sortKeys(m));
}

export interface SignedManifest {
  manifest: TemplateManifest;
  digest: string;   // SHA-256 hex
  signature: string; // Ed25519 or HMAC hex, produced by signer
  signer_kid: string;
}

/**
 * `sign` is intentionally transport-agnostic. Callers pass a signer that
 * knows how to reach the Enterprise Vault (Azure KV / AWS SM / HashiCorp /
 * GCP SM / Internal); the SDK never sees raw keys.
 */
export async function sign(
  manifest: TemplateManifest,
  signer: (payload: string) => Promise<{ signature: string; signer_kid: string; digest: string }>,
): Promise<SignedManifest> {
  const canonical = canonicalize(manifest);
  const { signature, signer_kid, digest } = await signer(canonical);
  return { manifest, digest, signature, signer_kid };
}

// ---------------------------------------------------------------------------
// Certification — one deterministic gate (spec + governance).
// ---------------------------------------------------------------------------
export interface CertificationResult {
  passed: boolean;
  score: number;
  errors: string[];
  warnings: string[];
  gates: {
    spec_valid: boolean;
    signature_valid: boolean;
    governance_score: number;
    min_score: number;
  };
}

export function certify(
  signed: SignedManifest,
  scores: { governance_score: number; ai_score?: number; recon_score?: number },
  opts: { minScore?: number } = {},
): CertificationResult {
  const min_score = opts.minScore ?? 80;
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = manifestSchema.safeParse(signed.manifest);
  const spec_valid = parsed.success;
  if (!spec_valid) errors.push(...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const signature_valid = !!signed.signature && !!signed.signer_kid && !!signed.digest;
  if (!signature_valid) errors.push("signature missing");
  const governance_score = scores.governance_score ?? 0;
  if (governance_score < min_score) warnings.push(`governance ${governance_score} < ${min_score}`);
  const composite = Math.round(
    (governance_score + (scores.ai_score ?? governance_score) + (scores.recon_score ?? governance_score)) / 3,
  );
  return {
    passed: spec_valid && signature_valid && governance_score >= min_score,
    score: composite,
    errors,
    warnings,
    gates: { spec_valid, signature_valid, governance_score, min_score },
  };
}

// ---------------------------------------------------------------------------
// Install / upgrade contracts — the server-fn layer (marketplace.functions.ts)
// implements these against Supabase. The SDK owns the shape.
// ---------------------------------------------------------------------------
export interface InstallRequest {
  tenant_id: string;
  listing_id: string;
  target_version: string;
  channel?: TemplateChannel;
}
export interface InstallResult {
  install_id: string;
  installed_version: string;
  installed_at: string;
}
export interface UpgradeRequest {
  tenant_id: string;
  install_id: string;
  target_version: string;
}

/**
 * `install` and `upgrade` are contract stubs — the app-side server fns
 * (installListing, uninstallListing, rateListing in src/lib/marketplace.functions.ts)
 * are the deployed implementation. Any new domain publisher (regulatory,
 * AML, persona, parser, runbook, preset, email) must go through these
 * contracts rather than hand-rolled inserts into legacy tables.
 */
export type Installer = (req: InstallRequest) => Promise<InstallResult>;
export type Upgrader = (req: UpgradeRequest) => Promise<InstallResult>;

export const TEMPLATE_KIT_VERSION = "0.1.0";
