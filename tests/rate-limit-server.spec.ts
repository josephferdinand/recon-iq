import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mocks.adminRpc },
}));

vi.mock("@tanstack/react-start/server", () => ({
  setResponseHeader: mocks.setResponseHeader,
  setResponseStatus: mocks.setResponseStatus,
}));

import {
  checkRateLimit,
  enforceRateLimit,
  enforceServerFnRateLimit,
  RateLimitError,
} from "@/lib/rate-limit.server";

function authenticatedClient(auditResult: "ok" | "error" | "throw" = "ok") {
  const insert = vi.fn(() => {
    if (auditResult === "throw") return Promise.reject(new Error("audit transport detail"));
    return Promise.resolve({ error: auditResult === "error" ? { message: "audit detail" } : null });
  });
  return {
    client: {
      rpc: vi.fn(),
      from: vi.fn(() => ({ insert })),
    },
    insert,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("server rate-limit boundary", () => {
  it("uses only the admin client for the atomic RPC and preserves an allowed decision", async () => {
    const auth = authenticatedClient();
    mocks.adminRpc.mockResolvedValue({
      data: [{ allowed: true, current_count: 1, retry_after_seconds: 0 }],
      error: null,
    });

    await expect(checkRateLimit(auth.client as never, "recon.run:t1:u1", 3600, 120)).resolves.toEqual({
      allowed: true,
      current: 1,
      retryAfterSeconds: 0,
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("rate_limit_hit", {
      _key: "recon.run:t1:u1",
      _window_seconds: 3600,
      _limit: 120,
    });
    expect(auth.client.rpc).not.toHaveBeenCalled();
  });

  it.each(["error", "throw"] as const)(
    "keeps a confirmed denial when the best-effort audit returns %s",
    async (auditResult) => {
      const auth = authenticatedClient(auditResult);
      mocks.adminRpc.mockResolvedValue({
        data: { allowed: false, current_count: 61, retry_after_seconds: 12 },
        error: null,
      });

      await expect(
        enforceRateLimit(auth.client as never, "ds.upload:t1:u1", 3600, 60, {
          tenant_id: "t1",
          user_id: "u1",
          event_type: "rate_limit.upload",
        }),
      ).rejects.toMatchObject({
        name: "RateLimitError",
        code: "rate_limit_exceeded",
        statusCode: 429,
        retryAfterSeconds: 12,
      });
      expect(auth.insert).toHaveBeenCalledOnce();
    },
  );

  it("fails closed with a safe unavailable error for RPC errors, throws and malformed rows", async () => {
    const auth = authenticatedClient();
    const failures = [
      () => mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied detail" } }),
      () => mocks.adminRpc.mockRejectedValueOnce(new Error("network detail")),
      () => mocks.adminRpc.mockResolvedValueOnce({ data: [], error: null }),
      () => mocks.adminRpc.mockResolvedValueOnce({ data: { allowed: "yes" }, error: null }),
      () => mocks.adminRpc.mockResolvedValueOnce({ data: { allowed: true }, error: null }),
      () => mocks.adminRpc.mockResolvedValueOnce({
        data: { allowed: true, current_count: "1", retry_after_seconds: 0 },
        error: null,
      }),
    ];

    for (const arrange of failures) {
      arrange();
      await expect(checkRateLimit(auth.client as never, "rekon.nl_map:t1:u1", 3600, 60)).rejects.toEqual(
        new RateLimitError("rate_limit_unavailable"),
      );
    }
    expect(auth.client.rpc).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("detail"));
  });

  it("sets ServerFn transport status and a bounded Retry-After before rejecting", async () => {
    const auth = authenticatedClient("throw");
    mocks.adminRpc.mockResolvedValue({
      data: { allowed: false, current_count: 999, retry_after_seconds: 999_999 },
      error: null,
    });

    await expect(
      enforceServerFnRateLimit(auth.client as never, "recon.run:t1:u1", 3600, 120),
    ).rejects.toMatchObject({ code: "rate_limit_exceeded", statusCode: 429 });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(429);
    expect(mocks.setResponseHeader).toHaveBeenCalledWith("Retry-After", "86400");
  });

  it("sets ServerFn status 503 for unavailable and still rejects safely", async () => {
    const auth = authenticatedClient();
    mocks.adminRpc.mockRejectedValue(new Error("network detail"));

    await expect(
      enforceServerFnRateLimit(auth.client as never, "recon.run:t1:u1", 3600, 120),
    ).rejects.toMatchObject({
      code: "rate_limit_unavailable",
      statusCode: 503,
      message: "Rate limiting is temporarily unavailable. Try again later.",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(503);
    expect(mocks.setResponseHeader).not.toHaveBeenCalled();
  });

  it("keeps the three ServerFn adapters, isolated keys, limits and defaults wired", async () => {
    const [uploads, recons, wizard, copilot] = await Promise.all([
      readFile("src/lib/data-sources.functions.ts", "utf8"),
      readFile("src/lib/recons.functions.ts", "utf8"),
      readFile("src/lib/rekon-wizard.functions.ts", "utf8"),
      readFile("src/routes/api/copilot/stream.ts", "utf8"),
    ]);

    for (const source of [uploads, recons, wizard]) {
      expect(source).toContain("enforceServerFnRateLimit");
      expect(source).not.toMatch(/\benforceRateLimit\(/);
    }
    expect(uploads).toContain("`ds.upload:${data.tenant_id}:${context.userId}`");
    expect(uploads).toContain("sec?.max_uploads_per_hour ?? 60");
    expect(recons).toContain("`recon.run:${data.tenant_id}:${context.userId}`");
    expect(recons).toContain("sec?.max_runs_per_hour ?? 120");
    expect(wizard).toContain("`rekon.nl_map:${data.tenant_id}:${context.userId}`");
    expect(wizard).toContain("3600, 60");
    expect(copilot).toContain("`copilot.stream:user:${userId}`");
    expect(copilot).toContain("`copilot.stream:tenant:${thread.tenant_id}`");
    expect(copilot).toContain("60, 300");
  });
});
