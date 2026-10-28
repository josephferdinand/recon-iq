/**
 * SOC 2 Evidence Bundle — role-gated ZIP generator with signed URL delivery.
 *
 * - Requires platform_admin OR tenant_admin on the target tenant.
 * - Uploads the ZIP to the private `soc2-evidence` Supabase Storage bucket.
 * - Returns a short-lived signed URL (15 min) instead of raw bytes.
 * - Records the bundle in `soc2_evidence_bundles` with a link to the audit_log id.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import JSZip from "jszip";

const CATEGORY_RULES: Array<{ category: string; matches: RegExp }> = [
  { category: "authentication", matches: /^(auth\.|session\.|mfa\.|stepup|login|logout|password\.)/i },
  { category: "permission_changes", matches: /^(role\.|rbac\.|invitation\.|invite\.|membership\.|mkt_admin\.role|permission\.)/i },
  { category: "admin_actions", matches: /(activate|deactivate|rollback|approve|reject|break_glass|impersonate|delete|purge|bootstrap|kill_switch|freeze)/i },
  { category: "data_access", matches: /(read|list|view|export|download|search|fetch|query)/i },
];
function categorize(action: string | null | undefined): string {
  if (!action) return "other";
  for (const r of CATEGORY_RULES) if (r.matches.test(action)) return r.category;
  return "other";
}
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

const CONTROL_MAP_MD = `# ReconIQ SOC 2 Control Map\n\n| Ref | Requirement | ReconIQ implementation |\n|---|---|---|\n| CC6.1 | Logical access | Supabase Auth + roles + RLS + Cloudflare Access |\n| CC6.6 | Boundary protection | Cloudflare WAF + Bot Management |\n| CC6.7 | Transmission | TLS 1.3, HSTS preload |\n| CC7.2 | System monitoring | SIEM Log Push + anomaly alerts |\n| CC7.3 | Incident response | Runbook §7; 15-min P1 ack |\n| CC7.4 | Recovery | PITR RPO ≤5 min, RTO ≤2 h |\n| CC8.1 | Change management | PR review + migration gate |\n| A1.2  | Availability | 99.95% SLA |\n| C1.1  | Confidentiality | Tenant RLS + BYOK + signed URLs |\n`;
const IR_RUNBOOK_MD = `# ReconIQ Incident Response — abridged\n\nDetect ≤5 min → Triage ≤15 min → Contain ≤60 min → Eradicate ≤4 h → Recover ≤4 h RTO → Learn ≤5 bd.\nTenant notification ≤60 min of confirmed impact. Regulator: DPDP 72 h, GDPR 72 h, SAMA as required.\n`;
const TENANT_ISO_MD = `# ReconIQ Tenant Isolation\n\nIdentity → Data → Storage → Compute → Secrets/BYOK → Telemetry. Every layer scoped by tenant_id with RLS or path prefixes.\n`;

async function isAuthorized(supabase: any, userId: string, tenantId: string | null | undefined): Promise<boolean> {
  const { data: isPlatformAdmin } = await supabase.rpc("has_platform_role", {
    _user_id: userId, _role: "platform_admin",
  });
  if (isPlatformAdmin) return true;
  if (!tenantId) return false;
  const { data: isTenantAdmin } = await supabase.rpc("has_tenant_role", {
    _user_id: userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  return !!isTenantAdmin;
}

export const exportSoc2EvidenceBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().nullable().optional(),
      days: z.number().int().min(1).max(400).default(90),
      limit: z.number().int().min(1).max(50000).default(20000),
      expiry_minutes: z.number().int().min(5).max(120).default(15),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = data.tenant_id ?? null;
    const authorized = await isAuthorized(context.supabase, context.userId, tenantId);
    if (!authorized) {
      throw new Error("Forbidden: SOC 2 evidence bundles require platform_admin or tenant_admin role.");
    }

    const since = new Date(Date.now() - data.days * 86400_000).toISOString();
    let q = context.supabase
      .from("audit_log")
      .select("occurred_at, actor_user_id, actor_email, tenant_id, tenant_slug, scope, action, resource_type, resource_id, context, ip, user_agent")
      .order("occurred_at", { ascending: false })
      .gte("occurred_at", since)
      .limit(data.limit);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const categorized = (rows ?? []).map((r: any) => ({ ...r, soc2_category: categorize(r.action) }));
    const counts: Record<string, number> = {};
    for (const r of categorized) counts[r.soc2_category] = (counts[r.soc2_category] ?? 0) + 1;

    const zip = new JSZip();
    const bundleId = `fvi-soc2-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const root = zip.folder(bundleId)!;
    root.file("MANIFEST.json", JSON.stringify({
      bundle_id: bundleId,
      generated_at: new Date().toISOString(),
      generated_by: context.userId,
      tenant_id: tenantId,
      scope: tenantId ? "tenant" : "platform",
      window_days: data.days,
      window_since: since,
      row_count: categorized.length,
      category_counts: counts,
    }, null, 2));
    root.file("README.md", `# ReconIQ SOC 2 Evidence Bundle\nBundle: ${bundleId}\nWindow: last ${data.days} days\nRows: ${categorized.length}\n`);
    root.file("audit_log_full.csv", toCsv(categorized as any));
    const byCat = root.folder("audit_by_category")!;
    for (const cat of ["authentication", "data_access", "admin_actions", "permission_changes", "other"]) {
      byCat.file(`${cat}.csv`, toCsv(categorized.filter((r) => r.soc2_category === cat) as any));
    }
    const controls = root.folder("controls")!;
    controls.file("soc2_control_map.md", CONTROL_MAP_MD);
    controls.file("tenant_isolation.md", TENANT_ISO_MD);
    root.folder("runbooks")!.file("incident_response.md", IR_RUNBOOK_MD);

    const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const sha = await crypto.subtle.digest("SHA-256", zipBytes.slice().buffer as ArrayBuffer);
    const sha256 = Array.from(new Uint8Array(sha)).map((b) => b.toString(16).padStart(2, "0")).join("");

    // Upload to private storage bucket (admin client — bucket is not public)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const storagePath = `${tenantId ?? "platform"}/${bundleId}.zip`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("soc2-evidence")
      .upload(storagePath, zipBytes, { contentType: "application/zip", upsert: false });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    const expiryMinutes = data.expiry_minutes;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString();
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("soc2-evidence")
      .createSignedUrl(storagePath, expiryMinutes * 60, { download: `${bundleId}.zip` });
    if (signErr || !signed) throw new Error(`Signed URL failed: ${signErr?.message ?? "unknown"}`);

    // Audit + registry
    const auditInsert = await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: tenantId,
      scope: tenantId ? "tenant" : "platform",
      action: "soc2.evidence_bundle.generated",
      resource_type: "soc2_evidence_bundle",
      resource_id: bundleId,
      context: { row_count: categorized.length, counts, window_days: data.days, sha256, expiry_minutes: expiryMinutes },
    } as any).select("id").single();
    const auditId = (auditInsert.data as any)?.id ?? null;

    await context.supabase.from("soc2_evidence_bundles").insert({
      bundle_id: bundleId,
      tenant_id: tenantId,
      scope: tenantId ? "tenant" : "platform",
      requester_user_id: context.userId,
      requester_email: (context.claims as any)?.email ?? null,
      window_days: data.days,
      window_since: since,
      row_count: categorized.length,
      category_counts: counts,
      storage_bucket: "soc2-evidence",
      storage_path: storagePath,
      bytes: zipBytes.byteLength,
      sha256,
      audit_log_id: auditId,
      expires_at: expiresAt,
      download_count: 1,
      last_downloaded_at: new Date().toISOString(),
    } as any);

    return {
      bundle_id: bundleId,
      filename: `${bundleId}.zip`,
      signed_url: signed.signedUrl,
      expires_at: expiresAt,
      row_count: categorized.length,
      counts,
      window_days: data.days,
      window_since: since,
      bytes: zipBytes.byteLength,
      sha256,
    };
  });

export const listSoc2EvidenceBundles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().nullable().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("soc2_evidence_bundles")
      .select("id, bundle_id, tenant_id, scope, requester_user_id, requester_email, window_days, window_since, row_count, category_counts, storage_path, bytes, sha256, audit_log_id, expires_at, download_count, last_downloaded_at, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { bundles: rows ?? [] };
  });

export const regenerateSoc2BundleSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      bundle_id: z.string().min(1),
      expiry_minutes: z.number().int().min(5).max(120).default(15),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS narrows this to bundles the caller may see; enforce authorization additionally.
    const { data: bundle, error } = await context.supabase
      .from("soc2_evidence_bundles")
      .select("id, bundle_id, tenant_id, storage_bucket, storage_path, download_count")
      .eq("bundle_id", data.bundle_id)
      .single();
    if (error || !bundle) throw new Error("Bundle not found or not accessible.");

    const authorized = await isAuthorized(context.supabase, context.userId, (bundle as any).tenant_id);
    if (!authorized) throw new Error("Forbidden.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from((bundle as any).storage_bucket)
      .createSignedUrl((bundle as any).storage_path, data.expiry_minutes * 60, {
        download: `${data.bundle_id}.zip`,
      });
    if (signErr || !signed) throw new Error(`Signed URL failed: ${signErr?.message ?? "unknown"}`);

    const expiresAt = new Date(Date.now() + data.expiry_minutes * 60_000).toISOString();

    await context.supabase.from("soc2_evidence_bundles").update({
      download_count: ((bundle as any).download_count ?? 0) + 1,
      last_downloaded_at: new Date().toISOString(),
      expires_at: expiresAt,
    }).eq("id", (bundle as any).id);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: (bundle as any).tenant_id,
      scope: (bundle as any).tenant_id ? "tenant" : "platform",
      action: "soc2.evidence_bundle.re_downloaded",
      resource_type: "soc2_evidence_bundle",
      resource_id: data.bundle_id,
      context: { expiry_minutes: data.expiry_minutes },
    } as any);

    return { signed_url: signed.signedUrl, expires_at: expiresAt };
  });
