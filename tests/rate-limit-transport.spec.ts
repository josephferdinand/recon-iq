import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  adminRpc: vi.fn(),
}));

vi.mock("../node_modules/@tanstack/start-server-core/src/getServerFnById.ts", () => ({
  getServerFnById: vi.fn(async () => mocks.action),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mocks.adminRpc },
}));

import { requestHandler } from "@tanstack/start-server-core/request-response";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { handleServerAction } from "../node_modules/@tanstack/start-server-core/src/server-functions-handler.ts";
import { serverFnFetcher } from "../node_modules/@tanstack/start-client-core/src/client-rpc/serverFnFetcher.ts";
import { enforceServerFnRateLimit } from "@/lib/rate-limit.server";
import { quotaResponseMiddleware } from "@/start";

const authClient = {
  rpc: vi.fn(),
  from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: null })) })),
};

let capturedResponse: Response | undefined;

function createFrameworkHandler(withQuotaBridge: boolean) {
  return requestHandler(async (request) => {
    const pathname = new URL(request.url).pathname;
    const actionResponse = await handleServerAction({
      request,
      context: {},
      serverFnId: "quota-transport-test",
    });
    if (!withQuotaBridge) return actionResponse;

    const result = await quotaResponseMiddleware.options.server!({
      request,
      pathname,
      handlerType: "serverFn",
      context: {},
      next: async () => ({ request, pathname, context: {}, response: actionResponse }),
    } as never);
    if (result instanceof Response) return result;
    return (result as { response: Response }).response;
  });
}

async function callThroughClient(withQuotaBridge = true) {
  const request = new Request("http://localhost/_serverFn/quota-transport-test");
  const frameworkHandler = createFrameworkHandler(withQuotaBridge);
  return runWithStartContext(
    {
      getRouter: async () => ({}) as never,
      request,
      startOptions: { serializationAdapters: [] },
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
      handlerType: "serverFn",
    },
    () =>
      serverFnFetcher(
        request.url,
        [{ method: "POST", data: {}, context: {} }],
        async (url, init) => {
          const response = await frameworkHandler(new Request(url, init), {});
          capturedResponse = response.clone();
          return response;
        },
      ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedResponse = undefined;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.action.mockImplementation(async () => {
    await enforceServerFnRateLimit(
      authClient as never,
      "recon.run:tenant-a:user-a",
      3600,
      120,
    );
    return { result: { ok: true } };
  });
});

describe("rate-limit ServerFn transport", () => {
  it("proves the pinned framework loses ambient Retry-After without the quota bridge", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: { allowed: false, current_count: 121, retry_after_seconds: 12 },
      error: null,
    });

    const rejection = await callThroughClient(false).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe("Rate limit exceeded. Try again in 12 seconds.");
    expect(capturedResponse?.status).toBe(429);
    expect(capturedResponse?.headers.get("retry-after")).toBeNull();
    expect(capturedResponse?.headers.get("x-tss-serialized")).toBe("true");
  });

  it("carries a bounded Retry-After on the serialized 429 and still rejects client-side", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: { allowed: false, current_count: 121, retry_after_seconds: 999_999 },
      error: null,
    });

    const rejection = await callThroughClient().catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      "Rate limit exceeded. Try again in 86400 seconds.",
    );
    expect(capturedResponse?.status).toBe(429);
    expect(capturedResponse?.headers.get("retry-after")).toBe("86400");
    expect(capturedResponse?.headers.get("x-tss-serialized")).toBe("true");
  });

  it("returns a serialized 503 without Retry-After and rejects client-side", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "permission detail" },
    });

    const rejection = await callThroughClient().catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      "Rate limiting is temporarily unavailable. Try again later.",
    );
    expect(capturedResponse?.status).toBe(503);
    expect(capturedResponse?.headers.get("retry-after")).toBeNull();
  });

  it("preserves the legitimate serialized success response", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: { allowed: true, current_count: 1, retry_after_seconds: 0 },
      error: null,
    });

    await expect(callThroughClient()).resolves.toEqual({ result: { ok: true } });
    expect(capturedResponse?.status).toBe(200);
    expect(capturedResponse?.headers.get("retry-after")).toBeNull();
  });

  it("leaves an unrelated raw response and its existing Retry-After untouched", async () => {
    mocks.action.mockResolvedValue({
      result: new Response("unrelated", {
        status: 429,
        headers: { "Retry-After": "7" },
      }),
    });

    const result = await callThroughClient();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
    expect((result as Response).headers.get("retry-after")).toBe("7");
    expect(await (result as Response).text()).toBe("unrelated");
  });
});
