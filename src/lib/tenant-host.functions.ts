import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Parse a Host header into { slug, env }.
 * - jpmc.reconiq.example         → { slug: 'jpmc', env: 'prod' }
 * - jpmc-dev.reconiq.example     → { slug: 'jpmc', env: 'dev' }
 * - jpmc-sandbox.reconiq.example → { slug: 'jpmc', env: 'sandbox' }
 * - app.reconiq.example          → { slug: null,   env: 'platform' }
 * - localhost / preview hosts      → { slug: null,   env: 'platform' }
 */
export type TenantEnv = "prod" | "dev" | "sandbox" | "uat";
export type HostKind  = "tenant" | "platform" | "marketing" | "unknown";

export interface HostInfo {
  host: string;
  kind: HostKind;
  slug: string | null;
  env: TenantEnv | "platform" | "marketing" | null;
}

const APEX = "reconiq.example";
const ENV_SUFFIXES: Record<string, TenantEnv> = {
  "-dev": "dev", "-sandbox": "sandbox", "-uat": "uat",
};

export function parseHost(rawHost: string): HostInfo {
  const host = (rawHost || "").toLowerCase().split(":")[0];
  if (!host) return { host, kind: "unknown", slug: null, env: null };

  if (host === "localhost" || host.endsWith(".meta.app") || host.endsWith(".localhost")) {
    return { host, kind: "platform", slug: null, env: "platform" };
  }
  if (host === APEX || host === `www.${APEX}`) {
    return { host, kind: "marketing", slug: null, env: "marketing" };
  }
  if (!host.endsWith(`.${APEX}`)) {
    return { host, kind: "unknown", slug: null, env: null };
  }

  const label = host.slice(0, host.length - APEX.length - 1); // strip ".reconiq.example"
  if (label === "app") return { host, kind: "platform", slug: null, env: "platform" };

  // detect env suffix
  for (const [suf, env] of Object.entries(ENV_SUFFIXES)) {
    if (label.endsWith(suf)) {
      const slug = label.slice(0, label.length - suf.length);
      return { host, kind: "tenant", slug, env };
    }
  }
  return { host, kind: "tenant", slug: label, env: "prod" };
}

/** Server-side host resolution against tenant_environments. */
export const resolveHost = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ host: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const parsed = parseHost(data.host);
    if (parsed.kind !== "tenant" || !parsed.slug) return { parsed, resolved: null };

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: rows } = await sb.rpc("resolve_tenant_from_host", { _host: data.host });
    const row = (rows ?? [])[0] ?? null;
    return { parsed, resolved: row };
  });

/** Tenant-scoped environment list for the Domains UI. */
export const listTenantEnvironments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_environments")
      .select("id,env,host,is_active,tls_status,health_status,last_health_check_at,created_at")
      .eq("tenant_id", data.tenant_id).order("env");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Validate a slug against reserved list + format rules without inserting. */
export const validateSlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ slug: z.string().min(2).max(63) }).parse(d))
  .handler(async ({ data, context }) => {
    const slug = data.slug.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
      return { ok: false, reason: "Must be 2-63 lowercase letters/digits/hyphens, no leading/trailing hyphen" };
    }
    for (const suf of ["-dev","-sandbox","-uat","-staging"]) {
      if (slug.endsWith(suf)) return { ok: false, reason: `Slug cannot end with ${suf}` };
    }
    const { data: reserved } = await context.supabase
      .from("reserved_slugs").select("slug").eq("slug", slug).maybeSingle();
    if (reserved) return { ok: false, reason: "Slug is reserved" };
    const { data: existing } = await context.supabase
      .from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (existing) return { ok: false, reason: "Slug already taken" };
    return {
      ok: true,
      preview: {
        prod: `${slug}.reconiq.example`,
        dev: `${slug}-dev.reconiq.example`,
        sandbox: `${slug}-sandbox.reconiq.example`,
        uat: `${slug}-uat.reconiq.example`,
      },
    };
  });

// =========================================================================
// Custom Domains (BYO) — admin CRUD + DNS verification
// =========================================================================

const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function normalizeHost(h: string): string {
  return h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
}

export const validateCustomDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ host: z.string().min(4).max(253) }).parse(d))
  .handler(async ({ data }) => {
    const host = normalizeHost(data.host);
    if (!HOST_RE.test(host)) return { ok: false as const, reason: "Invalid hostname format" };
    if (host.endsWith(".reconiq.example") || host === "reconiq.example") {
      return { ok: false as const, reason: "ReconIQ hosts are reserved; use the auto-provisioned subdomain instead" };
    }
    return { ok: true as const, host };
  });

export const listCustomDomains = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_custom_domains")
      .select("id,env,host,verification_status,verified_at,tls_status,health_status,verification_token,last_verification_check_at,last_health_check_at,created_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addCustomDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    host: z.string().min(4).max(253),
    env: z.enum(["prod","dev","sandbox","uat"]).default("prod"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const host = normalizeHost(data.host);
    if (!HOST_RE.test(host)) throw new Error("Invalid hostname format");
    if (host.endsWith(".reconiq.example") || host === "reconiq.example") {
      throw new Error("ReconIQ hosts are reserved");
    }
    const { data: row, error } = await context.supabase
      .from("tenant_custom_domains")
      .insert({ tenant_id: data.tenant_id, host, env: data.env, added_by: context.userId })
      .select("id,env,host,verification_status,verification_token,tls_status")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new Error(`Host ${host} is already registered`);
      throw new Error(error.message);
    }
    return row;
  });

export const removeCustomDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tenant_custom_domains").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Verifies a custom domain via TXT record at `_fvi-verify.<host>`.
 * Optionally records CNAME pointing to `app.reconiq.example` (informational).
 * Result is persisted via `mark_custom_domain_verified`.
 */
export const verifyCustomDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tenant_custom_domains")
      .select("id,host,verification_token,tenant_id")
      .eq("id", data.id).single();
    if (error || !row) throw new Error("Custom domain not found");

    const dns = await import("node:dns/promises");
    const txtName = `_fvi-verify.${row.host}`;
    let txtOk = false;
    let cnameOk = false;
    const diagnostics: { txt: string[]; cname: string[]; error?: string } = { txt: [], cname: [] };

    try {
      const records = await dns.resolveTxt(txtName);
      diagnostics.txt = records.map((r) => r.join(""));
      txtOk = diagnostics.txt.some((v) => v.trim() === row.verification_token);
    } catch (e) {
      diagnostics.error = `TXT lookup failed: ${(e as Error).message}`;
    }

    try {
      const cnames = await dns.resolveCname(row.host);
      diagnostics.cname = cnames;
      cnameOk = cnames.some((c) => c.toLowerCase().endsWith("reconiq.example"));
    } catch {
      // CNAME is optional at verification time
    }

    const verified = txtOk;
    const { data: updated, error: rpcErr } = await context.supabase
      .rpc("mark_custom_domain_verified", { _id: row.id, _verified: verified });
    if (rpcErr) throw new Error(rpcErr.message);

    return { verified, txtOk, cnameOk, diagnostics, domain: updated };
  });
