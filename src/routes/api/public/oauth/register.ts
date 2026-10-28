import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MCP_SCOPES, oauthError, oauthJson, parseScopes, randomOpaqueToken, sha256, validateRedirectUri } from "@/lib/mcp-oauth.server";

const registration = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.string()).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

export const Route = createFileRoute("/api/public/oauth/register")({
  server: { handlers: {
    GET: async ({ request }) => {
      const url = new URL(request.url);
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      if (!clientId || !redirectUri) return oauthError(400, "invalid_request", "client_id and redirect_uri are required");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Generated Supabase types are refreshed only after this migration is applied.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = supabaseAdmin as any;
      const { data: client } = await admin.from("mcp_oauth_clients")
        .select("client_name,redirect_uris,allowed_scopes,active").eq("client_id", clientId).maybeSingle();
      if (!client?.active || !client.redirect_uris.includes(redirectUri)) {
        return oauthError(400, "invalid_request", "Client or redirect URI is not registered");
      }
      return oauthJson(200, { client_name: client.client_name, allowed_scopes: client.allowed_scopes });
    },
    POST: async ({ request }) => {
    let parsed: z.infer<typeof registration>;
    try { parsed = registration.parse(await request.json()); }
    catch { return oauthError(400, "invalid_client_metadata", "Registration metadata is invalid"); }

    if (!parsed.redirect_uris.every(validateRedirectUri)) {
      return oauthError(400, "invalid_redirect_uri", "Redirect URIs must use HTTPS or an HTTP loopback address");
    }
    if (parsed.grant_types?.some((grant) => !["authorization_code", "refresh_token"].includes(grant))) {
      return oauthError(400, "invalid_client_metadata", "Only authorization_code and refresh_token grants are supported");
    }
    if (parsed.response_types?.some((type) => type !== "code")) {
      return oauthError(400, "invalid_client_metadata", "Only the code response type is supported");
    }
    const scopes = parsed.scope ? parseScopes(parsed.scope) : [...MCP_SCOPES];
    if (!scopes.length || scopes.some((scope) => !(MCP_SCOPES as readonly string[]).includes(scope))) {
      return oauthError(400, "invalid_client_metadata", "Requested registration scope is not supported");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Generated Supabase types are refreshed only after this migration is applied.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { data: rate, error: rateError } = await admin.rpc("rate_limit_hit", {
      _key: `mcp-oauth-register:${sha256(address)}`,
      _window_seconds: 60,
      _limit: 20,
    });
    const decision = Array.isArray(rate) ? rate[0] : rate;
    if (rateError) return oauthError(503, "temporarily_unavailable", "Client registration is temporarily unavailable");
    if (!decision?.allowed) {
      const retryAfter = Number(decision?.retry_after_seconds ?? 60);
      return new Response(JSON.stringify({ error: "rate_limit_exceeded", error_description: "Too many registration requests" }), {
        status: 429,
        headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": String(retryAfter) },
      });
    }
    const clientId = randomOpaqueToken("fvi_mcp_client");
    const { error } = await admin.from("mcp_oauth_clients").insert({
      client_id: clientId,
      client_name: parsed.client_name,
      redirect_uris: parsed.redirect_uris,
      allowed_scopes: scopes,
    });
    if (error) return oauthError(503, "temporarily_unavailable", "Client registration is temporarily unavailable");

    return oauthJson(201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: parsed.client_name,
      redirect_uris: parsed.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: scopes.join(" "),
    });
  } } },
});
