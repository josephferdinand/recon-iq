import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveRoute } = vi.hoisted(() => ({ resolveRoute: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = { middleware: () => chain, validator: () => chain, handler: (fn: unknown) => fn };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));
vi.mock("@/lib/ai-inference-router.server", () => ({ resolveInferenceRoute: resolveRoute }));

import { executeInference, simulateInferenceRoute } from "@/lib/ai-inference.functions";

const route = {
  policy_name: "Approved routing policy", chain_index: 0,
  provider_display: "Approved Provider", provider_code: "approved",
  model_key: "approved-model", endpoint: "https://provider.example/v1/chat/completions",
  headers: { authorization: "Bearer PRIVATE-KEY", "x-custom-secret": "PRIVATE-CUSTOM" },
  vault_last4: "1234", secret_plaintext: "PRIVATE-KEY",
  policy_id: "11111111-1111-1111-1111-111111111111",
  model_catalog_id: "22222222-2222-2222-2222-222222222222",
};

const context = (policyError = false) => ({
  context: {
    userId: "owner",
    supabase: {
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          or: () => query,
          maybeSingle: async () => policyError
            ? { data: null, error: { message: "SQL PRIVATE-KEY" } }
            : { data: null, error: null },
          insert: async () => ({ error: null }),
        };
        return query;
      },
    },
  },
}) as any;

beforeEach(() => resolveRoute.mockReset().mockResolvedValue(route));
afterEach(() => vi.restoreAllMocks());

describe("AI simulator safe error transport", () => {
  it("returns business routing details without endpoint, headers, IDs or vault hints", async () => {
    const result = await (simulateInferenceRoute as any)({ data: { tenant_id: null }, ...context() });
    expect(result.ok).toBe(true);
    expect(result.resolved).toEqual({
      policy_name: "Approved routing policy", chain_index: 0,
      provider_display: "Approved Provider", provider_code: "approved", model_key: "approved-model",
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain("11111111");
  });

  it("fails closed when the policy check cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await (executeInference as any)({
      data: { tenant_id: "tenant-a", messages: [{ role: "user", content: "test" }] },
      ...context(true),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(resolveRoute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("does not forward a provider's raw failure body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider PRIVATE-KEY stack trace", { status: 500 })));
    try {
      const result = await (executeInference as any)({
        data: { tenant_id: null, request_class: "chat", messages: [{ role: "user", content: "test" }] },
        ...context(),
      });
      expect(result.ok).toBe(false);
      expect(result.reference_id).toMatch(/^FVI-[A-F0-9]{12}$/);
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
      expect(JSON.stringify(result)).not.toContain("11111111");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
