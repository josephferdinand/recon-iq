/**
 * AIDP Slice 4 — public API validation tests.
 * Asserts bearer auth, quota gating, scheme/host enforcement.
 * The DB and prediction loop are mocked at the boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const tokenPlain = "fvi_test_abcdef";
const tokenHash = createHash("sha256").update(tokenPlain).digest("hex");

let quotaAllowed = true;
let tokenRow: any = { id: "tok1", tenant_id: "t1", scopes: ["aidp:extract"], expires_at: null, revoked_at: null };

vi.mock("@/integrations/supabase/client.server", () => {
  const makeEq = (table: string, filters: Record<string, any>) => {
    const chain: any = {
      eq: (k: string, v: any) => makeEq(table, { ...filters, [k]: v }),
      maybeSingle: async () => {
        if (table === "api_tokens") return { data: tokenRow };
        if (table === "aidp_document_types" && filters.code === "invoice") return { data: { id: "dt1", code: "invoice" } };
        return { data: null };
      },
      single: async () => {
        if (table === "api_tokens") return { data: tokenRow };
        if (table === "aidp_document_types" && filters.code === "invoice") return { data: { id: "dt1", code: "invoice" } };
        return { data: null };
      },
    };
    return chain;
  };
  const insertBuilder = (table: string) => {
    const selectBuilder = () => ({
      single: async () => ({ data: table === "aidp_api_jobs" ? { id: "job1", status: "queued" } : { id: "x" }, error: null }),
      maybeSingle: async () => ({ data: table === "aidp_api_jobs" ? { id: "job1", status: "queued" } : { id: "x" }, error: null }),
    });
    return { select: selectBuilder, then: (r: any) => r({ data: { id: "x" }, error: null }) };
  };
  const sb: any = {
    from: (table: string) => ({
      select: (_c?: string) => makeEq(table, {}),
      insert: (_row?: unknown) => insertBuilder(table),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
    rpc: async (name: string) => {
      if (name === "aidp_api_quota_hit") return { data: { allowed: quotaAllowed, retry_after_seconds: 3600 }, error: null };
      return { data: null, error: null };
    },
    storage: { from: () => ({ upload: async () => ({ data: { path: "x" }, error: null }) }) },
  };
  return { supabaseAdmin: sb };
});

vi.mock("@/lib/aidp-predict-internal.server", () => ({
  runPredictAsTenant: vi.fn(async () => ({
    prediction_id: "pred1", auto_accepted_count: 2, pending_review_count: 1, model_version_id: "platform-default",
  })),
}));

vi.mock("@/lib/aidp.functions", () => ({ predictDocument: vi.fn() }));

// We import the route module lazily so mocks apply.
async function call(body: any, headers: Record<string, string> = { "x-aidp-token": tokenPlain }, fetchOk = true) {
  // Stub fetch for the file_url
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(async () => new Response(
    fetchOk ? new Uint8Array([1, 2, 3]) : "", {
      status: fetchOk ? 200 : 404,
      headers: { "content-type": "application/pdf", "content-length": "3" },
    }));
  try {
    const mod = await import("../../src/routes/api/public/aidp/extract");
    const handler = (mod.Route as any).options.server.handlers.POST;
    const req = new Request("https://x/api/public/aidp/extract", {
      method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const res = await handler({ request: req });
    return { status: res.status, json: await res.json(), retryAfter: res.headers.get("retry-after") };
  } finally {
    (globalThis as any).fetch = origFetch;
  }
}

beforeEach(() => {
  quotaAllowed = true;
  tokenRow = { id: "tok1", tenant_id: "t1", scopes: ["aidp:extract"], expires_at: null, revoked_at: null };
});

describe("AIDP — public API /api/public/aidp/extract", () => {
  it("Fixture 1 — valid bearer + valid file_url queues provider work", async () => {
    const r = await call({ document_type_code: "invoice", file_url: "https://my-bucket.s3.amazonaws.com/x.pdf" });
    expect(r.status).toBe(202);
    expect(r.json.api_version).toBe("v1");
    expect(r.json.job_id).toBe("job1");
    expect(r.json.status).toBe("queued");
  });

  it("Fixture 2 — quota exceeded returns 429 with Retry-After", async () => {
    quotaAllowed = false;
    const r = await call({ document_type_code: "invoice", file_url: "https://my-bucket.s3.amazonaws.com/x.pdf" });
    expect(r.status).toBe(429);
    expect(r.retryAfter).toBe("3600");
    expect(r.json.error).toBe("quota_exceeded");
  });

  it("Fixture 3 — invalid bearer returns 401", async () => {
    tokenRow = null;
    const r = await call({ document_type_code: "invoice", file_url: "https://my-bucket.s3.amazonaws.com/x.pdf" },
      { "x-aidp-token": "bad" });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("invalid_token");
  });

  it("Fixture 4 — non-HTTPS file_url returns 400", async () => {
    const r = await call({ document_type_code: "invoice", file_url: "http://insecure.example/x.pdf" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("file_url_must_be_https");
  });

  it("Fixture 5 — non-allow-listed host returns 400", async () => {
    const r = await call({ document_type_code: "invoice", file_url: "https://malicious.example/x.pdf" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("file_host_not_allowed");
  });
});
