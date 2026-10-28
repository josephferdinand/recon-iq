export type FviClaims = {
  tenantSlug: string;
  subject: string;
  scopes: string[];
  expiresAt: string | null;
};

export type FviConfig = {
  apiOrigin: string;
  mcpOrigin: string;
  oauthIssuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
};

type FviErrorPayload = { error?: string; retry_after_seconds?: number };

export class FviApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) {
    super(code);
    this.name = "FviApiError";
  }
}

function absoluteUrl(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${name} must use HTTPS`);
  }
  return url.href.replace(/\/$/u, "");
}

export function readFviConfig(env: NodeJS.ProcessEnv = process.env): FviConfig {
  return {
    apiOrigin: absoluteUrl("FVI_API_ORIGIN", env.FVI_API_ORIGIN),
    mcpOrigin: absoluteUrl("MCP_PUBLIC_ORIGIN", env.MCP_PUBLIC_ORIGIN),
    oauthIssuer: absoluteUrl("MCP_OAUTH_ISSUER", env.MCP_OAUTH_ISSUER),
    authorizationEndpoint: absoluteUrl("MCP_OAUTH_AUTHORIZATION_ENDPOINT", env.MCP_OAUTH_AUTHORIZATION_ENDPOINT ?? `${env.MCP_OAUTH_ISSUER}/oauth/authorize`),
    tokenEndpoint: absoluteUrl("MCP_OAUTH_TOKEN_ENDPOINT", env.MCP_OAUTH_TOKEN_ENDPOINT ?? `${env.MCP_OAUTH_ISSUER}/api/public/oauth/mcp-token`),
    registrationEndpoint: absoluteUrl("MCP_OAUTH_REGISTRATION_ENDPOINT", env.MCP_OAUTH_REGISTRATION_ENDPOINT ?? `${env.MCP_OAUTH_ISSUER}/api/public/oauth/register`),
  };
}

async function parseError(response: Response): Promise<FviApiError> {
  let payload: FviErrorPayload = {};
  try { payload = (await response.json()) as FviErrorPayload; } catch { /* never surface raw bodies */ }
  const retryHeader = Number(response.headers.get("retry-after"));
  return new FviApiError(
    response.status,
    payload.error ?? `upstream_${response.status}`,
    Number.isFinite(retryHeader) ? retryHeader : payload.retry_after_seconds,
  );
}

export async function introspectFviToken(
  config: Pick<FviConfig, "apiOrigin">,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<FviClaims> {
  const response = await fetcher(`${config.apiOrigin}/api/public/tokens/introspect`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as {
    active?: boolean; tenant_slug?: string; subject?: string; scopes?: string[]; expires_at?: string | null;
  };
  if (!body.active || !body.tenant_slug || !body.subject || !Array.isArray(body.scopes)) {
    throw new FviApiError(401, "invalid_token_claims");
  }
  return { tenantSlug: body.tenant_slug, subject: body.subject, scopes: body.scopes, expiresAt: body.expires_at ?? null };
}

export async function callFviApi<T>(args: {
  config: Pick<FviConfig, "apiOrigin">;
  token: string;
  tenantSlug: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
  accept?: string;
  fetcher?: typeof fetch;
}): Promise<T> {
  if (!args.path.startsWith("/api/")) throw new Error("Only canonical FVI API paths are allowed");
  const requestId = crypto.randomUUID();
  const response = await (args.fetcher ?? fetch)(`${args.config.apiOrigin}${args.path}`, {
    method: args.method ?? "GET",
    headers: {
      authorization: `Bearer ${args.token}`,
      accept: args.accept ?? "application/json",
      ...(args.body === undefined ? {} : { "content-type": "application/json" }),
      ...(args.idempotencyKey ? { "idempotency-key": args.idempotencyKey } : {}),
      "x-fvi-client": "mcp-gateway-v1",
      "x-fvi-request-id": requestId,
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await parseError(response);
  if ((response.headers.get("content-type") ?? "").includes("text/csv")) {
    const text = await response.text();
    if (text.length > 2_000_000) throw new FviApiError(413, "report_too_large");
    return text as T;
  }
  return (await response.json()) as T;
}

export function requireTenant(tenantSlug: string, claims: FviClaims | undefined): asserts claims is FviClaims {
  if (!claims) throw new FviApiError(401, "authentication_required");
  if (claims.tenantSlug !== tenantSlug) throw new FviApiError(403, "tenant_scope_mismatch");
}

export function safeToolError(error: unknown) {
  if (error instanceof FviApiError) {
    return { code: error.code, status: error.status, ...(error.retryAfter ? { retry_after_seconds: error.retryAfter } : {}) };
  }
  return { code: "gateway_unavailable", status: 503 };
}
