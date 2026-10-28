// C1 — Observability smoke tests (APM/SIEM HTTP pipeline).
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: async () => ({ data: null, error: null }) },
}));

// Env vars are captured at module load time in observability.server.ts,
// so set them before any import of that module.
process.env.APM_ENDPOINT = "https://apm.test/v1/spans";
process.env.SIEM_ENDPOINT = "https://siem.test/v1/events";

describe("observability", () => {
  const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockClear();
    (globalThis as any).fetch = fetchMock;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  async function flush() {
    // allow fire-and-forget promises to settle
    await new Promise((r) => setTimeout(r, 20));
  }

  it("writeMetric does not throw", async () => {
    const { writeMetric } = await import("@/lib/observability.server");
    expect(() => writeMetric("test.event", { tenant_id: "t1" }, { n: 1 })).not.toThrow();
  });

  it("createTrace emits an APM span with duration on end()", async () => {
    const { createTrace } = await import("@/lib/observability.server");
    const t = createTrace("ai.call", { provider: "meta", model: "gpt-4" });
    await new Promise((r) => setTimeout(r, 5));
    t.end("ok", { tokens_in: 10, tokens_out: 20 });
    await flush();
    const apmCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("apm.test"));
    expect(apmCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse((apmCalls[0][1] as RequestInit).body as string);
    expect(body.name).toBe("ai.call");
    expect(body.status).toBe("ok");
    expect(body.duration_ms).toBeGreaterThanOrEqual(0);
    expect(body.tags.tokens_in).toBe(10);
    expect(body.tags.tokens_out).toBe(20);
  });

  it("withCronMetric writes one APM span per execution", async () => {
    const { withCronMetric } = await import("@/lib/observability.server");
    await withCronMetric("retention", async () => ({ deleted: 3 }), (r) => r.deleted);
    await flush();
    const apmCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("apm.test"));
    expect(apmCalls.length).toBe(1);
    const body = JSON.parse((apmCalls[0][1] as RequestInit).body as string);
    expect(body.name).toBe("cron.retention");
    expect(body.status).toBe("ok");
    expect(body.tags.success).toBe(3);
  });

  it("cron error path emits APM error span and SIEM event", async () => {
    const { withCronMetric } = await import("@/lib/observability.server");
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(withCronMetric("explode", fn)).rejects.toThrow("boom");
    await flush();
    const apmCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("apm.test"));
    const siemCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("siem.test"));
    expect(apmCalls.length).toBe(1);
    const apmBody = JSON.parse((apmCalls[0][1] as RequestInit).body as string);
    expect(apmBody.status).toBe("error");
    expect(apmBody.name).toBe("cron.explode");
    expect(siemCalls.length).toBe(1);
  });
});
