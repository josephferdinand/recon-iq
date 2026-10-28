import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const navigatorHubData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    // categories: platform (always) + tenant-scoped (if tenant_id)
    const catQ = sb
      .from("kb_categories")
      .select("id, scope, tenant_id, slug, name, position, cover_image_url, icon_key")
      .order("position", { ascending: true });
    const artQ = sb
      .from("kb_articles")
      .select("id, scope, tenant_id, category_id, slug, title, summary, cover_image_url, read_time_min, status, views, updated_at")
      .eq("status", "published")
      .order("updated_at", { ascending: false });

    const [{ data: cats, error: e1 }, { data: arts, error: e2 }] = await Promise.all([catQ, artQ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    return {
      categories: cats ?? [],
      articles: arts ?? [],
    };
  });

export const getKbArticleBySlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("kb_articles")
      .select("id, scope, tenant_id, category_id, slug, title, summary, cover_image_url, read_time_min, body_md, status, views, updated_at")
      .eq("slug", data.slug)
      .eq("status", "published")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Article not found");
    // best-effort view increment (ignore failure)
    await context.supabase.from("kb_articles").update({ views: (row.views ?? 0) + 1 }).eq("id", row.id);
    return row;
  });
