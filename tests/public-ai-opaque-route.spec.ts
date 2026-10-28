import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), resolve: vi.fn(), cost: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/ai-inference-router.server", () => ({ resolveInferenceRoute: mocks.resolve }));
vi.mock("@/lib/ai-cost.server", () => ({ computeUsageCostUsd: mocks.cost }));
import { Route } from "../src/routes/api/public/ai/inference";

const tenant = "10000000-0000-4000-8000-000000000001";
const subject = "20000000-0000-4000-8000-000000000002";
const prepared = {
  request_id: "40000000-0000-4000-8000-000000000004", token_id: "30000000-0000-4000-8000-000000000003",
  tenant_id: tenant, subject_user_id: subject, principal_kind: "user_delegated", max_tokens: 1024, max_input_tokens: 65536,
  route: {
    policy_id: "50000000-0000-4000-8000-000000000005", policy_name: "Scoped policy", chain_index: 0,
    provider_instance_id: "60000000-0000-4000-8000-000000000006", provider_code: "qa", provider_display: "QA",
    model_catalog_id: "70000000-0000-4000-8000-000000000007", model_key: "qa-model",
    endpoint: "https://qa.invalid/chat", auth_method: "bearer", custom_headers: {}, api_version: null, vault_secret_id: null,
  }, vault: null,
};
const body = { tenant_id: tenant, messages: [{ role: "user", content: "synthetic auth contract" }] };
const post = (authorization = "Bearer fvi_synthetic_auth_only", data: unknown = body) =>
  (Route as any).server.handlers.POST({ request: new Request("https://app.reconiq.example/api/public/ai/inference", {
    method: "POST", headers: { authorization, "content-type": "application/json", origin: "https://app.reconiq.example" }, body: JSON.stringify(data),
  }) });
let admin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };
let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://db.invalid");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-server-only");
  admin = { rpc: vi.fn(async name => ({ data: name === "prepare_public_ai_inference" ? prepared : true, error: null })), from: vi.fn(() => { throw Error("general privileged table access prohibited"); }) };
  mocks.createClient.mockReset().mockReturnValue(admin);
  mocks.resolve.mockReset(); mocks.cost.mockReset();
  upstream = vi.fn(async () => Response.json({ choices: [{ message: { content: "stubbed" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("public AI route opaque compatibility", () => {
  it("accepts an authorized prepared principal without an anon client or general service queries", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: "stubbed" } }] });
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.createClient.mock.calls[0][1]).toBe("synthetic-server-only");
    expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.cost).not.toHaveBeenCalled();
    expect(JSON.parse(upstream.mock.calls[0][1].body).max_tokens).toBe(1024);
    expect(response.headers.get("x-ai-router-model")).toBe("qa-model");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.reconiq.example");
    expect(admin.rpc.mock.calls[1]).toEqual(["record_public_ai_inference_usage", {
      _request_id: prepared.request_id, _tokens_in: 5, _tokens_out: 2, _upstream_status: 200, _latency_ms: expect.any(Number),
    }]);
  });
  it.each([
    ["token_revoked", 401], ["token_expired", 401], ["missing_scope", 403],
    ["principal_denied", 403], ["tenant_scope_mismatch", 403], ["ai_policy_denied", 403], ["ai_paused", 423],
  ])("denies %s before provider invocation", async (error, status) => {
    admin.rpc.mockResolvedValue({ data: { error }, error: null });
    const response = await post();
    expect(response.status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });
  it("does not convert missing SQL or database errors into successful auth", async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { message: "SQL synthetic-server-only" } });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"authentication unavailable"}');
    expect(upstream).not.toHaveBeenCalled();
  });
  it("requires the Bearer scheme and the existing server-only opaque auth configuration", async () => {
    expect((await post("Basic fvi_synthetic_auth_only")).status).toBe(401);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await post()).status).toBe(501);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("settles a provider transport failure as unknown usage and returns the safe error", async () => {
    upstream.mockRejectedValue(new Error("private endpoint https://qa.invalid secret"));
    const response = await post();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret");
    expect(admin.rpc.mock.calls[1][1]).toMatchObject({ _tokens_in: null, _tokens_out: null, _upstream_status: 0 });
  });
  it("refuses success when accounting is unavailable, without repeating the provider call", async () => {
    admin.rpc.mockImplementation(async name => ({ data: name === "prepare_public_ai_inference" ? prepared : false, error: null }));
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"inference accounting unavailable"}');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });
  it("preserves the Supabase JWT client, verified user and existing resolver/accounting path", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const userClient = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: subject } } }) }, from: vi.fn(() => ({ insert })) };
    mocks.createClient.mockReturnValue(userClient);
    mocks.resolve.mockResolvedValue({ ...prepared.route, headers: { "content-type": "application/json" } });
    mocks.cost.mockResolvedValue({ cost_usd: 0.01, priced: true, rate_card_key: "qa/qa-model" });
    const response = await post("Bearer synthetic.jwt.only");
    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledWith("https://db.invalid", "synthetic-publishable", {
      global: { headers: { authorization: "Bearer synthetic.jwt.only" } }, auth: { persistSession: false },
    });
    expect(userClient.auth.getUser).toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith(userClient, { tenant_id: tenant, request_class: "chat", requested_model_key: undefined, include_secret: true });
    expect(insert.mock.calls[0][0]).toMatchObject({ tenant_id: tenant, user_id: subject, tokens_in: 5, tokens_out: 2 });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("preserves invalid JWT denial before routing", async () => {
    mocks.createClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } });
    const response = await post("Bearer invalid.jwt.only");
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":"invalid jwt"}');
    expect(upstream).not.toHaveBeenCalled();
  });
});
