/**
 * Brand Management — dynamic branding for platform + tenants.
 *
 * All admin surfaces (Market Admin > Brand Management) call these fns.
 * Public consumers (root layout, landing page, login) read the ACTIVE
 * published profile via `getPublishedBrand`, which is guarded by RLS
 * (public read only when is_active=true AND status='published').
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// ---------- Types ----------
export type BrandProfile = {
  id: string;
  is_active: boolean;
  company_name: string | null;
  trading_name: string | null;
  brand_name: string | null;
  short_name: string | null;
  platform_name: string | null;
  product_name: string | null;
  product_suite_name: string | null;
  tagline: string | null;
  motto: string | null;
  mission_statement: string | null;
  vision_statement: string | null;
  website_url: string | null;
  support_url: string | null;
  help_center_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: Record<string, string>;
  browser_tab_name: string | null;
  page_title_template: string | null;
  application_name: string | null;
  header_branding: string | null;
  footer_branding: string | null;
  copyright_text: string | null;
  legal_notices: string | null;
  powered_by_text: string | null;
  show_version: boolean;
  login_welcome_message: string | null;
  login_background_url: string | null;
  login_page_theme: string | null;
  password_reset_message: string | null;
  registration_message: string | null;
  email_signature_html: string | null;
  email_legal_disclaimer: string | null;
  email_footer_text: string | null;
  version: number;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  updated_at: string;
};

export type BrandAsset = {
  id: string;
  slot: BrandAssetSlot;
  variant: string | null;
  storage_path: string;
  public_url: string;
  content_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  is_published: boolean;
  version: number;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BrandAssetSlot =
  | "primary_logo" | "secondary_logo" | "dark_logo" | "light_logo"
  | "login_logo" | "mobile_logo" | "favicon" | "email_header_logo"
  | "email_footer_logo" | "document_watermark" | "partner_logo" | "white_label_logo";

const ASSET_SLOT = z.enum([
  "primary_logo","secondary_logo","dark_logo","light_logo",
  "login_logo","mobile_logo","favicon","email_header_logo",
  "email_footer_logo","document_watermark","partner_logo","white_label_logo",
]);

// ---------- Authorization ----------
async function assertPlatformAdmin(ctx: { supabase: any; userId: string }): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  if (error || !data) throw new Response("Forbidden — platform_admin required", { status: 403 });
}

async function logHistory(
  ctx: { supabase: any; userId: string; claims?: { email?: string } },
  entity: "profile" | "asset" | "identity" | "communications" | "login" | "white_label",
  action: "create" | "update" | "publish" | "rollback" | "delete" | "upload",
  entityId: string | null,
  before: unknown,
  after: unknown,
  notes?: string,
): Promise<void> {
  try {
    await ctx.supabase.from("mkt_brand_history").insert({
      entity, action, entity_id: entityId,
      actor_user_id: ctx.userId,
      actor_email: ctx.claims?.email ?? null,
      before_snapshot: (before ?? null) as never,
      after_snapshot: (after ?? null) as never,
      notes: notes ?? null,
    } as never);
  } catch { /* audit best-effort */ }
}

// ---------- Public: get active published brand ----------
/** Public read of the active published brand profile (used by landing page, login,
 *  root <head/>). Runs unauthenticated via the server publishable client — RLS
 *  restricts SELECT to is_active=true AND status='published'. */
export const getPublishedBrand = createServerFn({ method: "GET" })
  .handler(async () => {
    const sb = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const [profileRes, assetsRes] = await Promise.all([
      sb.from("mkt_brand_profile").select("*").eq("is_active", true).eq("status","published").maybeSingle(),
      sb.from("mkt_brand_assets").select("slot,public_url,width,height,content_type,version,updated_at").eq("is_published", true),
    ]);
    const assetsBySlot: Record<string, { url: string; width: number | null; height: number | null; content_type: string | null; version: number; updated_at: string }> = {};
    for (const row of (assetsRes.data ?? []) as Array<{ slot: string; public_url: string; width: number|null; height: number|null; content_type: string|null; version: number; updated_at: string }>) {
      assetsBySlot[row.slot] = { url: row.public_url, width: row.width, height: row.height, content_type: row.content_type, version: row.version, updated_at: row.updated_at };
    }
    return { profile: (profileRes.data as BrandProfile | null) ?? null, assets: assetsBySlot };
  });

// ---------- Admin: brand profile ----------
export const getBrandProfileAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await context.supabase
      .from("mkt_brand_profile").select("*").eq("is_active", true).maybeSingle();
    if (error) throw new Error(error.message);
    return data as BrandProfile | null;
  });

const profileSchema = z.object({
  id: z.string().uuid(),
  company_name: z.string().max(200).nullish(),
  trading_name: z.string().max(200).nullish(),
  brand_name: z.string().max(200).nullish(),
  short_name: z.string().max(60).nullish(),
  platform_name: z.string().max(200).nullish(),
  product_name: z.string().max(200).nullish(),
  product_suite_name: z.string().max(200).nullish(),
  tagline: z.string().max(500).nullish(),
  motto: z.string().max(500).nullish(),
  mission_statement: z.string().max(4000).nullish(),
  vision_statement: z.string().max(4000).nullish(),
  website_url: z.string().url().max(500).nullish().or(z.literal("")),
  support_url: z.string().url().max(500).nullish().or(z.literal("")),
  help_center_url: z.string().url().max(500).nullish().or(z.literal("")),
  contact_email: z.string().email().max(320).nullish().or(z.literal("")),
  contact_phone: z.string().max(60).nullish(),
  social_links: z.record(z.string(), z.string()).default({}),
  browser_tab_name: z.string().max(200).nullish(),
  page_title_template: z.string().max(200).nullish(),
  application_name: z.string().max(200).nullish(),
  header_branding: z.string().max(500).nullish(),
  footer_branding: z.string().max(500).nullish(),
  copyright_text: z.string().max(500).nullish(),
  legal_notices: z.string().max(4000).nullish(),
  powered_by_text: z.string().max(200).nullish(),
  show_version: z.boolean().default(false),
  login_welcome_message: z.string().max(1000).nullish(),
  login_background_url: z.string().url().max(1000).nullish().or(z.literal("")),
  login_page_theme: z.string().max(60).nullish(),
  password_reset_message: z.string().max(1000).nullish(),
  registration_message: z.string().max(1000).nullish(),
  email_signature_html: z.string().max(4000).nullish(),
  email_legal_disclaimer: z.string().max(4000).nullish(),
  email_footer_text: z.string().max(2000).nullish(),
});

export const updateBrandProfileAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => profileSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { id, ...patch } = data;
    // Normalise empty strings -> null so URL/email validation stays clean.
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) clean[k] = v === "" ? null : v;
    clean.updated_by = context.userId;
    const { data: before } = await context.supabase.from("mkt_brand_profile").select("*").eq("id", id).maybeSingle();
    const { data: row, error } = await context.supabase
      .from("mkt_brand_profile").update(clean as never).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    await logHistory(context, "profile", "update", id, before, row);
    return row as BrandProfile;
  });

export const publishBrandProfileAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: before } = await context.supabase.from("mkt_brand_profile").select("*").eq("id", data.id).maybeSingle();
    const nextVersion = ((before as { version?: number } | null)?.version ?? 1) + 1;
    const { data: row, error } = await context.supabase
      .from("mkt_brand_profile")
      .update({ status: "published", published_at: new Date().toISOString(), published_by: context.userId, version: nextVersion } as never)
      .eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    await logHistory(context, "profile", "publish", data.id, before, row, `Published version ${nextVersion}`);
    return row as BrandProfile;
  });

// ---------- Admin: assets ----------
export const listBrandAssetsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await context.supabase
      .from("mkt_brand_assets").select("*").order("slot").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as BrandAsset[];
  });

/** Register a freshly-uploaded object from the `brand-assets` bucket as a new
 *  asset row. Client uploads the file first through the Supabase JS client, then
 *  calls this fn with the returned storage path. */
export const registerBrandAssetAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    slot: ASSET_SLOT,
    storage_path: z.string().min(1).max(500),
    content_type: z.string().max(120).nullish(),
    size_bytes: z.number().int().nonnegative().nullish(),
    width: z.number().int().positive().nullish(),
    height: z.number().int().positive().nullish(),
    variant: z.string().max(60).nullish(),
    notes: z.string().max(1000).nullish(),
    publish: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/brand-assets/${encodeURI(data.storage_path)}`;
    // If publishing, unpublish any current row for this slot first.
    if (data.publish) {
      await context.supabase.from("mkt_brand_assets")
        .update({ is_published: false } as never).eq("slot", data.slot).eq("is_published", true);
    }
    const { data: row, error } = await context.supabase.from("mkt_brand_assets").insert({
      slot: data.slot, variant: data.variant ?? null,
      storage_path: data.storage_path, public_url: publicUrl,
      content_type: data.content_type ?? null, size_bytes: data.size_bytes ?? null,
      width: data.width ?? null, height: data.height ?? null,
      is_published: data.publish, notes: data.notes ?? null, uploaded_by: context.userId,
    } as never).select("*").single();
    if (error) throw new Error(error.message);
    await logHistory(context, "asset", data.publish ? "publish" : "upload", (row as { id: string }).id, null, row);
    return row as BrandAsset;
  });

export const publishBrandAssetAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: target, error: fetchErr } = await context.supabase
      .from("mkt_brand_assets").select("*").eq("id", data.id).single();
    if (fetchErr) throw new Error(fetchErr.message);
    const slot = (target as { slot: string }).slot;
    // Unpublish others in same slot atomically.
    await context.supabase.from("mkt_brand_assets")
      .update({ is_published: false } as never).eq("slot", slot).eq("is_published", true);
    const { data: row, error } = await context.supabase.from("mkt_brand_assets")
      .update({ is_published: true } as never).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    await logHistory(context, "asset", "publish", data.id, target, row, `Published slot ${slot}`);
    return row as BrandAsset;
  });

export const deleteBrandAssetAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: target } = await context.supabase.from("mkt_brand_assets").select("*").eq("id", data.id).maybeSingle();
    if (target) {
      // Best-effort remove the object; row deletion proceeds regardless.
      try {
        await context.supabase.storage.from("brand-assets").remove([(target as { storage_path: string }).storage_path]);
      } catch { /* ignore */ }
    }
    const { error } = await context.supabase.from("mkt_brand_assets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logHistory(context, "asset", "delete", data.id, target, null);
    return { ok: true };
  });

// ---------- Admin: history ----------
export const listBrandHistoryAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    entity: z.enum(["profile","asset","identity","communications","login","white_label"]).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    let q = context.supabase.from("mkt_brand_history").select("*").order("created_at", { ascending: false }).limit(data.limit);
    if (data.entity) q = q.eq("entity", data.entity);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
