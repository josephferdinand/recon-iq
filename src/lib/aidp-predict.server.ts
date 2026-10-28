/**
 * AIDP Slice 3 — real prediction loop (server-only helpers).
 * Imported by src/lib/aidp.functions.ts inside the predictDocument handler.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject, NoObjectGeneratedError } from "ai";
import { createAnthropic } from "@/lib/ai/muse-provider.server";
import { createMuseCompatible } from "@/lib/ai/muse-provider.server";
import { z } from "zod";
import { createFviAiProvider, resolvePlatformAiApiKey } from "@/lib/ai/provider-router.server";
import { assertSafeOutboundUrl } from "@/lib/ssrf-guard.server";

export type EntityType = {
  id: string;
  key: string;
  label: string;
  datatype: string;          // 'string' | 'number' | 'date' | 'currency' | 'json'
  extractor: string;
  required: boolean;
  confidence_threshold: number;
  review_policy: "auto_accept" | "review_below" | "always_review";
  options: Record<string, unknown>;
};

export type ResolvedModel = {
  model_version_id: string;
  provider: string;          // 'anthropic' | 'muse' | 'google' | 'fvi_ai'
  model: string;
  api_key?: string;
  base_url?: string;
  source: "input" | "document_type" | "platform_default";
};

/** Build a Zod schema from the document type's entity_types. */
export function buildPredictionSchema(entityTypes: EntityType[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const fieldSchema = z.object({
    value: z.union([z.string(), z.number(), z.null()]).optional(),
    confidence: z.number().min(0).max(1),
    bbox: z.object({ page: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional().nullable(),
  });
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const et of entityTypes) shape[et.key] = fieldSchema;
  return z.object(shape);
}

/**
 * Resolve which model version to call. Precedence:
 *   1) explicit input.model_version_id
 *   2) document_type.default_model_version_id
 *   3) platform_ai_settings.default_model (treated as a Meta AI Gateway model id)
 */
export async function resolveModelVersion(
  supabase: SupabaseClient,
  tenantId: string,
  documentTypeId: string | null,
  modelVersionIdInput: string | undefined,
): Promise<ResolvedModel> {
  // 1) explicit
  if (modelVersionIdInput) {
    const { data: mv } = await supabase.from("aidp_model_versions")
      .select("id, model_id, provider, model, base_url, key_secret_name")
      .eq("id", modelVersionIdInput).maybeSingle();
    if (mv) return resolveProviderKey(mv, "input");
  }

  // 2) document_type default
  if (documentTypeId) {
    const { data: dt } = await supabase.from("aidp_document_types")
      .select("default_model_version_id").eq("id", documentTypeId).maybeSingle();
    if (dt?.default_model_version_id) {
      const { data: mv } = await supabase.from("aidp_model_versions")
        .select("id, model_id, provider, model, base_url, key_secret_name")
        .eq("id", dt.default_model_version_id).maybeSingle();
      if (mv) return resolveProviderKey(mv, "document_type");
    }
  }

  // 3) tenant LLM provider (BYOK first)
  const tenantProviderQuery = () => supabase
    .from("llm_providers")
    .select("provider, model, base_url, key_secret_name")
    .eq("scope", "tenant")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  let { data: tenantLlm } = await tenantProviderQuery()
    .in("provider", ["anthropic", "muse", "google"])
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!tenantLlm) {
    ({ data: tenantLlm } = await tenantProviderQuery()
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle());
  }
  if (tenantLlm) {
    const { resolveVaultSecret } = await import("./vault-resolver.server");
    const resolved = await resolveVaultSecret(supabase, {
      scope: "tenant", tenant_id: tenantId, secret_class: "llm_api_key",
      name: String(tenantLlm.key_secret_name || tenantLlm.provider).toUpperCase(),
    });
    return {
      model_version_id: "tenant-llm-default",
      provider: String(tenantLlm.provider),
      model: tenantLlm.model,
      base_url: tenantLlm.base_url ?? undefined,
      api_key: resolved?.plaintext,
      source: "document_type",
    };
  }

  // 4) configured platform provider, ordered by explicit priority
  const platformProviderQuery = () => supabase
    .from("llm_providers")
    .select("provider, model, base_url, key_secret_name")
    .eq("scope", "platform")
    .is("tenant_id", null)
    .eq("is_active", true);
  let { data: platformLlm } = await platformProviderQuery()
    .in("provider", ["anthropic", "muse", "google"])
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!platformLlm) {
    ({ data: platformLlm } = await platformProviderQuery()
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle());
  }
  if (platformLlm) {
    let platformApiKey = resolvePlatformAiApiKey();
    try {
      const { resolveVaultSecret } = await import("./vault-resolver.server");
      const resolved = await resolveVaultSecret(supabase, {
        scope: "platform",
        tenant_id: null,
        secret_class: "llm_api_key",
        name: String(platformLlm.key_secret_name || platformLlm.provider).toUpperCase(),
      });
      platformApiKey = resolved?.plaintext ?? platformApiKey;
    } catch (error) {
      // A platform-managed runtime secret is an explicit supported fallback.
      // Tenant BYOK resolution above remains vault-only and fail-closed.
      if (!platformApiKey) throw error;
    }
    return {
      model_version_id: "platform-llm-default",
      provider: String(platformLlm.provider),
      model: platformLlm.model,
      base_url: platformLlm.base_url ?? undefined,
      api_key: platformApiKey,
      source: "platform_default",
    };
  }

  // 5) legacy platform setting → FVI-managed AI provider
  const { data: plat } = await supabase.from("platform_ai_settings")
    .select("default_model").maybeSingle();
  const fallbackModel = plat?.default_model || "google/gemini-3-flash-preview";
  return {
    model_version_id: "platform-default",
    provider: "fvi_ai",
    model: fallbackModel,
    api_key: resolvePlatformAiApiKey(),
    source: "platform_default",
  };
}

function resolveProviderKey(mv: any, source: ResolvedModel["source"]): ResolvedModel {
  const provider = String(mv.provider || "fvi_ai");
  let apiKey: string | undefined;
  if (provider === "fvi_ai" || provider === "meta_ai_gateway") apiKey = resolvePlatformAiApiKey();
  else if (mv.key_secret_name && typeof mv.key_secret_name === "string"
      && /^[A-Z][A-Z0-9_]*_(API_KEY|TOKEN|SECRET)$/.test(mv.key_secret_name)) {
    apiKey = process.env[mv.key_secret_name];
  }
  if (!apiKey && (provider === "fvi_ai" || provider === "meta_ai_gateway")) apiKey = resolvePlatformAiApiKey();
  return {
    model_version_id: mv.id,
    provider: provider === "meta_ai_gateway" ? "fvi_ai" : provider,
    model: mv.model || "google/gemini-3-flash-preview",
    base_url: mv.base_url ?? undefined,
    api_key: apiKey,
    source,
  };
}

/** Build an AI SDK model handle for the resolved provider. Falls back to FVI-managed provider. */
export function buildModelHandle(resolved: ResolvedModel) {
  if (resolved.provider === "anthropic" && resolved.api_key && resolved.base_url) {
    const provider = createAnthropic({
      apiKey: resolved.api_key,
      baseURL: resolved.base_url,
    });
    return provider(resolved.model);
  }
  if (resolved.provider !== "fvi_ai" && resolved.provider !== "meta_ai_gateway" && resolved.api_key && resolved.base_url) {
    const provider = createMuseCompatible({
      name: resolved.provider,
      baseURL: resolved.base_url,
      headers: { Authorization: `Bearer ${resolved.api_key}` },
    });
    return provider(resolved.model);
  }
  const key = resolved.api_key || resolvePlatformAiApiKey();
  if (!key) throw new Error("Platform AI provider not configured; cannot run AIDP prediction");
  const gateway = createFviAiProvider(key, undefined, resolved.base_url);
  return gateway(resolved.model);
}

/** Coerce LLM string output to the right column for aidp_prediction_fields. */
export function coerceValueColumns(
  datatype: string,
  raw: unknown,
): { value_text: string | null; value_number: number | null; value_date: string | null; value_json: any | null } {
  if (raw === undefined || raw === null) return { value_text: null, value_number: null, value_date: null, value_json: null };
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  switch (datatype) {
    case "number":
    case "currency": {
      const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
      return { value_text: s, value_number: Number.isFinite(n) ? n : null, value_date: null, value_json: null };
    }
    case "date": {
      const d = new Date(s);
      const iso = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
      return { value_text: s, value_number: null, value_date: iso, value_json: null };
    }
    case "json":
      try {
        const j = typeof raw === "string" ? JSON.parse(raw) : raw;
        return { value_text: null, value_number: null, value_date: null, value_json: j };
      } catch {
        return { value_text: s, value_number: null, value_date: null, value_json: null };
      }
    default:
      return { value_text: s, value_number: null, value_date: null, value_json: null };
  }
}

/** Per-entity-type review_policy decision. */
export function decideForField(
  policy: EntityType["review_policy"],
  confidence: number,
  threshold: number,
): "auto_accept" | "review" {
  if (policy === "always_review") return "review";
  if (policy === "auto_accept") return "auto_accept";
  return confidence >= threshold ? "auto_accept" : "review";
}

export function parseStructuredPredictionText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = (fenced?.[1] ?? trimmed).trim();
  if (!fenced) {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }
  }
  return JSON.parse(candidate);
}

export function discardInvalidOptionalBboxes(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  for (const field of Object.values(payload)) {
    if (!field || typeof field !== "object" || Array.isArray(field) || !("bbox" in field)) continue;
    const bbox = (field as Record<string, unknown>).bbox;
    const valid = bbox === null || (
      typeof bbox === "object" && bbox !== null && !Array.isArray(bbox)
      && ["page", "x", "y", "w", "h"].every((key) => typeof (bbox as Record<string, unknown>)[key] === "number")
    );
    if (!valid) delete (field as Record<string, unknown>).bbox;
  }
  return payload;
}

export function estimateAidpInputTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export async function extractAidpPdfText(bytes: Uint8Array): Promise<{
  pageCount: number;
  text: string;
}> {
  const { extractPdfTextWithService } = await import("@/lib/aidp-document-service.server");
  return extractPdfTextWithService(bytes);
}

export async function callPredictionModel(
  resolved: ResolvedModel,
  entityTypes: EntityType[],
  pages: Array<{ image_uri: string; page_index: number }>,
  signFn: (uri: string) => Promise<string>,
): Promise<{ results: Record<string, { value: unknown; confidence: number; bbox?: any }>; tokens_in: number; tokens_out: number; latency_ms: number }> {
  const schema = buildPredictionSchema(entityTypes);
  const signedUrls = await Promise.all(pages.map(p => signFn(p.image_uri)));
  const system = `You are an information extraction assistant for financial reconciliation documents.
For each provided page image, extract the requested fields. Return a single JSON object with one key per field:
${entityTypes.map(et => `- ${et.key} (${et.datatype}): ${et.label}`).join("\n")}
For each key return { value, confidence (0..1), bbox? }. Use null when the field is not present.`;
  const userContent: any[] = [];
  const validatedAnthropicSources: Array<{ url: string; mediaType: string; text?: string }> = [];
  for (const url of signedUrls) {
    if (resolved.provider === "anthropic") {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`AIDP page fetch failed with status ${response.status}`);
      const mediaType = (response.headers.get("content-type") || "").split(";")[0].trim();
      if (!["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(mediaType)) {
        throw new Error(`Unsupported AIDP page media type: ${mediaType || "missing"}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("AIDP page exceeds 20 MiB");
      const pdfText = mediaType === "application/pdf"
        ? (await extractAidpPdfText(bytes)).text
        : undefined;
      validatedAnthropicSources.push({ url, mediaType, text: pdfText });
      if (mediaType.startsWith("image/")) userContent.push({ type: "image", image: bytes, mediaType });
      else userContent.push({ type: "file", data: bytes, mediaType });
    } else {
      userContent.push({ type: "image", image: url });
    }
  }
  // Keep the instruction after the attachments. Some Muse-compatible
  // proxies truncate multimodal content after the first text part, while all
  // supported native providers accept image-first message content.
  userContent.push({ type: "text", text: "Extract fields from these pages." });

  const startedAt = Date.now();
  const { createTrace } = await import("@/lib/observability.server");
  const trace = createTrace("aidp.predict", {
    provider: String(resolved.provider ?? "unknown"),
    model: String((resolved as { model?: string }).model ?? "unknown"),
  });
  if (resolved.provider === "anthropic" && resolved.api_key && resolved.base_url) {
    try {
      const endpoint = `${resolved.base_url.replace(/\/+$/, "")}/messages`;
      await assertSafeOutboundUrl(endpoint);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": resolved.api_key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: resolved.model,
          max_tokens: 4096,
          system,
          messages: [{
            role: "user",
            content: [
              ...validatedAnthropicSources.map(({ url, mediaType, text }) =>
                mediaType === "application/pdf"
                  ? { type: "text", text: `<document-text>\n${text}\n</document-text>` }
                  : { type: "image", source: { type: "url", url } }),
              { type: "text", text: "Extract fields from these pages." },
            ],
          }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Anthropic AIDP request failed with status ${response.status}`);
      const raw = await response.text();
      if (raw.length > 2 * 1024 * 1024) throw new Error("Anthropic AIDP response exceeds 2 MiB");
      const envelope = JSON.parse(raw) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = envelope.content?.find((part) => part.type === "text")?.text;
      if (!text) throw new Error("Anthropic AIDP response did not contain text");
      const results = schema.parse(discardInvalidOptionalBboxes(parseStructuredPredictionText(text)));
      const latency_ms = Date.now() - startedAt;
      const reportedInputTokens = envelope.usage?.input_tokens ?? 0;
      const meteredText = [system, ...validatedAnthropicSources.map((source) => source.text ?? "")].join("\n");
      const tokens_in = reportedInputTokens > 1
        ? reportedInputTokens
        : estimateAidpInputTokens(meteredText);
      const tokens_out = envelope.usage?.output_tokens ?? 0;
      trace.end("ok", { tokens_in, tokens_out, native_anthropic: true });
      return { results, tokens_in, tokens_out, latency_ms };
    } catch (err) {
      trace.end("error");
      throw err;
    }
  }

  const model = buildModelHandle(resolved);
  try {
    const out = await generateObject({
      model: model as any,
      schema,
      system,
      messages: [{ role: "user", content: userContent as any }],
      temperature: 0,
      abortSignal: AbortSignal.timeout(30_000),
    } as any);
    const latency_ms = Date.now() - startedAt;
    const tokens_in = (out as any).usage?.promptTokens ?? 0;
    const tokens_out = (out as any).usage?.completionTokens ?? 0;
    trace.end("ok", { tokens_in, tokens_out });
    return { results: out.object as any, tokens_in, tokens_out, latency_ms };
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err) && err.text) {
      const recovered = schema.safeParse(discardInvalidOptionalBboxes(parseStructuredPredictionText(err.text)));
      if (recovered.success) {
        const latency_ms = Date.now() - startedAt;
        const usage = err.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        const tokens_in = usage?.inputTokens ?? 0;
        const tokens_out = usage?.outputTokens ?? 0;
        trace.end("ok", { tokens_in, tokens_out, recovered_json_fence: true });
        return { results: recovered.data as any, tokens_in, tokens_out, latency_ms };
      }
    }
    trace.end("error");
    throw err;
  }
}
