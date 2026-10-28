import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tenantId = z.string().uuid();

export const listListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ kind: z.string().optional(), tier: z.string().optional(), q: z.string().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("marketplace_listings")
      .select("id,slug,title,kind,tier,publisher,summary,description,version,tags,status,install_count,rating_avg,rating_count,published_at")
      .eq("status", "published")
      .order("install_count", { ascending: false });
    if (data.kind) q = q.eq("kind", data.kind);
    if (data.tier) q = q.eq("tier", data.tier);
    if (data.q) q = q.ilike("title", `%${data.q}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listInstalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("marketplace_installs")
      .select("id,listing_id,installed_version,installed_at,target_resource_type,target_resource_id, listing:marketplace_listings(title,kind,tier,publisher,version,slug)")
      .eq("tenant_id", data.tenant_id)
      .order("installed_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const installListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId, listing_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: listing, error: lerr } = await context.supabase
      .from("marketplace_listings")
      .select("id,title,version,kind")
      .eq("id", data.listing_id)
      .eq("status", "published")
      .maybeSingle();
    if (lerr) throw new Error(lerr.message);
    if (!listing) throw new Error("Listing not found or not published");

    const { data: install, error } = await context.supabase
      .from("marketplace_installs")
      .insert({
        tenant_id: data.tenant_id,
        listing_id: listing.id,
        installed_by: context.userId,
        installed_version: listing.version,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "marketplace.install",
      resource_type: "marketplace_installs",
      resource_id: install.id,
      context: { listing: listing.title, kind: listing.kind, version: listing.version },
    } as any);
    return install;
  });

export const uninstallListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId, install_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("marketplace_installs").delete()
      .eq("id", data.install_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "marketplace.uninstall", resource_type: "marketplace_installs", resource_id: data.install_id, context: {},
    } as any);
    return { ok: true };
  });

export const rateListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tenantId,
    listing_id: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    review: z.string().max(2000).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("marketplace_ratings").upsert({
      tenant_id: data.tenant_id,
      listing_id: data.listing_id,
      user_id: context.userId,
      rating: data.rating,
      review: data.review ?? null,
    } as any, { onConflict: "tenant_id,listing_id,user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
