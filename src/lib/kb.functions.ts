import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export const listKbArticles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("kb_articles")
      .select("id, scope, tenant_id, category_id, slug, title, status, views, updated_at")
      .eq("scope", data.scope)
      .order("updated_at", { ascending: false });
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    else q = q.is("tenant_id", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getKbArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("kb_articles").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    return row;
  });

export const upsertKbArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
      title: z.string().min(2).max(200),
      body_md: z.string().max(50000).default(""),
      status: z.enum(["draft", "published", "archived"]).default("draft"),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const patch: any = {
      scope: data.scope,
      tenant_id: data.scope === "tenant" ? data.tenant_id : null,
      title: data.title,
      body_md: data.body_md,
      status: data.status,
      author_id: context.userId,
    };
    if (!data.id) patch.slug = slugify(data.title) + "-" + Math.random().toString(36).slice(2, 6);

    let row: any;
    if (data.id) {
      const { data: r, error } = await context.supabase
        .from("kb_articles").update(patch).eq("id", data.id).select("id, tenant_id, scope").single();
      if (error) throw new Error(error.message);
      row = r;
    } else {
      const { data: r, error } = await context.supabase
        .from("kb_articles").insert(patch).select("id, tenant_id, scope").single();
      if (error) throw new Error(error.message);
      row = r;
    }
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: row.tenant_id, scope: row.scope,
      action: data.id ? "kb.update" : "kb.create",
      resource_type: "kb_article", resource_id: row.id,
      context: { title: data.title, status: data.status },
    } as any);
    return { id: row.id };
  });

export const deleteKbArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cur } = await context.supabase
      .from("kb_articles").select("scope, tenant_id").eq("id", data.id).single();
    const { error } = await context.supabase.from("kb_articles").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: (cur as any)?.tenant_id ?? null,
      scope: (cur as any)?.scope ?? "platform",
      action: "kb.delete", resource_type: "kb_article", resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });
