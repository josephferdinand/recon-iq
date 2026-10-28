import { createFileRoute } from "@tanstack/react-router";
import { oauthError, oauthJson, pkceChallenge, randomOpaqueToken, sha256 } from "@/lib/mcp-oauth.server";

const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 86_400_000;

async function readBody(request: Request) {
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    try { return await request.json() as Record<string, string>; } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(await request.text()).entries());
}

function tokenMaterial() {
  const accessToken = randomOpaqueToken("fvi_mcp");
  const refreshToken = randomOpaqueToken("fvi_mcp_refresh");
  return {
    accessToken, refreshToken,
    accessHash: sha256(accessToken), accessPrefix: accessToken.slice(0, 12),
    refreshHash: sha256(refreshToken),
    accessExpiry: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
    refreshExpiry: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
  };
}

export const Route = createFileRoute("/api/public/oauth/mcp-token")({
  server: { handlers: { POST: async ({ request }) => {
    const body = await readBody(request);
    if (!body.client_id) return oauthError(400, "invalid_request", "client_id is required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Generated Supabase types are refreshed only after this migration is applied.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { data: rate, error: rateError } = await admin.rpc("rate_limit_hit", {
      _key: `mcp-oauth-token:${sha256(`${body.client_id}:${address}`)}`,
      _window_seconds: 60,
      _limit: 60,
    });
    const decision = Array.isArray(rate) ? rate[0] : rate;
    if (rateError) return oauthError(503, "temporarily_unavailable", "Token issuance is temporarily unavailable");
    if (!decision?.allowed) {
      const retryAfter = Number(decision?.retry_after_seconds ?? 60);
      return new Response(JSON.stringify({ error: "rate_limit_exceeded", error_description: "Too many token requests" }), {
        status: 429,
        headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": String(retryAfter) },
      });
    }
    const { data: client } = await admin.from("mcp_oauth_clients")
      .select("client_id,active").eq("client_id", body.client_id).maybeSingle();
    if (!client?.active) return oauthError(401, "invalid_client", "The OAuth client is invalid");

    const material = tokenMaterial();
    let result: unknown;
    let rpcError: { message?: string } | null = null;
    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.redirect_uri || !body.code_verifier) {
        return oauthError(400, "invalid_request", "code, redirect_uri and code_verifier are required");
      }
      const challenge = await pkceChallenge(body.code_verifier);
      ({ data: result, error: rpcError } = await admin.rpc("exchange_mcp_oauth_code", {
        _code_hash: sha256(body.code), _client_id: body.client_id, _redirect_uri: body.redirect_uri,
        _code_challenge: challenge, _access_hash: material.accessHash, _access_prefix: material.accessPrefix,
        _refresh_hash: material.refreshHash, _access_expires_at: material.accessExpiry,
        _refresh_expires_at: material.refreshExpiry,
      }));
    } else if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) return oauthError(400, "invalid_request", "refresh_token is required");
      ({ data: result, error: rpcError } = await admin.rpc("rotate_mcp_oauth_refresh_token", {
        _refresh_hash: sha256(body.refresh_token), _client_id: body.client_id,
        _new_access_hash: material.accessHash, _new_access_prefix: material.accessPrefix,
        _new_refresh_hash: material.refreshHash, _access_expires_at: material.accessExpiry,
        _refresh_expires_at: material.refreshExpiry,
      }));
    } else {
      return oauthError(400, "unsupported_grant_type", "Only authorization_code and refresh_token are supported");
    }
    if (rpcError) {
      return rpcError.message?.includes("invalid_grant")
        ? oauthError(400, "invalid_grant", "The grant is invalid, expired or already used")
        : oauthError(503, "temporarily_unavailable", "Token issuance is temporarily unavailable");
    }
    const issued = (Array.isArray(result) ? result[0] : result) as { scopes?: string[]; resource?: string | null } | null;
    if (!issued?.scopes) return oauthError(400, "invalid_grant", "The grant is invalid, expired or already used");
    return oauthJson(200, {
      access_token: material.accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: material.refreshToken, scope: issued.scopes.join(" "),
      ...(issued.resource ? { resource: issued.resource } : {}),
    });
  } } },
});
