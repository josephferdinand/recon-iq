/** Direct Meta Muse transport. Credentials stay on the server. */
export const MUSE_BASE_URL = 'https://api.meta.ai/v1';
export const MUSE_DEFAULT_MODEL = 'muse-spark-1.3';
export const AI_PROXY_DEFAULT_MODEL = 'claude-opus-5-5';
export type AiProxyConfig = { baseUrl: string; apiKey: string; model: string; fallbackModels: string[] };
type Options = { apiKey?: string; headers?: Record<string, string>; baseURL?: string; fetch?: typeof fetch; name?: string; proxy?: boolean };
const env = () => (typeof process === 'undefined' ? {} : process.env);
const PROXY_MODEL_RE = /^[a-z0-9][a-z0-9._/-]{0,119}$/i;
export function isProxyModelId(value?: string | null): boolean {
  const v = (value || '').trim();
  return !!v && PROXY_MODEL_RE.test(v) && !v.includes('..') && !/^muse-/i.test(v);
}
function normalizeProxyBase(input?: string | null): string | null {
  if (!input?.trim()) return null;
  try {
    const u = new URL(input.trim());
    if (u.username || u.password || u.search || u.hash) return null;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(u.hostname))) return null;
    u.pathname = u.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|completions|messages|responses|embeddings)$/i, '');
    return u.toString().replace(/\/+$/, '');
  } catch { return null; }
}
/** Proxy is opt-in: BOTH server-only env names must be set. Meta stays the default otherwise. */
export function getAiProxyConfig(): AiProxyConfig | null {
  const e = env();
  const baseRaw = e.AI_API_BASE_URL?.trim();
  const key = e.AI_API_KEY?.trim();
  if (!baseRaw || !key || /^YOUR_|^REPLACE_/i.test(key)) return null;
  const baseUrl = normalizeProxyBase(baseRaw);
  if (!baseUrl) return null;
  const primary = (e.AI_MODEL || '').trim();
  const model = isProxyModelId(primary) ? primary : AI_PROXY_DEFAULT_MODEL;
  const fallbackModels = (e.AI_FALLBACK_MODELS || '').split(',').map((s) => s.trim())
    .filter((m, i, a) => isProxyModelId(m) && m !== model && a.indexOf(m) === i).slice(0, 3);
  return { baseUrl, apiKey: key, model, fallbackModels };
}
export const isAiProxyConfigured = (): boolean => getAiProxyConfig() !== null;
export function proxyModelCandidates(requested: string | undefined, cfg: AiProxyConfig): string[] {
  const first = isProxyModelId(requested) ? (requested as string).trim() : cfg.model;
  return [first, cfg.model, ...cfg.fallbackModels].filter((m, i, a) => a.indexOf(m) === i).slice(0, 4);
}

function modelName(requested?: string): string {
  const configured = env().META_MUSE_MODEL || requested;
  return configured && /^muse-[a-z0-9._-]+$/i.test(configured) ? configured : MUSE_DEFAULT_MODEL;
}
function messages(prompt: any[]): any[] {
  return prompt.flatMap((message: any) => {
    if (typeof message.content === 'string') return [{ role: message.role, content: message.content }];
    const parts = Array.isArray(message.content) ? message.content : [];
    if (message.role === 'tool') return parts.map((part: any) => ({
      role: 'tool', tool_call_id: part.toolCallId,
      content: typeof part.output?.value === 'string' ? part.output.value : JSON.stringify(part.output?.value ?? part.output ?? part.result ?? null),
    }));
    const calls = parts.filter((part: any) => part.type === 'tool-call').map((part: any) => ({
      id: part.toolCallId, type: 'function',
      function: { name: part.toolName, arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? part.args ?? {}) },
    }));
    const content = parts.filter((part: any) => !['tool-call', 'reasoning'].includes(part.type)).map((part: any) => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      if (part.type === 'image' || (part.type === 'file' && String(part.mediaType).startsWith('image/'))) {
        const data = part.image ?? part.data;
        let url: string;
        if (data instanceof URL) url = data.toString();
        else if (typeof data === 'string') url = data;
        else if (data instanceof Uint8Array) url = 'data:' + (part.mediaType || 'image/png') + ';base64,' + Buffer.from(data).toString('base64');
        else throw new Error('This image cannot be sent to Muse. Upload a supported image again.');
        return { type: 'image_url', image_url: { url } };
      }
      throw new Error('This attachment is not supported by the Muse chat transport. Extract the document into structured text first.');
    });
    return [{ role: message.role, content: content.length ? content : null, ...(calls.length ? { tool_calls: calls } : {}) }];
  });
}
function usage(value: any) {
  return {
    inputTokens: { total: value?.prompt_tokens, noCache: undefined, cacheRead: value?.prompt_tokens_details?.cached_tokens, cacheWrite: undefined },
    outputTokens: { total: value?.completion_tokens, text: undefined, reasoning: value?.completion_tokens_details?.reasoning_tokens },
    raw: value,
  };
}
function finish(raw: string | null) {
  return { unified: raw === 'tool_calls' ? 'tool-calls' : raw === 'length' ? 'length' : raw === 'content_filter' ? 'content-filter' : raw === 'stop' ? 'stop' : 'other', raw: raw ?? undefined };
}
function handle(options: Options, requested?: string): any {
  const proxyCfg = getAiProxyConfig();
  const optBase = options.baseURL ? options.baseURL.replace(/\/+$/, '').replace(/\/(chat\/completions|completions|messages|responses|embeddings)$/i, '') : null;
  // Proxy only when explicitly flagged, unpinned, or pinned to the configured proxy base.
  // An explicit Meta base pin (model-factory) stays Meta unless the caller flags proxy.
  const useProxy = options.proxy === true || (!!proxyCfg && (!options.baseURL || optBase === proxyCfg.baseUrl));
  const candidates = useProxy && proxyCfg ? proxyModelCandidates(requested, proxyCfg) : null;
  const modelId = candidates ? candidates[0] : modelName(requested);
  const requestOnce = async (base: string, key: string, model: string, label: string, call: any) => {
    const body: any = { model, messages: messages(call.prompt || []), stream: false };
    if (call.temperature != null) body.temperature = call.temperature;
    if (call.maxOutputTokens != null) body.max_completion_tokens = call.maxOutputTokens;
    if (call.topP != null) body.top_p = call.topP;
    if (call.stopSequences?.length) body.stop = call.stopSequences;
    if (call.responseFormat?.type === 'json') body.response_format = call.responseFormat.schema
      ? { type: 'json_schema', json_schema: { name: call.responseFormat.name || 'result', schema: call.responseFormat.schema, strict: true } }
      : { type: 'json_object' };
    if (call.tools?.length) body.tools = call.tools.map((tool: any) => {
      if (tool.type !== 'function') throw new Error('This tool type is not supported by the Muse adapter.');
      return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } };
    });
    if (call.toolChoice) body.tool_choice = call.toolChoice.type === 'tool'
      ? { type: 'function', function: { name: call.toolChoice.toolName } }
      : call.toolChoice.type;
    const controller = call.abortSignal ? undefined : AbortSignal.timeout(60000);
    const response = await (options.fetch || fetch)(base + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(body), signal: call.abortSignal || controller,
    });
    if (!response.ok) {
      const err: any = new Error(label + ' request was declined (HTTP ' + response.status + '). Check your model access and server configuration.');
      err.status = response.status;
      throw err;
    }
    const value = await response.json();
    const choice = value.choices?.[0];
    if (!choice?.message) throw new Error(label + ' returned no message. Try again or choose a model available to your account.');
    const content: any[] = [];
    if (typeof choice.message.content === 'string' && choice.message.content) content.push({ type: 'text', text: choice.message.content });
    for (const tool of choice.message.tool_calls || []) content.push({ type: 'tool-call', toolCallId: tool.id, toolName: tool.function.name, input: tool.function.arguments });
    return {
      content, finishReason: finish(choice.finish_reason), usage: usage(value.usage), warnings: [],
      response: { id: value.id, modelId: value.model || model, timestamp: value.created ? new Date(value.created * 1000) : undefined },
    };
  };
  const generate = async (call: any) => {
    if (useProxy) {
      const cfg = proxyCfg || (() => {
        const baseUrl = normalizeProxyBase(options.baseURL);
        const key = options.apiKey || options.headers?.Authorization?.replace(/^Bearer\s+/i, '');
        return baseUrl && key && !/^YOUR_|^REPLACE_/i.test(key)
          ? { baseUrl, apiKey: key, model: isProxyModelId(requested) ? (requested as string).trim() : AI_PROXY_DEFAULT_MODEL, fallbackModels: [] as string[] }
          : null;
      })();
      if (!cfg) throw new Error('Configure the AI proxy server settings before using AI.');
      const models = candidates || proxyModelCandidates(requested, cfg);
      let lastStatus: number | undefined;
      for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try { return await requestOnce(cfg.baseUrl, cfg.apiKey, model, 'AI proxy', call); }
          catch (e: any) {
            if (call.abortSignal?.aborted) throw e;
            lastStatus = typeof e?.status === 'number' ? e.status : undefined;
            if (lastStatus === 401 || lastStatus === 403) throw e;
            const retryable = lastStatus === undefined || [408, 429, 500, 502, 503, 504].includes(lastStatus);
            if (retryable && attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
            break;
          }
        }
      }
      throw new Error(lastStatus
        ? 'AI proxy request was declined (HTTP ' + lastStatus + '). Check your model access and server configuration.'
        : 'AI proxy request failed. Check your server configuration and try again.');
    }
    const base = (options.baseURL || env().META_API_BASE_URL || MUSE_BASE_URL).replace(/\/+$/, '');
    if (base !== MUSE_BASE_URL) throw new Error('Configure the documented Meta endpoint before using Muse.');
    const key = env().META_API_KEY || options.apiKey || options.headers?.Authorization?.replace(/^Bearer\s+/i, '');
    if (!key || /^YOUR_|^REPLACE_/i.test(key)) throw new Error('Add your own Meta API key to the server secrets before using AI.');
    return requestOnce(base, key, modelId, 'Muse', call);
  };
  return {
    specificationVersion: 'v4' as const, provider: useProxy ? 'ai-proxy' : 'meta.muse', modelId, supportedUrls: {},
    doGenerate: generate,
    async doStream(call: any) {
      // Buffered delivery preserves the SDK stream contract; native token streaming is not claimed.
      const value = await generate(call);
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', ...value.response });
        for (const [index, part] of value.content.entries()) {
          if (part.type === 'text') {
            const id = 'muse-text-' + index;
            controller.enqueue({ type: 'text-start', id });
            controller.enqueue({ type: 'text-delta', id, delta: part.text });
            controller.enqueue({ type: 'text-end', id });
          } else controller.enqueue(part);
        }
        controller.enqueue({ type: 'finish', finishReason: value.finishReason, usage: value.usage });
        controller.close();
      } }) };
    },
  };
}
export function createMuseCompatible(options: Options = {}): any {
  const provider: any = (id?: string) => handle(options, id);
  provider.languageModel = provider; provider.chatModel = provider; provider.chat = provider; provider.responses = provider;
  return provider;
}
export const createMuse = createMuseCompatible;
// Legacy constructor call sites are routed to the same direct Meta transport in this export.
export const createAnthropic = createMuseCompatible;
