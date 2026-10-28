import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = { middleware: () => chain, validator: () => chain, handler: (fn: unknown) => fn };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));
vi.mock("@/lib/rbac-guards.server", () => ({
  requireTenantMember: async () => undefined,
  requireTenantAdmin: async () => undefined,
}));

import { listWebhookOutbox } from "@/lib/webhooks.functions";

describe("webhook outbox user error contract", () => {
  it("returns an attention flag without persisting the raw delivery error into the browser response", async () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      event: "recon.run.completed", status: "failed",
      last_error: "provider PRIVATE-TOKEN SQL traceback",
    };
    const result = Promise.resolve({ data: [row], error: null });
    const query = {
      select: () => query, eq: () => query, order: () => query,
      limit: () => query, then: result.then.bind(result),
    };
    const response = await (listWebhookOutbox as any)({
      data: { tenantId: "tenant-a", status: "failed", limit: 50 },
      context: { userId: "owner", supabase: { from: () => query } },
    });
    expect(response[0].delivery_needs_attention).toBe(true);
    expect(response[0]).not.toHaveProperty("last_error");
    expect(JSON.stringify(response)).not.toContain("PRIVATE-TOKEN");
  });
});
