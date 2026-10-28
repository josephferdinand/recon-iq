import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkBudget: vi.fn(),
  createClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  providerLookup: vi.fn(),
  threadSingle: vi.fn(),
}));

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: mocks.createClient,
}));

vi.mock("@/lib/rate-limit.server", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}));

vi.mock("@/lib/ai-metering.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-metering.server")>()),
  checkBudget: mocks.checkBudget,
}));

vi.mock("@/lib/ai/provider-router.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider-router.server")>()),
  resolveFviAiBaseUrl: mocks.providerLookup,
}));

import { handleCopilotStream } from "@/routes/api/copilot/stream";

const threadId = "00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";

function authenticatedRequest() {
  return new Request("http://localhost/api/copilot/stream", {
    method: "POST",
    headers: {
      authorization: "Bearer aaa.bbb.ccc",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      thread_id: threadId,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.threadSingle.mockResolvedValue({
    data: { id: threadId, scope: "workspace", tenant_id: tenantId, user_id: userId },
    error: null,
  });
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({ single: mocks.threadSingle }),
    }),
  });
  mocks.createClient.mockReturnValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  });
});

describe("copilot streaming route", () => {
  it("rejects requests without a bearer token", async () => {
    const req = new Request("http://localhost/api/copilot/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thread_id: "00000000-0000-0000-0000-000000000000", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await handleCopilotStream(req);
    expect(res.status).toBe(401);
  });

  it("maps a typed quota denial to 429 with Retry-After before provider work", async () => {
    mocks.enforceRateLimit.mockRejectedValue(
      Object.assign(new Error("internal quota detail"), {
        code: "rate_limit_exceeded",
        retryAfterSeconds: 12,
      }),
    );

    const response = await handleCopilotStream(authenticatedRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(await response.text()).toBe("Rate limit exceeded. Try again later.");
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.providerLookup).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error("database detail"), { code: "rate_limit_unavailable" }),
    new Error("unexpected limiter detail"),
  ])("maps unavailable or unexpected limiter failures to a safe 503", async (failure) => {
    mocks.enforceRateLimit.mockRejectedValue(failure);

    const response = await handleCopilotStream(authenticatedRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.text()).toBe(
      "Rate limiting is temporarily unavailable. Try again later.",
    );
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.providerLookup).not.toHaveBeenCalled();
  });
});
