import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = { middleware: () => chain, validator: () => chain, handler: (fn: unknown) => fn };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));

import { listKmsBindings } from "@/lib/vault.functions";

function context(adminError = false) {
  const row = {
    id: "11111111-1111-1111-1111-111111111111", provider: "aws_kms",
    verification_error: "SQL PRIVATE-KEY internal KMS failure", status: "active",
  };
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    order: async () => ({ data: [row], error: null }),
  };
  return { data: { scope: "platform" }, context: {
    userId: "owner",
    supabase: {
      rpc: async () => adminError
        ? { data: null, error: { message: "PGRST002" } }
        : { data: true, error: null },
      from: () => query,
    },
  } } as any;
}

describe("vault user error contract", () => {
  it("returns a safe attention flag instead of stored KMS exception text", async () => {
    const result = await (listKmsBindings as any)(context());
    expect(result[0].verification_needs_attention).toBe(true);
    expect(result[0]).not.toHaveProperty("verification_error");
    expect(JSON.stringify(result)).not.toContain("PRIVATE-KEY");
  });

  it("does not call an admin-check outage a genuine forbidden decision", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect((listKmsBindings as any)(context(true))).rejects.toThrow("The requested service is currently unavailable");
      expect(logger).toHaveBeenCalledWith("[VAULT_SERVICE_ERROR]", expect.objectContaining({ referenceId: expect.stringMatching(/^FVI-[A-F0-9]{12}$/) }));
    } finally {
      logger.mockRestore();
    }
  });
});
