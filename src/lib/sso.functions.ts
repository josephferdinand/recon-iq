import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHash } from "node:crypto";
import { requirePrivilegedAction } from "@/lib/step-up.server";

// ---------- helpers ----------

async function assertAdmin(ctx: any, tenantId: string) {
  const { data } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  if (!data) {
    const { data: pa } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
    if (!pa) throw new Error("Forbidden: tenant_admin required");
  }
}

type SamlSummary = {
  entity_id: string | null;
  acs_url: string | null;
  sso_url: string | null;
  signing_cert: string | null;
  signing_cert_fingerprint: string | null;
  signing_cert_not_before: string | null;
  signing_cert_not_after: string | null;
};

/**
 * Very small SAML 2.0 metadata parser — extracts EntityID, ACS URL, SSO URL,
 * and the first IDPSSODescriptor signing X509Certificate.  We stay dependency
 * free so the Cloudflare Worker runtime doesn't need Node-only XML libs.
 */
function parseSamlMetadata(xml: string): SamlSummary {
  const entity = /<(?:md:)?EntityDescriptor[^>]*\sentityID=["']([^"']+)["']/i.exec(xml)?.[1] ?? null;
  const acs = /<(?:md:)?AssertionConsumerService[^>]*\sLocation=["']([^"']+)["']/i.exec(xml)?.[1] ?? null;
  const sso = /<(?:md:)?SingleSignOnService[^>]*\sLocation=["']([^"']+)["']/i.exec(xml)?.[1] ?? null;

  // Prefer signing key descriptors; fall back to the first cert.
  const idpBlock = /<(?:md:)?IDPSSODescriptor[\s\S]*?<\/(?:md:)?IDPSSODescriptor>/i.exec(xml)?.[0] ?? xml;
  const signingBlock =
    /<(?:md:)?KeyDescriptor[^>]*use=["']signing["'][\s\S]*?<\/(?:md:)?KeyDescriptor>/i.exec(idpBlock)?.[0]
    ?? /<(?:md:)?KeyDescriptor[\s\S]*?<\/(?:md:)?KeyDescriptor>/i.exec(idpBlock)?.[0]
    ?? idpBlock;
  const certRaw = /<(?:ds:)?X509Certificate>([\s\S]*?)<\/(?:ds:)?X509Certificate>/i
    .exec(signingBlock)?.[1]?.replace(/\s+/g, "") ?? null;

  let fp: string | null = null;
  let notBefore: string | null = null;
  let notAfter: string | null = null;

  if (certRaw) {
    try {
      const der = Uint8Array.from(atob(certRaw), (c) => c.charCodeAt(0));
      fp = createHash("sha256").update(der).digest("hex").match(/.{2}/g)!.join(":").toUpperCase();
      const range = extractValidityRange(der);
      notBefore = range.notBefore;
      notAfter = range.notAfter;
    } catch {
      /* leave fingerprint / validity null; UI shows "unknown" */
    }
  }

  return {
    entity_id: entity,
    acs_url: acs,
    sso_url: sso,
    signing_cert: certRaw ? formatPem(certRaw) : null,
    signing_cert_fingerprint: fp,
    signing_cert_not_before: notBefore,
    signing_cert_not_after: notAfter,
  };
}

function formatPem(base64: string): string {
  const wrapped = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----`;
}

/**
 * Extract the notBefore / notAfter validity dates from a DER-encoded X.509
 * certificate.  Best-effort tiny ASN.1 walker — good enough to show expiry
 * warnings; falls back to null when the cert layout is unusual.
 */
function extractValidityRange(der: Uint8Array): { notBefore: string | null; notAfter: string | null } {
  try {
    const view = der;
    // SEQUENCE (cert) → SEQUENCE (tbs) → [0] version? → INTEGER serial → SEQUENCE sigAlg → SEQUENCE issuer → SEQUENCE validity → …
    let i = 0;
    function readLen(idx: number): { len: number; header: number } {
      const first = view[idx];
      if ((first & 0x80) === 0) return { len: first, header: 1 };
      const n = first & 0x7f;
      let len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | view[idx + 1 + k];
      return { len, header: 1 + n };
    }
    // outer cert SEQUENCE
    if (view[i++] !== 0x30) return { notBefore: null, notAfter: null };
    i += readLen(i).header;
    // tbsCertificate SEQUENCE
    if (view[i++] !== 0x30) return { notBefore: null, notAfter: null };
    i += readLen(i).header;
    // optional [0] version
    if (view[i] === 0xa0) { i++; const l = readLen(i); i += l.header + l.len; }
    // serialNumber INTEGER
    if (view[i++] !== 0x02) return { notBefore: null, notAfter: null };
    { const l = readLen(i); i += l.header + l.len; }
    // signature SEQUENCE
    if (view[i++] !== 0x30) return { notBefore: null, notAfter: null };
    { const l = readLen(i); i += l.header + l.len; }
    // issuer SEQUENCE
    if (view[i++] !== 0x30) return { notBefore: null, notAfter: null };
    { const l = readLen(i); i += l.header + l.len; }
    // validity SEQUENCE
    if (view[i++] !== 0x30) return { notBefore: null, notAfter: null };
    { const l = readLen(i); i += l.header; }
    const readTime = (): string | null => {
      const tag = view[i++];
      const l = readLen(i); i += l.header;
      const bytes = view.slice(i, i + l.len); i += l.len;
      const text = new TextDecoder().decode(bytes);
      // UTCTime yyMMddHHmmssZ; GeneralizedTime yyyyMMddHHmmssZ
      if (tag === 0x17 && text.length >= 12) {
        const yy = parseInt(text.slice(0, 2), 10);
        const year = yy >= 50 ? 1900 + yy : 2000 + yy;
        return `${year}-${text.slice(2, 4)}-${text.slice(4, 6)}T${text.slice(6, 8)}:${text.slice(8, 10)}:${text.slice(10, 12)}Z`;
      }
      if (tag === 0x18 && text.length >= 14) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}Z`;
      }
      return null;
    };
    const notBefore = readTime();
    const notAfter = readTime();
    return { notBefore, notAfter };
  } catch {
    return { notBefore: null, notAfter: null };
  }
}

async function fetchMetadataXml(url: string): Promise<string> {
  const { safeFetch } = await import("@/lib/ssrf-guard.server");
  const r = await safeFetch(url, { method: "GET", headers: { Accept: "application/samlmetadata+xml, application/xml, text/xml, */*" } });
  if (!r.ok) throw new Error(`metadata HTTP ${r.status}`);
  const text = await r.text();
  if (!text.includes("EntityDescriptor")) throw new Error("response is not SAML metadata (missing EntityDescriptor)");
  return text;
}

// ---------- server fns ----------

export const listSsoConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { data: rows, error } = await context.supabase
      .from("tenant_sso_configs").select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const UpsertInput = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  provider_type: z.enum(["saml", "oidc"]),
  display_name: z.string().min(1).max(120),
  metadata_url: z.string().url().max(500).optional().nullable(),
  entity_id: z.string().max(500).optional().nullable(),
  acs_url: z.string().max(500).optional().nullable(),
  client_id: z.string().max(500).optional().nullable(),
  issuer_url: z.string().url().max(500).optional().nullable(),
  email_domains: z.array(z.string().min(1).max(253)).max(20).default([]),
  enabled: z.boolean().default(false),
  jit_provisioning: z.boolean().optional(),
  default_role: z.string().max(60).optional().nullable(),
  // ── generic OIDC provider fields ─────────────────────────────────────────
  discovery_url: z.string().url().max(500).optional().nullable(),
  authorization_endpoint: z.string().url().max(500).optional().nullable(),
  token_endpoint: z.string().url().max(500).optional().nullable(),
  userinfo_endpoint: z.string().url().max(500).optional().nullable(),
  jwks_uri: z.string().url().max(500).optional().nullable(),
  end_session_endpoint: z.string().url().max(500).optional().nullable(),
  scopes: z.array(z.string().min(1).max(64)).max(24).optional(),
  redirect_uris: z.array(z.string().url().max(500)).max(10).optional(),
  response_type: z.enum(["code", "code id_token", "id_token"]).optional(),
  pkce_enabled: z.boolean().optional(),
  // Plaintext client secret — only sent when the admin sets/rotates it. We
  // encrypt with the shared KMS-wrapped vault and never return the value.
  client_secret: z.string().min(1).max(2000).optional().nullable(),
});

export const upsertSsoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => UpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    await requirePrivilegedAction(context, "sso.write", {
      tenantId: data.tenant_id,
      resourceType: "tenant_sso_configs",
      resourceId: data.id ?? null,
      payload: { provider_type: data.provider_type, enabled: data.enabled, domains: data.email_domains },
    });
    const { client_secret, ...rest } = data;
    const payload: any = { ...rest, updated_at: new Date().toISOString() };
    if (typeof client_secret === "string" && client_secret.length > 0) {
      const { encryptSecret, bytesToBase64 } = await import("@/lib/vault.server");
      const enc = await encryptSecret(client_secret);
      payload.client_secret_enc = JSON.stringify({
        v: 1,
        ct: bytesToBase64(enc.ciphertext),
        iv: bytesToBase64(enc.iv),
        tag: bytesToBase64(enc.auth_tag),
        wrapped: bytesToBase64(enc.wrapped_dek),
        provider: enc.kek_provider,
        ref: enc.kek_ref,
      });
      payload.client_secret_last4 = enc.last4;
    } else if (client_secret === null) {
      payload.client_secret_enc = null;
      payload.client_secret_last4 = null;
    }
    const { data: row, error } = data.id
      ? await context.supabase.from("tenant_sso_configs").update(payload).eq("id", data.id).select().single()
      : await context.supabase.from("tenant_sso_configs").insert(payload).select().single();
    if (error) throw new Error(error.message);
    // Never leak the encrypted blob to the client.
    if (row && "client_secret_enc" in row) delete (row as any).client_secret_enc;
    return row;
  });

/**
 * Fetch the OIDC discovery document (.well-known/openid-configuration) from a
 * generic OIDC issuer and populate authorization / token / userinfo / jwks
 * endpoints on the config row.  Works with Okta, Auth0, Keycloak, Azure AD,
 * PingOne, Cognito, Ory Hydra, ForgeRock, or any spec-compliant provider.
 */
export const importOidcDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      tenant_id: z.string().uuid(),
      discovery_url: z.string().url().max(500).optional().nullable(),
      issuer_url: z.string().url().max(500).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    await requirePrivilegedAction(context, "sso.write", {
      tenantId: data.tenant_id, resourceType: "tenant_sso_configs", resourceId: data.id,
      payload: { action: "import_oidc_discovery" },
    });
    const url = data.discovery_url?.trim()
      || (data.issuer_url ? data.issuer_url.replace(/\/$/, "") + "/.well-known/openid-configuration" : "");
    if (!url) throw new Error("Provide either discovery_url or issuer_url");
    const { safeFetch } = await import("@/lib/ssrf-guard.server");
    const r = await safeFetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`OIDC discovery HTTP ${r.status}`);
    const doc = await r.json() as Record<string, any>;
    if (!doc.issuer) throw new Error("Response is not an OIDC discovery document (missing 'issuer')");
    const patch: any = {
      discovery_url: url,
      discovery_fetched_at: new Date().toISOString(),
      issuer_url: doc.issuer,
      authorization_endpoint: doc.authorization_endpoint ?? null,
      token_endpoint: doc.token_endpoint ?? null,
      userinfo_endpoint: doc.userinfo_endpoint ?? null,
      jwks_uri: doc.jwks_uri ?? null,
      end_session_endpoint: doc.end_session_endpoint ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data: row, error } = await context.supabase
      .from("tenant_sso_configs").update(patch).eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    if (row && "client_secret_enc" in row) delete (row as any).client_secret_enc;
    return {
      row,
      discovered: {
        issuer: doc.issuer,
        authorization_endpoint: doc.authorization_endpoint,
        token_endpoint: doc.token_endpoint,
        userinfo_endpoint: doc.userinfo_endpoint,
        jwks_uri: doc.jwks_uri,
        scopes_supported: doc.scopes_supported ?? [],
        response_types_supported: doc.response_types_supported ?? [],
      },
    };
  });

export const deleteSsoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    await requirePrivilegedAction(context, "sso.write", {
      tenantId: data.tenant_id, resourceType: "tenant_sso_configs", resourceId: data.id,
      payload: { deleted: true },
    });
    const { error } = await context.supabase.from("tenant_sso_configs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Quick per-tenant enable / disable switch — no full form round-trip. */
export const setSsoEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    await requirePrivilegedAction(context, "sso.write", {
      tenantId: data.tenant_id, resourceType: "tenant_sso_configs", resourceId: data.id,
      payload: { enabled: data.enabled },
    });
    const { error } = await context.supabase
      .from("tenant_sso_configs")
      .update({ enabled: data.enabled, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, enabled: data.enabled };
  });

/**
 * Import SAML metadata from either a pasted XML blob or a URL, extract
 * EntityID / ACS URL / signing cert, and stage the new cert as the current
 * one (moving any existing cert into `previous_signing_cert` for rollback).
 */
export const importSamlMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      tenant_id: z.string().uuid(),
      source: z.enum(["url", "xml"]),
      metadata_url: z.string().url().max(500).optional().nullable(),
      metadata_xml: z.string().max(2_000_000).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    await requirePrivilegedAction(context, "sso.write", {
      tenantId: data.tenant_id, resourceType: "tenant_sso_configs", resourceId: data.id,
      payload: { action: "import_metadata", source: data.source },
    });

    const xml = data.source === "url"
      ? await fetchMetadataXml(data.metadata_url ?? "")
      : (data.metadata_xml ?? "");
    if (!xml.includes("EntityDescriptor")) throw new Error("XML is not SAML 2.0 metadata");

    const parsed = parseSamlMetadata(xml);

    const { data: existing } = await context.supabase
      .from("tenant_sso_configs").select("signing_cert, signing_cert_fingerprint")
      .eq("id", data.id).maybeSingle();

    const patch: any = {
      metadata_xml: xml,
      metadata_source: data.source,
      metadata_url: data.source === "url" ? data.metadata_url : null,
      metadata_fetched_at: new Date().toISOString(),
      entity_id: parsed.entity_id,
      acs_url: parsed.acs_url,
      updated_at: new Date().toISOString(),
    };
    // Cert rotation: only touch if the new cert differs from the current one.
    let rotated = false;
    if (parsed.signing_cert && parsed.signing_cert_fingerprint
        && parsed.signing_cert_fingerprint !== existing?.signing_cert_fingerprint) {
      patch.previous_signing_cert = existing?.signing_cert ?? null;
      patch.previous_signing_cert_fingerprint = existing?.signing_cert_fingerprint ?? null;
      patch.signing_cert = parsed.signing_cert;
      patch.signing_cert_fingerprint = parsed.signing_cert_fingerprint;
      patch.signing_cert_not_before = parsed.signing_cert_not_before;
      patch.signing_cert_not_after = parsed.signing_cert_not_after;
      patch.cert_rotated_at = new Date().toISOString();
      patch.cert_rotated_by = context.userId;
      rotated = true;
    }

    const { data: row, error } = await context.supabase
      .from("tenant_sso_configs").update(patch).eq("id", data.id).select().single();
    if (error) throw new Error(error.message);

    if (rotated) {
      await context.supabase.from("tenant_sso_cert_history").insert({
        sso_config_id: data.id,
        tenant_id: data.tenant_id,
        cert: parsed.signing_cert,
        fingerprint: parsed.signing_cert_fingerprint,
        not_before: parsed.signing_cert_not_before,
        not_after: parsed.signing_cert_not_after,
        rotated_by: context.userId,
        source: data.source === "url" ? "metadata_url" : "metadata_xml",
        note: "Imported from SAML metadata",
      } as never);
    }
    return { row, parsed, rotated };
  });

/**
 * Rotate the signing certificate by pasting a PEM/base64 X.509 directly —
 * used when the IdP publishes a new cert out-of-band before rotating metadata.
 */
export const rotateSsoCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      tenant_id: z.string().uuid(),
      cert_pem: z.string().min(40).max(20_000),
      note: z.string().max(500).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    await requirePrivilegedAction(context, "sso.write", {
      tenantId: data.tenant_id, resourceType: "tenant_sso_configs", resourceId: data.id,
      payload: { action: "rotate_certificate" },
    });

    const b64 = data.cert_pem
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");
    let der: Uint8Array;
    try { der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
    catch { throw new Error("Certificate must be PEM or base64-encoded X.509"); }
    if (der.length < 100) throw new Error("Certificate looks too short to be valid");

    const fingerprint = createHash("sha256").update(der).digest("hex").match(/.{2}/g)!.join(":").toUpperCase();
    const validity = extractValidityRange(der);
    const pem = formatPem(b64);

    const { data: existing } = await context.supabase
      .from("tenant_sso_configs").select("signing_cert, signing_cert_fingerprint")
      .eq("id", data.id).maybeSingle();

    const { error } = await context.supabase
      .from("tenant_sso_configs")
      .update({
        previous_signing_cert: existing?.signing_cert ?? null,
        previous_signing_cert_fingerprint: existing?.signing_cert_fingerprint ?? null,
        signing_cert: pem,
        signing_cert_fingerprint: fingerprint,
        signing_cert_not_before: validity.notBefore,
        signing_cert_not_after: validity.notAfter,
        cert_rotated_at: new Date().toISOString(),
        cert_rotated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await context.supabase.from("tenant_sso_cert_history").insert({
      sso_config_id: data.id,
      tenant_id: data.tenant_id,
      cert: pem,
      fingerprint,
      not_before: validity.notBefore,
      not_after: validity.notAfter,
      rotated_by: context.userId,
      source: "manual_paste",
      note: data.note ?? null,
    } as never);

    return { fingerprint, not_before: validity.notBefore, not_after: validity.notAfter };
  });

/** Roll back the last cert rotation (swap current ↔ previous). */
export const rollbackSsoCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    await requirePrivilegedAction(context, "sso.write", {
      tenantId: data.tenant_id, resourceType: "tenant_sso_configs", resourceId: data.id,
      payload: { action: "rollback_certificate" },
    });
    const { data: cfg } = await context.supabase.from("tenant_sso_configs")
      .select("signing_cert, signing_cert_fingerprint, previous_signing_cert, previous_signing_cert_fingerprint")
      .eq("id", data.id).maybeSingle();
    if (!cfg?.previous_signing_cert) throw new Error("No previous certificate to roll back to");

    const { error } = await context.supabase.from("tenant_sso_configs")
      .update({
        signing_cert: cfg.previous_signing_cert,
        signing_cert_fingerprint: cfg.previous_signing_cert_fingerprint,
        previous_signing_cert: cfg.signing_cert,
        previous_signing_cert_fingerprint: cfg.signing_cert_fingerprint,
        cert_rotated_at: new Date().toISOString(),
        cert_rotated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, fingerprint: cfg.previous_signing_cert_fingerprint };
  });

export const listSsoCertHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ sso_config_id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { data: rows, error } = await context.supabase
      .from("tenant_sso_cert_history")
      .select("id, fingerprint, not_before, not_after, rotated_at, rotated_by, source, note")
      .eq("sso_config_id", data.sso_config_id)
      .order("rotated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const testSsoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { data: cfg, error } = await context.supabase.from("tenant_sso_configs")
      .select("*").eq("id", data.id).single();
    if (error || !cfg) throw new Error(error?.message ?? "Not found");
    let status = "ok"; let detail = "";
    try {
      if (cfg.provider_type === "saml") {
        if (cfg.metadata_url) {
          await fetchMetadataXml(cfg.metadata_url);
        } else if (!cfg.metadata_xml && !cfg.entity_id) {
          status = "fail"; detail = "no metadata URL or XML uploaded";
        }
        // Certificate freshness check.
        if (cfg.signing_cert_not_after) {
          const daysLeft = (new Date(cfg.signing_cert_not_after).getTime() - Date.now()) / 86_400_000;
          if (daysLeft < 0) { status = "fail"; detail = "signing certificate has EXPIRED"; }
          else if (daysLeft < 30) { status = "warn"; detail = `signing certificate expires in ${Math.round(daysLeft)} days`; }
        }
      } else if (cfg.provider_type === "oidc" && cfg.issuer_url) {
        const { safeFetch } = await import("@/lib/ssrf-guard.server");
        const r = await safeFetch(cfg.issuer_url.replace(/\/$/, "") + "/.well-known/openid-configuration");
        if (!r.ok) { status = "fail"; detail = `discovery HTTP ${r.status}`; }
      } else {
        status = "fail"; detail = "missing required URL";
      }
    } catch (e: any) { status = "fail"; detail = e.message ?? "fetch error"; }
    await context.supabase.from("tenant_sso_configs").update({
      last_tested_at: new Date().toISOString(),
      last_status: status === "ok" ? "verified" : `${status}: ${detail}`,
    }).eq("id", data.id);
    return { status, detail };
  });
