import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = { middleware: () => chain, validator: () => chain, handler: (fn: unknown) => fn };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));

import { listCircuitBreakers, listRetryAttempts } from "@/lib/worker-health.functions";

function context(result: { data: any; error: any }) {
  const value = Promise.resolve(result);
  const query = {
    select: () => query, eq: () => query, order: () => query,
    limit: () => query, then: value.then.bind(value),
  };
  return { data: { tenant_id: null, limit: 50 }, context: { supabase: { from: () => query } } } as any;
}

describe("worker health user error contract", () => {
  it("returns attention indicators, not raw persisted worker errors", async () => {
    const breaker = await (listCircuitBreakers as any)(context({
      data: [{ id: "breaker-a", last_error: "SQL PRIVATE-TOKEN" }], error: null,
    }));
    const retry = await (listRetryAttempts as any)(context({
      data: [{ id: "attempt-a", error: "upstream PRIVATE-TOKEN" }], error: null,
    }));
    expect(breaker[0].last_failure_needs_attention).toBe(true);
    expect(retry[0].attempt_needs_attention).toBe(true);
    expect(JSON.stringify({ breaker, retry })).not.toContain("PRIVATE-TOKEN");
    expect(breaker[0]).not.toHaveProperty("last_error");
    expect(retry[0]).not.toHaveProperty("error");
  });

  it("does not serialize a raw database exception on failed reads", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect((listCircuitBreakers as any)(context({
        data: null, error: { code: "PGRST002", message: "SQL PRIVATE-TOKEN" },
      }))).rejects.toThrow("The requested service is currently unavailable");
      expect(logger).toHaveBeenCalledWith("[WORKER_HEALTH_ERROR]", expect.objectContaining({ referenceId: expect.stringMatching(/^FVI-[A-F0-9]{12}$/) }));
    } finally {
      logger.mockRestore();
    }
  });
});
