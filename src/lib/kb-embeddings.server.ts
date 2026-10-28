/**
 * KB embeddings — server-only helpers for Copilot RAG.
 *
 * Embeds KB article body_md into `kb_chunks` using the ReconIQ AI provider
 * (`muse/text-embedding-3-small`, 1536 dims). Called from
 * `kb-embeddings.functions.ts` (admin-triggered backfill) and reused by the
 * Copilot `search_kb` tool to embed the user query.
 */
import { resolveFviAiBaseUrl, resolvePlatformAiApiKey } from "./ai/provider-router.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const KB_EMBEDDING_MODEL = "muse/text-embedding-3-small";
export const KB_EMBEDDING_DIMS = 1536;

/** Split markdown into ~1000 char chunks at paragraph boundaries. */
export function chunkMarkdown(input: string, maxLen = 1000): string[] {
  const text = (input ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const paras = text.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > maxLen && buf) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export async function embedTexts(
  supabase: Pick<SupabaseClient, "from">,
  inputs: string[],
): Promise<number[][]> {
  const key = resolvePlatformAiApiKey();
  if (!key) throw new Error("Platform AI provider not configured (missing FVI_AI_API_KEY / vault credential)");
  if (inputs.length === 0) return [];
  const baseUrl = await resolveFviAiBaseUrl(supabase);
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "X-FVI-AI-Client": "fvi-copilot",
    },
    body: JSON.stringify({
      model: KB_EMBEDDING_MODEL,
      input: inputs,
      dimensions: KB_EMBEDDING_DIMS,
    }),
  });
  if (!res.ok) {
    throw new Error(`Embeddings call failed: ${res.status} ${await res.text()}`);
  }
  const j: any = await res.json();
  return (j?.data ?? []).map((d: any) => d.embedding as number[]);
}

/** Embed one query string and return its single vector. */
export async function embedQuery(
  supabase: Pick<SupabaseClient, "from">,
  query: string,
): Promise<number[] | null> {
  const trimmed = (query ?? "").trim().slice(0, 2000);
  if (!trimmed) return null;
  const [vec] = await embedTexts(supabase, [trimmed]);
  return vec ?? null;
}
