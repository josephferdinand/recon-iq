// Server route: OAuth2 Client-Credentials token endpoint for the developer
// portal API sandbox.
//
//   POST /api/public/oauth/token
//   Accepts application/x-www-form-urlencoded OR application/json
//   Body: { grant_type: "client_credentials", client_id, client_secret,
//           scope?: "read write" }
//   Response 200:
//   { access_token, token_type: "Bearer", expires_in: 3600, scope }
//
// The access token is a compact HS256 JWT signed with SANDBOX_JWT_SIGNING_SECRET.
// It is *not* a Supabase session; it is verified by the sandbox proxy only
// and never reaches the wider platform.
import { createFileRoute } from "@tanstack/react-router";
import { signSandboxJwt } from "@/lib/sandbox-jwt.server";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";

const ALLOWED_SCOPES = new Set(["read", "write"]);
const DEFAULT_TTL_SECONDS = 3600;

function getRuntimeSigningSecret(): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return (
    runtime.process?.env?.SANDBOX_JWT_SIGNING_SECRET ??
    runtime.process?.env?.SANDBOX_JWT_SECRET
  );
}


function jsonError(
  status: number,
  error: string,
  description: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

async function readCredentials(request: Request): Promise<{ grant_type?: string; client_id?: string; client_secret?: string; scope?: string }> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try { return await request.json(); } catch { return {}; }
  }
  const text = await request.text();
  const params = new URLSearchParams(text);
  return {
    grant_type: params.get("grant_type") ?? undefined,
    client_id: params.get("client_id") ?? undefined,
    client_secret: params.get("client_secret") ?? undefined,
    scope: params.get("scope") ?? undefined,
  };
}

export const Route = createFileRoute("/api/public/oauth/token")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));
        const headers: Record<string, string> = {
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
          "access-control-max-age": "86400",
        };
        if (origin) headers["access-control-allow-origin"] = origin;
        return new Response(null, { status: 204, headers });
      },
      POST: async ({ request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));
        const corsHeader: Record<string, string> = origin ? { "access-control-allow-origin": origin } : {};
        // HTTP Basic client auth is also common — RFC 6749 §2.3.1.
        const auth = request.headers.get("authorization");
        let basicId: string | undefined;
        let basicSecret: string | undefined;
        if (auth?.toLowerCase().startsWith("basic ")) {
          try {
            const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
            const idx = decoded.indexOf(":");
            if (idx > 0) { basicId = decoded.slice(0, idx); basicSecret = decoded.slice(idx + 1); }
          } catch { /* fall through */ }
        }

        const body = await readCredentials(request);
        const grantType = body.grant_type;
        const clientId = basicId ?? body.client_id;
        const clientSecret = basicSecret ?? body.client_secret;
        const requestedScope = (body.scope ?? "read").split(/\s+/).filter(Boolean);

        if (grantType !== "client_credentials") return jsonError(400, "unsupported_grant_type", "Only client_credentials is supported", corsHeader);
        if (!clientId || !clientSecret) return jsonError(400, "invalid_request", "client_id and client_secret are required", corsHeader);
        for (const s of requestedScope) if (!ALLOWED_SCOPES.has(s)) return jsonError(400, "invalid_scope", `Unknown scope: ${s}`, corsHeader);

        // Resolve signing material only after the request contract is valid so
        // malformed public requests never surface as infrastructure failures.
        // The alias remains for one release while environments converge.
        const secret = getRuntimeSigningSecret();
        if (!secret) {
          console.error("[oauth/token] Missing signing secret. Checked SANDBOX_JWT_SIGNING_SECRET and SANDBOX_JWT_SECRET.");
          return jsonError(
            503,
            "temporarily_unavailable",
            "OAuth token issuance is temporarily unavailable",
            { "retry-after": "300", ...corsHeader },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("verify_sandbox_client_secret", {
          _client_id: clientId,
          _plain_secret: clientSecret,
        });
        if (error || !data || data.length === 0) return jsonError(401, "invalid_client", "Client authentication failed", corsHeader);

        const row = data[0] as { id: string; created_by: string; allowed_scopes: string[] };
        const denied = requestedScope.filter((s) => !row.allowed_scopes.includes(s));
        if (denied.length > 0) return jsonError(400, "invalid_scope", `Scope(s) not permitted for this client: ${denied.join(",")}`, corsHeader);

        // Fire-and-forget last_used bookkeeping.
        void supabaseAdmin.from("sandbox_oauth_clients").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

        const now = Math.floor(Date.now() / 1000);
        const token = signSandboxJwt({
          iss: "fvi-sandbox",
          sub: `client:${clientId}`,
          aud: "fvi-sandbox",
          scope: requestedScope.join(" "),
          client_id: clientId,
          owner_user_id: row.created_by,
          iat: now,
          exp: now + DEFAULT_TTL_SECONDS,
          jti: crypto.randomUUID(),
        }, secret);

        return new Response(
          JSON.stringify({
            access_token: token,
            token_type: "Bearer",
            expires_in: DEFAULT_TTL_SECONDS,
            scope: requestedScope.join(" "),
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
              "pragma": "no-cache",
              ...corsHeader,
            },
          },
        );
      },
    },
  },
});
