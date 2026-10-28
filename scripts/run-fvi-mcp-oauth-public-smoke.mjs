const origin = (process.env.FVI_MCP_OAUTH_ORIGIN ?? "").replace(/\/$/u, "");
if (!origin.startsWith("https://")) throw new Error("Set FVI_MCP_OAUTH_ORIGIN to an HTTPS origin");
const callback = "http://127.0.0.1:43123/oauth/callback";

async function json(path, init) {
  const response = await fetch(`${origin}${path}`, init);
  let body = {};
  try { body = await response.json(); } catch { /* asserted by caller */ }
  return { status: response.status, body };
}

const invalid = await json("/api/public/oauth/register", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "Invalid redirect probe", redirect_uris: ["http://example.test/callback"] }),
});
if (invalid.status !== 400 || invalid.body.error !== "invalid_redirect_uri") throw new Error("Insecure redirect was not rejected");

const registered = await json("/api/public/oauth/register", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "FVI retained MCP assurance client", redirect_uris: [callback],
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
});
if (registered.status !== 201 || typeof registered.body.client_id !== "string") throw new Error(`Registration failed with ${registered.status}`);

const metadata = await json(`/api/public/oauth/register?client_id=${encodeURIComponent(registered.body.client_id)}&redirect_uri=${encodeURIComponent(callback)}`);
if (metadata.status !== 200 || metadata.body.client_name !== "FVI retained MCP assurance client") throw new Error("Client metadata readback failed");

const unauthenticated = await json("/api/public/oauth/mcp-authorize", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
});
if (unauthenticated.status !== 401 || unauthenticated.body.error !== "invalid_token") throw new Error("Authorization did not fail closed");

const noClient = await json("/api/public/oauth/mcp-token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code" }) });
if (noClient.status !== 400 || noClient.body.error !== "invalid_request") throw new Error("Token endpoint missing-client control failed");

const unknown = await json("/api/public/oauth/mcp-token", {
  method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", client_id: "unknown" }),
});
if (unknown.status !== 401 || unknown.body.error !== "invalid_client") throw new Error("Unknown OAuth client was not rejected");

console.log(JSON.stringify({ ok: true, origin, client_id: registered.body.client_id, registration: 201, metadata: 200,
  insecure_redirect: 400, unauthenticated_authorize: 401, missing_client: 400, unknown_client: 401 }));
