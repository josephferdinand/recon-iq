/**
 * Marketplace Listings UI — wave 2 deliverables. Adds version pinning,
 * dry-run install preview, publisher verification, and ratings moderation
 * on top of the existing marketplace.functions.ts surface.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tenantId = z.string().uuid();

// ─── Version registry ─────────────────────────────────────────────────────
export const listListingVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ listing_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("marketplace_listing_versions" as any)
      .select("id,version,changelog,payload_sha256,published_at,yanked_at,yanked_reason")
      .eq("listing_id", data.listing_id)
      .order("published_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const publishListingVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      listing_id: z.string().uuid(),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      payload: z.record(z.string(), z.unknown()),
      changelog: z.string().max(4000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payloadJson = JSON.stringify(data.payload);
    const hash = await sha256Hex(payloadJson);
    const { data: row, error } = await context.supabase
      .from("marketplace_listing_versions" as any)
      .insert({
        listing_id: data.listing_id,
        version: data.version,
        payload: data.payload as any,
        payload_sha256: hash,
        changelog: data.changelog ?? null,
        published_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, version_id: (row as any).id, sha256: hash };
  });

export const yankListingVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      version_id: z.string().uuid(),
      reason: z.string().min(3).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("marketplace_listing_versions" as any)
      .update({ yanked_at: new Date().toISOString(), yanked_reason: data.reason })
      .eq("id", data.version_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "marketplace.version.yank",
      resource_type: "marketplace_listing_versions",
      resource_id: data.version_id,
      context: { reason: data.reason } as any,
    } as any);
    return { ok: true };
  });

// ─── Dry-run install preview ──────────────────────────────────────────────
export const dryRunInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tenantId,
      listing_id: z.string().uuid(),
      version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: listing, error: lerr } = await context.supabase
      .from("marketplace_listings")
      .select("id,kind,title,tier,publisher,publisher_verified,moderation_state,payload,version")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (lerr) throw new Error(lerr.message);
    if (!listing) throw new Error("Listing not found");
    if ((listing as any).moderation_state !== "visible") throw new Error("Listing is not installable");

    let payload: Record<string, unknown> = ((listing as any).payload ?? {}) as any;
    let version = (listing as any).version as string;
    if (data.version) {
      const { data: v } = await context.supabase
        .from("marketplace_listing_versions" as any)
        .select("payload,version,yanked_at")
        .eq("listing_id", data.listing_id)
        .eq("version", data.version)
        .maybeSingle();
      if (!v) throw new Error("Pinned version not found");
      if ((v as any).yanked_at) throw new Error("Pinned version was yanked");
      payload = ((v as any).payload ?? {}) as any;
      version = (v as any).version as string;
    }

    // Compute install preview: count rules/policies/connectors/dashboards we'd create
    const summary = {
      listing_title: (listing as any).title,
      version,
      publisher: (listing as any).publisher,
      publisher_verified: (listing as any).publisher_verified,
      changes: {
        recon_templates: Array.isArray((payload as any).recon_templates) ? (payload as any).recon_templates.length : 0,
        rules: Array.isArray((payload as any).rules) ? (payload as any).rules.length : 0,
        policies: Array.isArray((payload as any).policies) ? (payload as any).policies.length : 0,
        dashboards: Array.isArray((payload as any).dashboards) ? (payload as any).dashboards.length : 0,
        connectors: Array.isArray((payload as any).connectors) ? (payload as any).connectors.length : 0,
      },
      rls_impact: "No RLS policy mutations; payload installs scoped to tenant_id.",
      reversible: true,
    };
    return summary;
  });

export const pinInstallVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      install_id: z.string().uuid(),
      pinned_version: z.string().regex(/^\d+\.\d+\.\d+$/).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("marketplace_installs" as any)
      .update({ pinned_version: data.pinned_version })
      .eq("id", data.install_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Publisher verification ───────────────────────────────────────────────
export const verifyPublisher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      listing_id: z.string().uuid(),
      publisher_lei: z.string().regex(/^[0-9A-Z]{18}\d{2}$/).optional(),
      publisher_domain: z.string().max(255).optional(),
      verified: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: any = { publisher_verified: data.verified };
    if (data.publisher_lei !== undefined) patch.publisher_lei = data.publisher_lei;
    if (data.publisher_domain !== undefined) patch.publisher_domain = data.publisher_domain;
    const { error } = await context.supabase
      .from("marketplace_listings")
      .update(patch)
      .eq("id", data.listing_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: data.verified ? "marketplace.publisher.verify" : "marketplace.publisher.unverify",
      resource_type: "marketplace_listings",
      resource_id: data.listing_id,
      context: { lei: data.publisher_lei, domain: data.publisher_domain } as any,
    } as any);
    return { ok: true };
  });

// ─── Ratings moderation ───────────────────────────────────────────────────
export const flagRating = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ rating_id: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("marketplace_ratings" as any)
      .update({ flagged: true, flagged_reason: data.reason })
      .eq("id", data.rating_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const moderateRating = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      rating_id: z.string().uuid(),
      action: z.enum(["hide", "restore"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: any = data.action === "hide"
      ? { flagged: true, moderated_at: new Date().toISOString(), moderated_by: context.userId }
      : { flagged: false, moderated_at: new Date().toISOString(), moderated_by: context.userId };
    const { error } = await context.supabase
      .from("marketplace_ratings" as any)
      .update(patch)
      .eq("id", data.rating_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
