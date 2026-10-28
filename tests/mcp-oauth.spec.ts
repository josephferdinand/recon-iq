import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MCP_SCOPES,
  parseScopes,
  pkceChallenge,
  randomOpaqueToken,
  scopesAllowedForRole,
  sha256,
  validateRedirectUri,
} from "@/lib/mcp-oauth.server";

describe("MCP OAuth 2.1 boundary", () => {
  it("accepts HTTPS and loopback redirect URIs", () => {
    expect(validateRedirectUri("https://chat.example.test/oauth/callback")).toBe(true);
    expect(validateRedirectUri("http://127.0.0.1:43123/callback")).toBe(true);
    expect(validateRedirectUri("http://localhost:43123/callback")).toBe(true);
  });

  it("rejects insecure remote, credentialed and fragment redirect URIs", () => {
    expect(validateRedirectUri("http://chat.example.test/callback")).toBe(false);
    expect(validateRedirectUri("https://user:secret@example.test/callback")).toBe(false);
    expect(validateRedirectUri("https://example.test/callback#fragment")).toBe(false);
    expect(validateRedirectUri("not a URL")).toBe(false);
  });

  it("deduplicates scopes without widening them", () => {
    expect(parseScopes("recons.read  reports.read recons.read")).toEqual(["recons.read", "reports.read"]);
  });

  it("limits viewer consent to read-only scopes", () => {
    expect(scopesAllowedForRole(["recons.read", "reports.read"], "tenant_viewer")).toBe(true);
    expect(scopesAllowedForRole(["recons.run"], "tenant_viewer")).toBe(false);
  });

  it("allows active analyst/admin roles to request the governed catalogue only", () => {
    expect(scopesAllowedForRole([...MCP_SCOPES], "tenant_admin")).toBe(true);
    expect(scopesAllowedForRole(["breaks.write"], "tenant_analyst")).toBe(true);
    expect(scopesAllowedForRole(["platform.admin"], "tenant_admin")).toBe(false);
  });

  it("calculates the RFC 7636 S256 challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates non-repeating opaque values and stable hashes", () => {
    const first = randomOpaqueToken("fvi_mcp");
    const second = randomOpaqueToken("fvi_mcp");
    expect(first).toMatch(/^fvi_mcp_[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
    expect(sha256(first)).toMatch(/^[a-f0-9]{64}$/u);
    expect(sha256(first)).toBe(sha256(first));
  });

  it("keeps OAuth persistence service-only and hash-only", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260909070000_create_mcp_oauth_authorization_server.sql"), "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/REVOKE ALL[\s\S]*FROM anon, authenticated/u);
    expect(sql).not.toMatch(/\b(access_token|refresh_token|authorization_code)\s+text\b/iu);
    expect(sql.match(/CHECK \(char_length\([^)]*_hash\) = 64\)/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("exchange_mcp_oauth_code");
    expect(sql).toContain("rotate_mcp_oauth_refresh_token");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.exchange_mcp_oauth_code[\s\S]*TO service_role/u);
  });

  it("advertises authorization code, refresh and dynamic registration", () => {
    const server = readFileSync(resolve("workers/mcp-gateway/src/server.ts"), "utf8");
    expect(server).toContain('grant_types_supported: ["authorization_code", "refresh_token"]');
    expect(server).toContain("registration_endpoint: config.registrationEndpoint");
    expect(server).toContain('code_challenge_methods_supported: ["S256"]');
  });

  it("throttles token issuance without logging client or network identifiers", () => {
    const source = readFileSync(resolve("src/routes/api/public/oauth/mcp-token.ts"), "utf8");
    expect(source).toContain("mcp-oauth-token:${sha256(`${body.client_id}:${address}`)}");
    expect(source).toContain("_limit: 60");
    expect(source).toContain('status: 429');
    expect(source).toContain('"retry-after": String(retryAfter)');
  });

  it("never changes the existing sandbox client-credentials issuer", () => {
    const sandbox = readFileSync(resolve("src/routes/api/public/oauth/token.ts"), "utf8");
    expect(sandbox).toContain('grantType !== "client_credentials"');
    expect(sandbox).toContain('iss: "fvi-sandbox"');
  });
});
