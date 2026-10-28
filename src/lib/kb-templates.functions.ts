import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertPlatformAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  if (!data) throw new Error("Forbidden: platform admin required");
}

/* -------- KB TEMPLATES -------- */
export const listKbTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("kb_article_templates")
      .select("id,key,name,description,scope,body_md,default_soc2_controls,is_system,updated_at")
      .order("scope").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createArticleFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    template_id: z.string().uuid(),
    tenant_id: z.string().uuid().optional(),
    category_id: z.string().uuid().optional(),
    title: z.string().min(2).max(200),
    summary: z.string().max(500).optional(),
    scope: z.enum(["workspace","tenant","platform"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: tpl, error: tplErr } = await context.supabase
      .from("kb_article_templates").select("*").eq("id", data.template_id).maybeSingle();
    if (tplErr || !tpl) throw new Error("Template not found");

    const body = String(tpl.body_md)
      .replaceAll("{{title}}", data.title)
      .replaceAll("{{summary}}", data.summary ?? "");

    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

    const insertRow: any = {
      scope: data.scope, tenant_id: data.tenant_id ?? null,
      category_id: data.category_id ?? null,
      slug, title: data.title, body_md: body,
      summary: data.summary ?? null, status: "draft",
      author_id: context.userId,
    };
    const { data: article, error } = await context.supabase
      .from("kb_articles").insert(insertRow).select("id,slug").single();
    if (error) throw new Error(error.message);

    if (tpl.default_soc2_controls?.length) {
      const rows = (tpl.default_soc2_controls as string[]).map((c) => ({
        article_id: article.id, control_code: c, added_by: context.userId,
        rationale: "Seeded from template " + tpl.key,
      }));
      await context.supabase.from("kb_article_soc2_controls").insert(rows);
    }
    return article;
  });

/* -------- KB STEPS -------- */
export const listArticleSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ article_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("kb_article_steps")
      .select("id,step_number,title,body_md,screenshot_url,callouts")
      .eq("article_id", data.article_id).order("step_number");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertArticleStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid().optional(),
    article_id: z.string().uuid(),
    step_number: z.number().int().min(1),
    title: z.string().min(1).max(200),
    body_md: z.string().max(5000).optional(),
    screenshot_url: z.string().max(500).optional(),
    callouts: z.array(z.object({
      x: z.number(), y: z.number(), w: z.number(), h: z.number(),
      number: z.number().int(), label: z.string().max(200),
    })).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const row: any = { ...data, callouts: data.callouts };
    const { data: res, error } = await context.supabase
      .from("kb_article_steps").upsert(row, { onConflict: "article_id,step_number" })
      .select("id").single();
    if (error) throw new Error(error.message);
    return res;
  });

export const deleteArticleStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase.from("kb_article_steps").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderArticleSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    article_id: z.string().uuid(),
    order: z.array(z.object({ id: z.string().uuid(), step_number: z.number().int().min(1) })),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    for (const o of data.order) {
      await context.supabase.from("kb_article_steps")
        .update({ step_number: o.step_number + 10000 }).eq("id", o.id);
    }
    for (const o of data.order) {
      await context.supabase.from("kb_article_steps")
        .update({ step_number: o.step_number }).eq("id", o.id);
    }
    return { ok: true };
  });

export const signKbScreenshots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ paths: z.array(z.string().min(1)).max(400) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!data.paths.length) return {} as Record<string, string>;
    const { data: signed, error } = await context.supabase.storage
      .from("kb-screenshots").createSignedUrls(data.paths, 60 * 60);
    if (error) throw new Error(error.message);
    const out: Record<string, string> = {};
    for (const s of signed ?? []) if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
    return out;
  });

/**
 * Delete one or more screenshot objects (and the implied .thumb.jpg siblings if not already in `paths`)
 * from the `kb-screenshots` bucket. Platform admins only — used to keep storage tidy when a step is
 * deleted or its screenshot is replaced.
 */
export const deleteKbScreenshots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ paths: z.array(z.string().min(1)).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const all = new Set<string>();
    for (const p of data.paths) {
      all.add(p);
      const thumb = p.replace(/(\.[^.]+)?$/, ".thumb.jpg");
      all.add(thumb);
    }
    const { error } = await context.supabase.storage
      .from("kb-screenshots").remove(Array.from(all));
    if (error) throw new Error(error.message);
    return { ok: true, removed: all.size };
  });

/* -------- KB SOC2 MAPPING -------- */
export const listArticleSoc2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ article_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("kb_article_soc2_controls")
      .select("control_code,rationale,added_at")
      .eq("article_id", data.article_id).order("control_code");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const setArticleSoc2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    article_id: z.string().uuid(),
    controls: z.array(z.object({
      control_code: z.string().min(2).max(20),
      rationale: z.string().max(500).optional(),
    })),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    await context.supabase.from("kb_article_soc2_controls").delete().eq("article_id", data.article_id);
    if (data.controls.length) {
      const rows = data.controls.map((c) => ({
        article_id: data.article_id,
        control_code: c.control_code,
        rationale: c.rationale ?? null,
        added_by: context.userId,
      }));
      const { error } = await context.supabase.from("kb_article_soc2_controls").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const listSoc2Catalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("soc2_controls").select("control_code,tsc,title,description")
      .order("control_code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
