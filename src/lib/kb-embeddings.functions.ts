/**
 * Admin-only server functions to (re)build KB embeddings for Copilot RAG.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const uuid = z.string().uuid();

/**
 * Re-embed the given article (or all published articles for a tenant when
 * `article_id` omitted). Caller must be platform admin OR tenant admin.
 */
export const rebuildKbEmbeddings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        article_id: uuid.optional(),
        tenant_id: uuid.optional(),
      })
      .parse(d))
  .handler(async ({ data, context }) => {
    const { data: isPlat } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    let authorized = !!isPlat;
    if (!authorized && data.tenant_id) {
      const { data: role } = await context.supabase.rpc("has_tenant_role", {
        _user_id: context.userId,
        _tenant_id: data.tenant_id,
        _role: "tenant_admin",
      });
      authorized = !!role;
    }
    if (!authorized) throw new Error("Forbidden");

    const { chunkMarkdown, embedTexts, KB_EMBEDDING_MODEL } = await import(
      "./kb-embeddings.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("kb_articles")
      .select("id, tenant_id, scope, title, body_md, status")
      .eq("status", "published");
    if (data.article_id) q = q.eq("id", data.article_id);
    else if (data.tenant_id)
      q = q.or(`scope.eq.platform,tenant_id.eq.${data.tenant_id}`);
    const { data: articles, error } = await q;
    if (error) throw new Error(error.message);

    let totalChunks = 0;
    let totalArticles = 0;
    for (const a of articles ?? []) {
      const chunks = chunkMarkdown(`${a.title}\n\n${a.body_md ?? ""}`);
      if (chunks.length === 0) continue;
      const vectors = await embedTexts(supabaseAdmin as any, chunks);
      // Replace existing chunks atomically.
      await supabaseAdmin.from("kb_chunks").delete().eq("article_id", a.id);
      const rows = chunks.map((content, i) => ({
        article_id: a.id,
        tenant_id: a.tenant_id,
        scope: a.scope,
        chunk_index: i,
        content,
        embedding: vectors[i] as any,
        embedding_model: KB_EMBEDDING_MODEL,
      }));
      const { error: insErr } = await supabaseAdmin.from("kb_chunks").insert(rows);
      if (insErr) throw new Error(`Insert failed for ${a.id}: ${insErr.message}`);
      totalArticles += 1;
      totalChunks += rows.length;
    }
    return { ok: true, articles: totalArticles, chunks: totalChunks };
  });
