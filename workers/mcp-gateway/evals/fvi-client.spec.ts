import { describe, expect, it, vi } from "vitest";
import {
  FviApiError,
  callFviApi,
  introspectFviToken,
  readFviConfig,
  requireTenant,
  safeToolError,
} from "../src/fvi-client.js";

const config = { apiOrigin: "https://fvi.example" };

describe("FVI MCP client boundary", () => {
  it("introspects an opaque token without returning or logging it", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
      return Response.json({ active: true, tenant_slug: "assurance-lab", subject: "00000000-0000-4000-8000-000000000001", scopes: ["recons.read"], expires_at: null });
    }) as unknown as typeof fetch;
    await expect(introspectFviToken(config, "test-secret", fetcher)).resolves.toEqual({
      tenantSlug: "assurance-lab",
      subject: "00000000-0000-4000-8000-000000000001",
      scopes: ["recons.read"],
      expiresAt: null,
    });
  });

  it("rejects confused-deputy tenant changes before an upstream call", () => {
    expect(() => requireTenant("other-tenant", { tenantSlug: "assurance-lab", subject: "user", scopes: [], expiresAt: null })).toThrow("tenant_scope_mismatch");
  });

  it("forwards idempotency and returns only stable upstream error codes", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("idempotency-key")).toBe("run-001");
      return Response.json({ error: "rate_limit_exceeded", detail: "must-not-leak" }, { status: 429, headers: { "retry-after": "12" } });
    }) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await callFviApi({ config, token: "test-secret", tenantSlug: "assurance-lab", path: "/api/v1/assurance-lab/recons/id/runs", method: "POST", idempotencyKey: "run-001", fetcher });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(FviApiError);
    expect(safeToolError(caught)).toEqual({ code: "rate_limit_exceeded", status: 429, retry_after_seconds: 12 });
    expect(JSON.stringify(safeToolError(caught))).not.toContain("must-not-leak");
    expect(JSON.stringify(safeToolError(caught))).not.toContain("test-secret");
  });

  it("requires explicit HTTPS production configuration", () => {
    expect(() => readFviConfig({ FVI_API_ORIGIN: "http://prod.example" })).toThrow("must use HTTPS");
  });
});
