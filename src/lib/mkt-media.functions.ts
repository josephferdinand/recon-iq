import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertMktRole } from "./mkt-admin.functions";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const MEDIA_ROLES = ["super_admin", "marketing_admin"] as const;

export type MktMediaKind = "image" | "video" | "reel";

export type MktMediaAsset = {
  id: string;
  kind: MktMediaKind;
  title: string;
  alt: string | null;
  storage_path: string | null;
  external_url: string | null;
  poster_url: string | null;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  size_bytes: number | null;
  tags: string[];
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  public_url: string | null;
};

const KindZ = z.enum(["image", "video", "reel"]);

function publicUrlFor(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/mkt-media/${path}`;
}

/** Public read — SSR-safe, no auth. Returns only enabled assets. */
export const listPublicMedia = createServerFn({ method: "GET" }).handler(
  async (): Promise<MktMediaAsset[]> => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return [];
    const sb = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb
      .from("mkt_media_assets")
      .select("*")
      .eq("enabled", true)
      .order("sort_order", { ascending: true });
    if (error) return [];
    return (data ?? []).map((r) => ({ ...r, public_url: publicUrlFor(r.storage_path) })) as MktMediaAsset[];
  },
);

export const listMediaAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ kind: KindZ.optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<MktMediaAsset[]> => {
    await assertMktRole(context, MEDIA_ROLES);
    let q = context.supabase.from("mkt_media_assets").select("*");
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q.order("sort_order").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({ ...r, public_url: publicUrlFor(r.storage_path) })) as MktMediaAsset[];
  });

export const upsertMediaAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      kind: KindZ,
      title: z.string().min(1).max(200),
      alt: z.string().max(500).nullable().optional(),
      storage_path: z.string().max(500).nullable().optional(),
      external_url: z.string().url().max(1000).nullable().optional(),
      poster_url: z.string().url().max(1000).nullable().optional(),
      duration_sec: z.number().int().min(0).max(24 * 3600).nullable().optional(),
      width: z.number().int().nullable().optional(),
      height: z.number().int().nullable().optional(),
      mime_type: z.string().max(120).nullable().optional(),
      size_bytes: z.number().int().nullable().optional(),
      tags: z.array(z.string().max(80)).max(30).default([]),
      sort_order: z.number().int().default(0),
      enabled: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MEDIA_ROLES);
    if (!data.storage_path && !data.external_url) {
      throw new Error("Either storage_path or external_url is required.");
    }
    const patch = {
      kind: data.kind,
      title: data.title,
      alt: data.alt ?? null,
      storage_path: data.storage_path ?? null,
      external_url: data.external_url ?? null,
      poster_url: data.poster_url ?? null,
      duration_sec: data.duration_sec ?? null,
      width: data.width ?? null,
      height: data.height ?? null,
      mime_type: data.mime_type ?? null,
      size_bytes: data.size_bytes ?? null,
      tags: data.tags,
      sort_order: data.sort_order,
      enabled: data.enabled,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await context.supabase.from("mkt_media_assets").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: r, error } = await context.supabase.from("mkt_media_assets").insert(patch).select("id").single();
    if (error) throw new Error(error.message);
    return { id: r!.id };
  });

export const deleteMediaAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MEDIA_ROLES);
    // Try to remove storage object if any
    const { data: cur } = await context.supabase
      .from("mkt_media_assets").select("storage_path").eq("id", data.id).maybeSingle();
    const path = (cur as { storage_path?: string | null } | null)?.storage_path ?? null;
    if (path) {
      try { await context.supabase.storage.from("mkt-media").remove([path]); } catch { /* ignore */ }
    }
    const { error } = await context.supabase.from("mkt_media_assets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Issue a signed upload URL so admins can PUT directly to storage. */
export const createMediaUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      filename: z.string().min(1).max(200).regex(/^[A-Za-z0-9._-]+$/, "filename may contain [A-Za-z0-9._-]"),
      kind: KindZ,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MEDIA_ROLES);
    const path = `${data.kind}/${Date.now()}-${data.filename}`;
    const { data: signed, error } = await context.supabase.storage
      .from("mkt-media")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });
