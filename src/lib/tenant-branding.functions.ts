import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const HEX = /^#[0-9a-fA-F]{6}$/;

export type TenantBranding = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  logo_url: string | null;
  primary_hex: string;
  accent_hex: string;
  surface_hex: string;
  ink_hex: string;
  headline: string | null;
  tagline: string | null;
  support_email: string | null;
  support_url: string | null;
  enabled: boolean;
};

/**
 * Public: fetches published (enabled=true) branding for the /t/{slug}/auth page.
 * Returns null when slug is unknown or branding is not enabled — caller
 * should fall back to the FVI-locked palette to avoid slug enumeration.
 */
export const getTenantBrandingBySlug = createServerFn({ method: "GET" })
  .validator((d: { slug: string }) =>
    z.object({ slug: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i) }).parse(d),
  )
  .handler(async ({ data }): Promise<TenantBranding | null> => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined as never },
    });
    const { data: tRows } = await sb
      .from("tenants")
      .select("id,name,slug")
      .eq("slug", data.slug.toLowerCase())
      .limit(1);
    const t = tRows?.[0];
    if (!t) return null;
    const { data: bRows } = await sb
      .from("tenant_branding")
      .select(
        "logo_url, primary_hex, accent_hex, surface_hex, ink_hex, headline, tagline, support_email, support_url, enabled",
      )
      .eq("tenant_id", t.id)
      .eq("enabled", true)
      .limit(1);
    const b = bRows?.[0];
    if (!b) return null;
    return {
      tenant_id: t.id,
      tenant_name: t.name,
      tenant_slug: t.slug,
      logo_url: b.logo_url ?? null,
      primary_hex: b.primary_hex,
      accent_hex: b.accent_hex,
      surface_hex: b.surface_hex,
      ink_hex: b.ink_hex,
      headline: b.headline ?? null,
      tagline: b.tagline ?? null,
      support_email: b.support_email ?? null,
      support_url: b.support_url ?? null,
      enabled: b.enabled,
    };
  });

/** Admin: read current branding (any state) for editing. */
export const getTenantBranding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => z.object({ tenantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("tenant_branding")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .limit(1);
    return rows?.[0] ?? null;
  });

export const upsertTenantBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: {
    tenantId: string;
    logo_url?: string | null;
    primary_hex: string;
    accent_hex: string;
    surface_hex: string;
    ink_hex: string;
    headline?: string | null;
    tagline?: string | null;
    support_email?: string | null;
    support_url?: string | null;
    enabled: boolean;
  }) =>
    z
      .object({
        tenantId: z.string().uuid(),
        logo_url: z.string().max(200_000).nullable().optional(),
        primary_hex: z.string().regex(HEX),
        accent_hex: z.string().regex(HEX),
        surface_hex: z.string().regex(HEX),
        ink_hex: z.string().regex(HEX),
        headline: z.string().max(120).nullable().optional(),
        tagline: z.string().max(280).nullable().optional(),
        support_email: z.string().email().max(200).nullable().optional(),
        support_url: z.string().url().max(500).nullable().optional(),
        enabled: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = {
      tenant_id: data.tenantId,
      logo_url: data.logo_url ?? null,
      primary_hex: data.primary_hex,
      accent_hex: data.accent_hex,
      surface_hex: data.surface_hex,
      ink_hex: data.ink_hex,
      headline: data.headline ?? null,
      tagline: data.tagline ?? null,
      support_email: data.support_email ?? null,
      support_url: data.support_url ?? null,
      enabled: data.enabled,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("tenant_branding")
      .upsert(row as never, { onConflict: "tenant_id" });
    if (error) throw new Response(error.message, { status: 500 });
    return { ok: true };
  });
