// Shared LLM upstream probe — server-only. Used by both llm.functions.ts
// (provider "Test") and vault.functions.ts (rotation verification).
export type LlmProbeResult = {
  ok: boolean;
  latency_ms: number;
  http_status?: number;
  error?: string;
};

function normalizeProbeBaseUrl(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  let u = input.trim();
  if (!u) return undefined;
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/(chat\/completions|completions|messages|responses|embeddings)$/i, "");
  return u.replace(/\/+$/, "");
}

function isNativeProviderHost(provider: string, baseUrl: string | undefined): boolean {
  if (!baseUrl) return true;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (provider === "anthropic") return host === "api.anthropic.com" || host.endsWith(".api.anthropic.com");
    if (provider === "muse") return host === "api.meta.ai" || host.endsWith(".api.meta.ai");
  } catch {
    return false;
  }
  return false;
}

function formatProbeError(status: number, statusText: string, contentType: string, url: string, body: string): string {
  const safeUrl = url.split("?")[0];
  const snippet = body.replace(/\s+/g, " ").slice(0, 300);
  const cause =
    status === 401 || status === 403
      ? "API key rejected by gateway/provider"
      : status === 404
        ? "base_url is not the gateway root or endpoint is not Muse-compatible"
        : "gateway returned a non-success or non-JSON response";
  return `HTTP ${status} ${statusText} from ${safeUrl}; content-type=${contentType || "none"}; ${cause}; body=${snippet || "(empty)"}`;
}

export async function probeLlmKey(
  provider: string,
  base_url: string | null,
  model: string,
  api_key: string,
): Promise<LlmProbeResult> {
  const started = Date.now();
  try {
    let url = "";
    const headers: Record<string, string> = { "content-type": "application/json" };
    let body: any;
    const museCompat = (b: string) => {
      url = (normalizeProbeBaseUrl(b) ?? b.replace(/\/$/, "")) + "/chat/completions";
      headers.authorization = `Bearer ${api_key}`;
      body = { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] };
    };
    const normalizedBase = normalizeProbeBaseUrl(base_url);
    switch (provider) {
      case "anthropic":
        if (isNativeProviderHost(provider, normalizedBase)) {
          url = (normalizedBase ?? "https://api.anthropic.com") + "/v1/messages";
          headers["x-api-key"] = api_key;
          headers["anthropic-version"] = "2023-06-01";
          body = { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] };
        } else {
          museCompat(normalizedBase!);
        }
        break;
      case "muse":     museCompat(normalizedBase || "https://api.meta.ai/v1"); break;
      case "groq":       museCompat(normalizedBase || "https://api.groq.com/muse/v1"); break;
      case "perplexity": museCompat(normalizedBase || "https://api.perplexity.ai"); break;
      case "deepseek":   museCompat(normalizedBase || "https://api.deepseek.com/v1"); break;
      case "xai":        museCompat(normalizedBase || "https://api.x.ai/v1"); break;
      case "mistral":    museCompat(normalizedBase || "https://api.mistral.ai/v1"); break;
      case "cohere":
        url = (normalizedBase ?? "https://api.cohere.ai") + "/v1/chat";
        headers.authorization = `Bearer ${api_key}`;
        body = { model, message: "ping", max_tokens: 8 };
        break;
      case "google":
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(api_key)}`;
        body = { contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 8 } };
        break;
      case "meta":
        url = "https://api.meta.ai/v1/chat/completions";
        headers["Meta-API-Key"] = api_key;
        body = { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] };
        break;
      case "custom_muse_compatible":
        if (!base_url) return { ok: false, latency_ms: 0, error: "Base URL required for custom provider" };
        museCompat(normalizedBase!);
        break;
      default:
        return { ok: false, latency_ms: 0, error: `Unknown provider ${provider}` };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timer);
    const latency = Date.now() - started;
    const contentType = r.headers.get("content-type") || "";
    const responseText = await r.text().catch(() => "");
    if (!r.ok) {
      return { ok: false, latency_ms: latency, http_status: r.status, error: formatProbeError(r.status, r.statusText, contentType, url, responseText) };
    }
    if (!contentType.includes("application/json") && !contentType.includes("+json")) {
      return { ok: false, latency_ms: latency, http_status: r.status, error: formatProbeError(r.status, r.statusText, contentType, url, responseText) };
    }
    try {
      JSON.parse(responseText);
    } catch {
      return { ok: false, latency_ms: latency, http_status: r.status, error: formatProbeError(r.status, r.statusText, contentType, url, responseText) };
    }
    return { ok: true, latency_ms: latency, http_status: r.status };
  } catch (e: any) {
    return {
      ok: false,
      latency_ms: Date.now() - started,
      error: e?.name === "AbortError" ? "Timed out after 15s" : (e?.message ?? "Network error"),
    };
  }
}
