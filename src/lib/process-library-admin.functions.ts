// Platform-admin server functions for publishing reusable reconciliation
// blueprints to the Process Library.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SlugRe = /^[a-z0-9][a-z0-9-]{1,80}$/;

async function assertPlatformAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_platform_admin" as any, { _user_id: userId });
  if (error) throw error;
  if (!data) throw new Error("Forbidden: platform admin required");
}

export const listAllBlueprints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("process_library")
      .select("id,slug,title,summary,category,asset_class,version,published,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getBlueprintBySlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ slug: z.string().regex(SlugRe) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("process_library")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();
    if (error) throw error;
    return row;
  });

const UpsertSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().regex(SlugRe),
  title: z.string().min(2).max(160),
  summary: z.string().max(800).optional(),
  category: z.string().min(2).max(60),
  assetClass: z.string().max(60).optional(),
  blueprintJson: z.string().min(2).max(200_000),
  published: z.boolean().default(false),
});

export const upsertBlueprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => UpsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    let blueprint: unknown;
    try {
      blueprint = JSON.parse(data.blueprintJson);
    } catch {
      throw new Error("blueprintJson must be valid JSON");
    }

    if (data.id) {
      // Bump version on every save so consumers can detect changes.
      const { data: cur } = await context.supabase
        .from("process_library")
        .select("version")
        .eq("id", data.id)
        .maybeSingle();
      const nextVersion = (cur?.version ?? 1) + 1;
      const { error } = await context.supabase
        .from("process_library")
        .update({
          slug: data.slug,
          title: data.title,
          summary: data.summary ?? null,
          category: data.category,
          asset_class: data.assetClass ?? null,
          blueprint: blueprint as never,
          published: data.published,
          version: nextVersion,
        })
        .eq("id", data.id);
      if (error) throw error;
      return { id: data.id, version: nextVersion };
    }
    const { data: ins, error } = await context.supabase
      .from("process_library")
      .insert({
        slug: data.slug,
        title: data.title,
        summary: data.summary ?? null,
        category: data.category,
        asset_class: data.assetClass ?? null,
        blueprint: blueprint as never,
        published: data.published,
        version: 1,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: ins.id, version: 1 };
  });

export const togglePublishBlueprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), published: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("process_library")
      .update({ published: data.published })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteBlueprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("process_library")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
