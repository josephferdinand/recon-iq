// Enterprise Identity & Security v2 — server functions.
// Covers KMS (BYOK), encrypted column registry, Private Link requests,
// WORM evidence ledger, and DLP policies + scan results.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

const TenantId = z.object({ tenant_id: z.string().uuid() });

async function assertTenantAdmin(ctx: any, tenantId: string) {
  await requireTenantAdmin(ctx, tenantId, { fnName: "security-v2" });
}

async function audit(ctx: any, tenantId: string, action: string, rType: string, rId: string | null, context: any) {
  await ctx.supabase
    .from("audit_log")
    .insert({
      tenant_id: tenantId,
      scope: "tenant",
      action,
      resource_type: rType,
      resource_id: rId,
      context,
    } as any);
}

// ============================================================ KMS keys
const KmsUpsert = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  provider: z.enum(["aws_kms", "azure_key_vault", "gcp_kms", "hashicorp_vault"]),
  alias: z.string().min(1).max(120),
  key_arn: z.string().min(1).max(500),
  region: z.string().max(60).optional().nullable(),
  purpose: z.enum(["data_at_rest", "backup", "field_envelope", "signing"]).default("data_at_rest"),
  rotation_period_days: z.number().int().min(30).max(3650).default(365),
  notes: z.string().max(2000).optional().nullable(),
});

export const listKmsKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => TenantId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_kms_keys")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertKmsKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => KmsUpsert.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const payload: any = { ...data, created_by: context.userId };
    const { data: row, error } = data.id
      ? await context.supabase.from("tenant_kms_keys").update(payload).eq("id", data.id).select().single()
      : await context.supabase.from("tenant_kms_keys").insert(payload).select().single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "kms.upsert", "tenant_kms_keys", row.id, {
      provider: data.provider, alias: data.alias, purpose: data.purpose,
    });
    return row;
  });

export const verifyKmsKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    // In production this would call the provider; here we simulate a soft check.
    const { data: row, error: e1 } = await context.supabase
      .from("tenant_kms_keys").select("*").eq("id", data.id).single();
    if (e1 || !row) throw new Error(e1?.message ?? "Not found");
    const arnLooksValid =
      (row.provider === "aws_kms" && row.key_arn.startsWith("arn:aws:kms:")) ||
      (row.provider === "azure_key_vault" && row.key_arn.startsWith("https://")) ||
      (row.provider === "gcp_kms" && row.key_arn.startsWith("projects/")) ||
      (row.provider === "hashicorp_vault" && row.key_arn.length > 4);
    const status = arnLooksValid ? "active" : "failed";
    const verification_error = arnLooksValid ? null : "Key identifier failed format check";
    const { data: updated, error } = await context.supabase
      .from("tenant_kms_keys")
      .update({ status, last_verified_at: new Date().toISOString(), verification_error })
      .eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "kms.verify", "tenant_kms_keys", data.id, { status });
    return updated;
  });

export const rotateKmsKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: row, error } = await context.supabase
      .from("tenant_kms_keys")
      .update({ status: "rotating", last_rotated_at: new Date().toISOString() })
      .eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "kms.rotate", "tenant_kms_keys", data.id, {});
    // Async settle to active.
    await context.supabase.from("tenant_kms_keys").update({ status: "active" }).eq("id", data.id);
    return row;
  });

export const deleteKmsKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase.from("tenant_kms_keys").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "kms.delete", "tenant_kms_keys", data.id, {});
    return { ok: true };
  });

// ============================================ Encrypted column registry
const EncCol = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  kek_id: z.string().uuid(),
  table_name: z.string().min(1).max(120),
  column_name: z.string().min(1).max(120),
  classification: z.enum(["pii", "pci", "phi", "secret", "financial"]),
  envelope_alg: z.string().default("AES-256-GCM"),
  enabled: z.boolean().default(true),
});

export const listEncryptedColumns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => TenantId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_encrypted_columns")
      .select("*, tenant_kms_keys!kek_id(alias,provider,status)")
      .eq("tenant_id", data.tenant_id)
      .order("table_name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertEncryptedColumn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => EncCol.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const payload: any = { ...data, created_by: context.userId };
    const { data: row, error } = data.id
      ? await context.supabase.from("tenant_encrypted_columns").update(payload).eq("id", data.id).select().single()
      : await context.supabase.from("tenant_encrypted_columns").insert(payload).select().single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "encryption.column.upsert", "tenant_encrypted_columns", row.id, {
      table_name: data.table_name, column_name: data.column_name, classification: data.classification,
    });
    return row;
  });

export const deleteEncryptedColumn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase.from("tenant_encrypted_columns").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "encryption.column.delete", "tenant_encrypted_columns", data.id, {});
    return { ok: true };
  });

// ================================================ Private Link requests
const PlinkRequest = z.object({
  tenant_id: z.string().uuid(),
  provider: z.enum(["aws_kms", "azure_key_vault", "gcp_kms", "hashicorp_vault"]),
  region: z.string().min(2).max(60),
  customer_account_id: z.string().min(1).max(120),
  vpc_id: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const listPrivateLinkRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => TenantId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_private_link_requests")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createPrivateLinkRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PlinkRequest.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: row, error } = await context.supabase
      .from("tenant_private_link_requests")
      .insert({ ...data, requested_by: context.userId } as any)
      .select().single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "plink.request", "tenant_private_link_requests", row.id, {
      provider: data.provider, region: data.region,
    });
    return row;
  });

export const decidePrivateLinkRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    decision: z.enum(["approved", "rejected", "active", "revoked"]),
    endpoint_id: z.string().max(200).optional().nullable(),
    rejection_reason: z.string().max(500).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: pa } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!pa) throw new Error("Forbidden: platform admin required");
    const patch: any = { status: data.decision };
    const now = new Date().toISOString();
    if (data.decision === "approved") { patch.approved_by = context.userId; patch.approved_at = now; }
    if (data.decision === "active")   { patch.activated_at = now; patch.endpoint_id = data.endpoint_id ?? null; }
    if (data.decision === "rejected") { patch.rejection_reason = data.rejection_reason ?? null; }
    const { data: row, error } = await context.supabase
      .from("tenant_private_link_requests").update(patch).eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "plink.decision", "tenant_private_link_requests", data.id,
      { decision: data.decision });
    return row;
  });

// ====================================================== WORM ledger
export const listWormEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; limit?: number }) =>
    z.object({ tenant_id: z.string().uuid(), limit: z.number().int().min(1).max(500).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("worm_evidence_ledger").select("*")
      .eq("tenant_id", data.tenant_id)
      .order("recorded_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const appendWormEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    evidence_type: z.string().min(1).max(60),
    resource_type: z.string().max(60).optional().nullable(),
    resource_id: z.string().max(120).optional().nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    size_bytes: z.number().int().nonnegative().optional().nullable(),
    object_url: z.string().max(1000).optional().nullable(),
    bucket_name: z.string().max(120).optional().nullable(),
    retention_days: z.number().int().min(0).max(36500).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: row, error } = await context.supabase.rpc("worm_append", {
      _tenant_id: data.tenant_id,
      _evidence_type: data.evidence_type,
      _resource_type: (data.resource_type ?? null) as any,
      _resource_id: (data.resource_id ?? null) as any,
      _sha256: data.sha256.toLowerCase(),
      _size_bytes: (data.size_bytes ?? null) as any,
      _object_url: (data.object_url ?? null) as any,
      _bucket_name: (data.bucket_name ?? null) as any,
      _retention_days: (data.retention_days ?? null) as any,
    });
    if (error) throw new Error(error.message);
    return row;
  });

// ============================================== DLP policy + scanning
const DETECTORS = {
  pan: { name: "PAN (card)", re: /\b(?:\d[ -]*?){13,19}\b/g, luhn: true },
  iban: { name: "IBAN", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  ssn: { name: "US SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  email: { name: "Email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  aba: { name: "ABA routing", re: /\b\d{9}\b/g },
  swift_bic: { name: "SWIFT BIC", re: /\b[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?\b/g },
} as const;

function luhnOk(num: string): boolean {
  const d = num.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function redact(s: string): string {
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "*".repeat(Math.max(2, s.length - 4)) + s.slice(-2);
}

export const getDlpPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => TenantId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("dlp_policies").select("*").eq("tenant_id", data.tenant_id).maybeSingle();
    return row;
  });

export const upsertDlpPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    detect_pan: z.boolean().default(true),
    detect_iban: z.boolean().default(true),
    detect_ssn: z.boolean().default(true),
    detect_email: z.boolean().default(false),
    detect_aba: z.boolean().default(true),
    detect_swift_bic: z.boolean().default(false),
    default_action: z.enum(["allow", "redact", "quarantine", "block"]).default("quarantine"),
    block_on_high: z.boolean().default(true),
    enabled: z.boolean().default(true),
    custom_patterns: z.array(z.object({ name: z.string().min(1).max(60), regex: z.string().min(1).max(500) })).max(20).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: row, error } = await context.supabase
      .from("dlp_policies")
      .upsert(data as any, { onConflict: "tenant_id" })
      .select().single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "dlp.policy.upsert", "dlp_policies", row.id, {});
    return row;
  });

export const scanTextForDlp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    source_kind: z.string().min(1).max(40).default("manual"),
    source_id: z.string().max(120).optional().nullable(),
    filename: z.string().max(255).optional().nullable(),
    text: z.string().min(1).max(2_000_000), // 2 MB cap
    persist: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: policy } = await context.supabase
      .from("dlp_policies").select("*").eq("tenant_id", data.tenant_id).maybeSingle();
    const matches: Array<{ type: string; count: number; samples: string[] }> = [];
    const sampleLimit = 3;

    const enabled = {
      pan: policy?.detect_pan ?? true,
      iban: policy?.detect_iban ?? true,
      ssn: policy?.detect_ssn ?? true,
      email: policy?.detect_email ?? false,
      aba: policy?.detect_aba ?? true,
      swift_bic: policy?.detect_swift_bic ?? false,
    } as Record<keyof typeof DETECTORS, boolean>;

    for (const key of Object.keys(DETECTORS) as (keyof typeof DETECTORS)[]) {
      if (!enabled[key]) continue;
      const det = DETECTORS[key];
      const re = new RegExp(det.re.source, det.re.flags);
      const seen: string[] = [];
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = re.exec(data.text)) !== null) {
        const raw = m[0];
        if ((det as any).luhn && !luhnOk(raw)) continue;
        count++;
        if (seen.length < sampleLimit) seen.push(redact(raw.replace(/\s+/g, "")));
        if (count > 10000) break; // safety
      }
      if (count > 0) matches.push({ type: key, count, samples: seen });
    }

    // Custom patterns
    const custom = (policy?.custom_patterns ?? []) as Array<{ name: string; regex: string }>;
    for (const p of custom) {
      try {
        const re = new RegExp(p.regex, "g");
        let count = 0;
        const samples: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(data.text)) !== null) {
          count++;
          if (samples.length < sampleLimit) samples.push(redact(m[0]));
          if (count > 5000) break;
        }
        if (count > 0) matches.push({ type: `custom:${p.name}`, count, samples });
      } catch { /* skip malformed regex */ }
    }

    let severity: "info" | "low" | "medium" | "high" | "critical" = "info";
    const total = matches.reduce((s, x) => s + x.count, 0);
    const hasSensitive = matches.some(m => ["pan", "ssn"].includes(m.type));
    if (hasSensitive && total >= 5) severity = "critical";
    else if (hasSensitive) severity = "high";
    else if (total >= 10) severity = "medium";
    else if (total > 0) severity = "low";

    const block = (policy?.block_on_high ?? true) && (severity === "high" || severity === "critical");
    const action: "allow" | "redact" | "quarantine" | "block" = block
      ? "block"
      : (matches.length > 0 ? (policy?.default_action ?? "quarantine") : "allow");

    let saved: any = null;
    if (data.persist && matches.length > 0) {
      const { data: row, error } = await context.supabase
        .from("dlp_scan_results")
        .insert({
          tenant_id: data.tenant_id,
          source_kind: data.source_kind,
          source_id: data.source_id ?? null,
          filename: data.filename ?? null,
          matches,
          severity,
          action_taken: action,
        } as any)
        .select().single();
      if (error) throw new Error(error.message);
      saved = row;
    }

    return { matches, severity, action, total, scan: saved };
  });

export const listDlpScanResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; limit?: number }) =>
    z.object({ tenant_id: z.string().uuid(), limit: z.number().int().min(1).max(500).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("dlp_scan_results").select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const reviewDlpScanResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    resolution: z.string().min(1).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: row, error } = await context.supabase
      .from("dlp_scan_results")
      .update({
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        resolution: data.resolution,
      })
      .eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "dlp.review", "dlp_scan_results", data.id, {});
    return row;
  });
