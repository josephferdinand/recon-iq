import { createHash, randomBytes } from "node:crypto";

export const MCP_SCOPES = [
  "recons.read",
  "recons.run",
  "data-prep.run",
  "connectors.read",
  "connectors.run",
  "breaks.write",
  "reports.read",
] as const;

const READ_SCOPES = new Set(["recons.read", "connectors.read", "reports.read"]);

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomOpaqueToken(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function parseScopes(value: string | null | undefined) {
  return [...new Set((value ?? "").split(/\s+/u).filter(Boolean))];
}

export function scopesAllowedForRole(scopes: string[], role: string) {
  const known = scopes.every((scope) => (MCP_SCOPES as readonly string[]).includes(scope));
  if (!known) return false;
  if (role === "tenant_admin" || role === "tenant_analyst") return true;
  return scopes.every((scope) => READ_SCOPES.has(scope));
}

export function validateRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

export function oauthJson(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", pragma: "no-cache" },
  });
}

export function oauthError(status: number, error: string, description: string) {
  return oauthJson(status, { error, error_description: description });
}
