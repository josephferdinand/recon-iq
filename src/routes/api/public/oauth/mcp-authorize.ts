import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { extractWorkflowBearer } from "@/lib/public-workflow-api.server";
import { oauthError, oauthJson, parseScopes, randomOpaqueToken, scopesAllowedForRole, sha256 } from "@/lib/mcp-oauth.server";

const requestSchema = z.object({
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().url().max(2000),
  scope: z.string().min(1).max(500),
  state: z.string().max(1000).optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  tenant_id: z.string().uuid(),
  resource: z.string().url().max(2000).optional(),
});

export const Route = createFileRoute("/api/public/oauth/mcp-authorize")({
  server: { handlers: {
    GET: async ({ request }) => {
      const bearer = extractWorkflowBearer(request);
      if (!bearer) return oauthError(401, "invalid_token", "A signed-in ReconIQ session is required");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(bearer);
      if (userError || !userData.user) return oauthError(401, "invalid_token", "The ReconIQ session is invalid or expired");
      const { data: memberships, error } = await supabaseAdmin.from("tenant_members")
        .select("tenant_id,role,active,tenants(id,name,slug)")
        .eq("user_id", userData.user.id).eq("active", true);
      if (error) return oauthError(503, "temporarily_unavailable", "Tenant access could not be loaded");
      return oauthJson(200, { memberships: memberships ?? [] });
    },
    POST: async ({ request }) => {
    const bearer = extractWorkflowBearer(request);
    if (!bearer) return oauthError(401, "invalid_token", "A signed-in ReconIQ session is required");
    let input: z.infer<typeof requestSchema>;
    try { input = requestSchema.parse(await request.json()); }
    catch { return oauthError(400, "invalid_request", "Authorization request is invalid"); }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(bearer);
    if (userError || !userData.user) return oauthError(401, "invalid_token", "The ReconIQ session is invalid or expired");
    // Generated Supabase types are refreshed only after this migration is applied.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;

    const { data: client } = await admin.from("mcp_oauth_clients")
      .select("client_id,redirect_uris,allowed_scopes,active")
      .eq("client_id", input.client_id).maybeSingle();
    if (!client?.active || !client.redirect_uris.includes(input.redirect_uri)) {
      return oauthError(400, "invalid_request", "Client or redirect URI is not registered");
    }
    const { data: membership } = await admin.from("tenant_members")
      .select("role,active").eq("tenant_id", input.tenant_id)
      .eq("user_id", userData.user.id).maybeSingle();
    if (!membership?.active) return oauthError(403, "access_denied", "You are not an active member of this tenant");

    const scopes = parseScopes(input.scope);
    if (!scopes.length || scopes.some((scope) => !client.allowed_scopes.includes(scope)) || !scopesAllowedForRole(scopes, membership.role)) {
      return oauthError(400, "invalid_scope", "One or more scopes are not permitted for this tenant role");
    }

    const code = randomOpaqueToken("fvi_mcp_code");
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const { error } = await admin.from("mcp_oauth_authorization_codes").insert({
      code_hash: sha256(code), client_id: input.client_id, tenant_id: input.tenant_id,
      user_id: userData.user.id, redirect_uri: input.redirect_uri, scopes,
      code_challenge: input.code_challenge, resource: input.resource ?? null, expires_at: expiresAt,
    });
    if (error) return oauthError(503, "temporarily_unavailable", "Authorization could not be completed");
    await admin.from("audit_log").insert({
      actor_user_id: userData.user.id, tenant_id: input.tenant_id, scope: "tenant",
      action: "mcp.oauth.authorize", resource_type: "mcp_oauth_client", resource_id: input.client_id,
      context: { scopes, redirect_origin: new URL(input.redirect_uri).origin },
    });

    const redirect = new URL(input.redirect_uri);
    redirect.searchParams.set("code", code);
    if (input.state) redirect.searchParams.set("state", input.state);
    return oauthJson(200, { redirect_to: redirect.toString() });
  } } },
});
