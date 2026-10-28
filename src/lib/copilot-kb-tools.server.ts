/**
 * ReconIQ Copilot — Knowledge Base deep-answer tools (read-only "safe subset").
 *
 * Exposes structured tools so the model can answer, explain, and reason from
 * KB articles: full retrieval by slug/id, related-article discovery via
 * embeddings, procedure/troubleshooting extraction from markdown, and
 * actionable "what should I read next" recommendations.
 *
 * All reads go through the caller's Supabase client so RLS applies.
 */
import { z } from "zod";
import { tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CopilotContext } from "./copilot-tools.server";
import { hybridSearchKb } from "./copilot-tools.server";

const MAX_BODY = 8000;
const RELATED_LIMIT = 6;

type KbRow = {
  id: string;
  scope: "platform" | "tenant";
  tenant_id: string | null;
  category_id: string | null;
  slug: string;
  title: string;
  summary: string | null;
  cover_image_url: string | null;
  read_time_min: number | null;
  body_md: string | null;
  status: string;
  views: number | null;
  updated_at: string;
};

/** Slice a markdown body into H2/H3 sections with their contents. */
function splitSections(body: string): Array<{ heading: string; level: 2 | 3; body: string }> {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const sections: Array<{ heading: string; level: 2 | 3; body: string }> = [];
  let cur: { heading: string; level: 2 | 3; buf: string[] } | null = null;
  for (const line of lines) {
    const m2 = line.match(/^##\s+(.+?)\s*$/);
    const m3 = line.match(/^###\s+(.+?)\s*$/);
    const h = m2 ?? m3;
    if (h) {
      if (cur) sections.push({ heading: cur.heading, level: cur.level, body: cur.buf.join("\n").trim() });
      cur = { heading: h[1], level: m2 ? 2 : 3, buf: [] };
    } else if (cur) {
      cur.buf.push(line);
    }
  }
  if (cur) sections.push({ heading: cur.heading, level: cur.level, body: cur.buf.join("\n").trim() });
  return sections;
}

/** Extract ordered/bulleted list items as procedure steps. */
function extractSteps(body: string): string[] {
  if (!body) return [];
  const steps: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:\d+\.|-|\*)\s+(.+?)\s*$/);
    if (m) steps.push(m[1]);
  }
  return steps.slice(0, 25);
}

function pickProceduralSections(body: string) {
  const sec = splitSections(body);
  const wanted = /(step|procedure|how to|walkthrough|setup|configure|install|deploy|enable)/i;
  return sec.filter((s) => wanted.test(s.heading));
}

function pickTroubleshootingSections(body: string) {
  const sec = splitSections(body);
  const wanted = /(troubleshoot|fix|error|issue|problem|debug|resolve|remediation|workaround|faq)/i;
  return sec.filter((s) => wanted.test(s.heading));
}

async function loadArticle(
  supa: SupabaseClient,
  by: { id?: string; slug?: string },
): Promise<KbRow | null> {
  let q = supa
    .from("kb_articles")
    .select(
      "id, scope, tenant_id, category_id, slug, title, summary, cover_image_url, read_time_min, body_md, status, views, updated_at",
    )
    .eq("status", "published")
    .limit(1);
  if (by.id) q = q.eq("id", by.id);
  else if (by.slug) q = q.eq("slug", by.slug);
  else return null;
  const { data } = await q.maybeSingle();
  return (data ?? null) as KbRow | null;
}

/** Find related articles by embedding similarity to the seed article's title+summary. */
async function findRelated(
  ctx: CopilotContext,
  seed: KbRow,
  limit: number,
): Promise<Array<{ article_id: string; title: string; slug: string; score: number }>> {
  const seedText = `${seed.title}\n${seed.summary ?? ""}`.trim();
  if (!seedText) return [];
  try {
    const { embedQuery } = await import("./kb-embeddings.server");
    const vec = await embedQuery(ctx.supabase, seedText);
    if (!vec) return [];
    const { data } = await ctx.supabase.rpc("match_kb_chunks", {
      query_embedding: vec as any,
      _tenant_id: ctx.tenantId,
      match_count: limit * 4,
    });
    const seen = new Set<string>([seed.id]);
    const rows: Array<{ article_id: string; title: string; slug: string; score: number }> = [];
    for (const r of (data ?? []) as any[]) {
      const id = String(r.article_id);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        article_id: id,
        title: String(r.title ?? ""),
        slug: String(r.slug ?? ""),
        score: Number(r.similarity ?? r.score ?? 0),
      });
      if (rows.length >= limit) break;
    }
    return rows;
  } catch {
    return [];
  }
}

/** Build the read-only KB tool set for the model. */
export function buildCopilotKbTools(ctx: CopilotContext) {
  const supa = ctx.supabase;

  return {
    /* ─────────────────  DEEP RETRIEVAL  ───────────────── */

    kb_get_article: tool({
      description:
        "Fetch a KB article by slug or id and return title, summary, cover, category, updated_at, and the full markdown body (truncated to 8k chars) so you can quote/explain from it. Use immediately after search_kb to answer 'explain this article' or 'what does this article say'. Also returns extracted procedure steps, troubleshooting sections, and top related articles.",
      inputSchema: z.object({
        slug: z.string().min(1).max(200).optional(),
        id: z.string().uuid().optional(),
        include_related: z.boolean().default(true),
      }).refine((v) => !!(v.slug || v.id), { message: "slug or id required" }),
      execute: async ({ slug, id, include_related }) => {
        const article = await loadArticle(supa, { id, slug });
        if (!article) return { found: false as const };
        const body = String(article.body_md ?? "");
        const procedures = pickProceduralSections(body).map((s) => ({
          heading: s.heading,
          steps: extractSteps(s.body),
        })).filter((s) => s.steps.length > 0);
        const troubleshooting = pickTroubleshootingSections(body).map((s) => ({
          heading: s.heading,
          body: s.body.slice(0, 1200),
        }));
        const related = include_related ? await findRelated(ctx, article, RELATED_LIMIT) : [];
        // best-effort view bump
        void supa.from("kb_articles").update({ views: (article.views ?? 0) + 1 }).eq("id", article.id);
        return {
          found: true as const,
          article: {
            id: article.id,
            slug: article.slug,
            title: article.title,
            summary: article.summary,
            scope: article.scope,
            cover_image_url: article.cover_image_url,
            read_time_min: article.read_time_min,
            updated_at: article.updated_at,
            body_md: body.slice(0, MAX_BODY),
            truncated: body.length > MAX_BODY,
          },
          procedures,
          troubleshooting,
          related,
        };
      },
    }),

    kb_list_related: tool({
      description:
        "Return the most-related published KB articles for a given seed article (by slug or id), scored by embedding similarity. Use when the user asks 'what else should I read', 'related to X', or after answering a question to suggest follow-ups.",
      inputSchema: z.object({
        slug: z.string().min(1).max(200).optional(),
        id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(10).default(5),
      }).refine((v) => !!(v.slug || v.id), { message: "slug or id required" }),
      execute: async ({ slug, id, limit }) => {
        const seed = await loadArticle(supa, { id, slug });
        if (!seed) return { found: false as const, related: [] };
        const related = await findRelated(ctx, seed, limit);
        return { found: true as const, seed: { id: seed.id, slug: seed.slug, title: seed.title }, related };
      },
    }),

    /* ─────────────────  PROCEDURES / TROUBLESHOOTING  ───────────────── */

    kb_get_procedure: tool({
      description:
        "Given a natural-language task ('how do I export a report'), find the best-matching KB article and extract its procedural steps as an ordered list. Uses hybrid search + section extraction. Prefer this over kb_get_article when the user asks HOW to do something.",
      inputSchema: z.object({
        query: z.string().min(2).max(400),
      }),
      execute: async ({ query }) => {
        const hits = await hybridSearchKb(ctx, { query, k: 3 });
        if (hits.results.length === 0) return { found: false as const, candidates: [] };
        for (const h of hits.results) {
          const art = await loadArticle(supa, { id: h.article_id });
          if (!art) continue;
          const secs = pickProceduralSections(art.body_md ?? "");
          const steps: Array<{ heading: string; steps: string[] }> = secs
            .map((s) => ({ heading: s.heading, steps: extractSteps(s.body) }))
            .filter((s) => s.steps.length > 0);
          if (steps.length === 0) continue;
          return {
            found: true as const,
            article: { id: art.id, slug: art.slug, title: art.title, summary: art.summary },
            procedures: steps,
          };
        }
        return {
          found: false as const,
          candidates: hits.results.slice(0, 3).map((r) => ({ title: r.title, slug: r.slug })),
        };
      },
    }),

    kb_troubleshoot: tool({
      description:
        "Given a user-reported symptom ('reconciliation stuck', 'export fails with 500'), find matching KB articles and return their troubleshooting/fix sections and any actionable recommendations. Cite article titles in your response.",
      inputSchema: z.object({
        symptom: z.string().min(3).max(400),
        max_articles: z.number().int().min(1).max(5).default(3),
      }),
      execute: async ({ symptom, max_articles }) => {
        const hits = await hybridSearchKb(ctx, { query: symptom, k: max_articles + 2 });
        const results: Array<{
          article: { id: string; slug: string; title: string };
          troubleshooting: Array<{ heading: string; body: string }>;
          steps: string[];
        }> = [];
        for (const h of hits.results) {
          if (results.length >= max_articles) break;
          const art = await loadArticle(supa, { id: h.article_id });
          if (!art) continue;
          const body = String(art.body_md ?? "");
          const secs = pickTroubleshootingSections(body);
          if (secs.length === 0) continue;
          const steps: string[] = [];
          for (const s of secs) steps.push(...extractSteps(s.body));
          results.push({
            article: { id: art.id, slug: art.slug, title: art.title },
            troubleshooting: secs.map((s) => ({ heading: s.heading, body: s.body.slice(0, 800) })),
            steps: steps.slice(0, 12),
          });
        }
        return {
          symptom,
          matched: results.length,
          results,
          fallback_candidates: results.length === 0
            ? hits.results.slice(0, 3).map((r) => ({ title: r.title, slug: r.slug }))
            : [],
        };
      },
    }),

    /* ─────────────────  RECOMMENDATIONS  ───────────────── */

    kb_recommend_reading: tool({
      description:
        "Recommend the top KB articles to read for a given topic or role ('new user onboarding', 'admin best practices'). Blends hybrid search with freshness and tenant scope. Use to close an answer with '📚 Recommended reading:'.",
      inputSchema: z.object({
        topic: z.string().min(2).max(200),
        limit: z.number().int().min(1).max(8).default(5),
      }),
      execute: async ({ topic, limit }) => {
        const hits = await hybridSearchKb(ctx, { query: topic, k: limit });
        return {
          topic,
          recommendations: hits.results.map((r) => ({
            title: r.title,
            slug: r.slug,
            scope: r.scope,
            why: r.excerpt.slice(0, 200),
          })),
        };
      },
    }),

    kb_list_categories: tool({
      description:
        "List KB categories (platform + this tenant's own) so you can guide the user to browse. Returns category name, slug, and count of published articles.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data: cats } = await supa
          .from("kb_categories")
          .select("id, scope, tenant_id, slug, name, position")
          .order("position", { ascending: true });
        const { data: arts } = await supa
          .from("kb_articles")
          .select("category_id")
          .eq("status", "published");
        const counts = new Map<string, number>();
        for (const a of (arts ?? []) as any[]) {
          const k = String(a.category_id ?? "");
          if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return {
          categories: (cats ?? []).map((c: any) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            scope: c.scope,
            article_count: counts.get(String(c.id)) ?? 0,
          })),
        };
      },
    }),
  };
}

export type CopilotKbToolName = keyof ReturnType<typeof buildCopilotKbTools>;
