import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { prepareOpaqueInference, recordOpaqueInferenceUsage } from "../src/lib/public-ai-opaque-auth.server";

const tenant = "10000000-0000-4000-8000-000000000001";
const subject = "20000000-0000-4000-8000-000000000002";
const tokenId = "30000000-0000-4000-8000-000000000003";
const requestId = "40000000-0000-4000-8000-000000000004";
const input = { tenant_id: tenant, messages: [{ role: "user", content: "auth test only" }] };
const prepared = () => ({
  request_id: requestId, token_id: tokenId, tenant_id: tenant, subject_user_id: subject,
  principal_kind: "user_delegated", max_tokens: 1024, max_input_tokens: 65536,
  route: {
    policy_id: "50000000-0000-4000-8000-000000000005", policy_name: "Scoped policy", chain_index: 0,
    provider_instance_id: "60000000-0000-4000-8000-000000000006", provider_code: "qa", provider_display: "QA",
    model_catalog_id: "70000000-0000-4000-8000-000000000007", model_key: "qa-model",
    endpoint: "https://qa.invalid/chat", auth_method: "bearer", custom_headers: {}, api_version: null, vault_secret_id: null,
  }, vault: null,
});
const admin = (data: unknown = prepared(), error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) });
const raw = "fvi_" + "a1".repeat(24); // synthetic verifier, never an issued credential
afterEach(() => vi.unstubAllGlobals());

describe("AI-only opaque authentication contract", () => {
  it("passes the issuance-compatible hash and no actor/claims to the purpose RPC", async () => {
    const client = admin();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await prepareOpaqueInference(client as never, raw, input);
    expect(client.rpc).toHaveBeenCalledWith("prepare_public_ai_inference", {
      _token_hash: createHash("sha256").update(raw).digest("hex"), _tenant_id: tenant,
      _request_class: "chat", _model: null, _max_tokens: 4096,
    });
    expect(result.subjectUserId).toBe(subject);
    expect(result.tenantId).toBe(tenant);
    expect(JSON.stringify(client.rpc.mock.calls)).not.toContain(raw);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["invalid_token", 401, "unknown token"], ["token_revoked", 401, "token revoked"],
    ["token_expired", 401, "token expired"], ["missing_scope", 403, "token lacks ai.inference scope"],
    ["principal_denied", 403, "token principal not authorized"], ["tenant_scope_mismatch", 403, "tenant scope mismatch"],
    ["ai_policy_denied", 403, "AI request not authorized"], ["ai_paused", 423, "AI requests are currently paused by policy"],
    ["rate_limit_exceeded", 429, "Rate limit exceeded — please retry shortly"],
    ["route_unavailable", 424, "provider endpoint not configured"],
  ])("maps %s to the safe endpoint error", async (error, status, message) => {
    await expect(prepareOpaqueInference(admin({ error }) as never, raw, input)).rejects.toMatchObject({ status, message });
  });
  it.each([
    null, { error: "SQL secret internal diagnostics" },
    { ...prepared(), principal_kind: "unclassified" }, { ...prepared(), principal_kind: "tenant_machine" },
    { ...prepared(), subject_user_id: null, created_by: subject },
    { ...prepared(), max_tokens: 5000 },
    { ...prepared(), tenant_id: "10000000-0000-4000-8000-000000000009" },
    { ...prepared(), route: { ...prepared().route, vault_secret_id: tokenId } },
  ])("fails closed on malformed or incompatible SQL result %#", async data => {
    await expect(prepareOpaqueInference(admin(data) as never, raw, input)).rejects.toMatchObject({ status: 503, message: "authentication unavailable" });
  });
  it("fails closed on SQL errors and transport errors without exposing the cause", async () => {
    await expect(prepareOpaqueInference(admin(null, { message: raw }) as never, raw, input)).rejects.toMatchObject({ status: 503, message: "authentication unavailable" });
    const client = { rpc: vi.fn().mockRejectedValue(new Error(raw)) };
    await expect(prepareOpaqueInference(client as never, raw, input)).rejects.toMatchObject({ status: 503, message: "authentication unavailable" });
  });
  it.each([["copilot.budget_reached",429],["copilot.rate_limit",429],["copilot.kill_switch",423],["copilot.forbidden",403]])("retains safe current spend denial %s", async (message, status) => {
    await expect(prepareOpaqueInference(admin(null,{ message }) as never,raw,input)).rejects.toMatchObject({ status });
  });
  it("enforces the reserved input byte bound before vault/provider access", async () => {
    await expect(prepareOpaqueInference(admin({ ...prepared(),max_input_tokens: 1 }) as never,raw,input)).rejects.toMatchObject({ status: 400,message: "inference input bound exceeded" });
  });
  it.each([
    null, {}, { ...input, max_tokens: 0 }, { ...input, max_tokens: 4097 },
    { ...input, tenant_id: null }, { ...input, actor_user_id: subject },
    { ...input, request_class: "arbitrary_rpc" }, { ...input, temperature: 3 },
    { ...input, messages: Array(129).fill(input.messages[0]) },
    { ...input, messages: [{ role: "user", content: "x".repeat(65537) }] },
    { ...input, messages: [{ role: "user", content: "test", images: ["unbounded binary"] }] },
  ])("rejects invalid or authority-carrying input before RPC %#", async body => {
    const client = admin();
    await expect(prepareOpaqueInference(client as never, raw, body)).rejects.toMatchObject({ status: 400 });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("allows the token to select its own tenant when tenant_id is omitted", async () => {
    const client = admin();
    const result = await prepareOpaqueInference(client as never, raw, { messages: input.messages });
    expect(result.tenantId).toBe(tenant);
    expect(client.rpc.mock.calls[0][1]._tenant_id).toBeNull();
  });
  it("rejects an unexpected model or a raised output bound", async () => {
    await expect(prepareOpaqueInference(admin() as never, raw, { ...input, model: "other" })).rejects.toMatchObject({ status: 503 });
    await expect(prepareOpaqueInference(admin() as never, raw, { ...input, max_tokens: 1 })).rejects.toMatchObject({ status: 503 });
  });
  it("records only the prepared request identifier and provider counts", async () => {
    const p = await prepareOpaqueInference(admin() as never, raw, input);
    const client = admin(true);
    await recordOpaqueInferenceUsage(client as never, p, { usage: { prompt_tokens: 12, completion_tokens: 3 }, upstreamStatus: 200, latencyMs: 12.7 });
    expect(client.rpc).toHaveBeenCalledWith("record_public_ai_inference_usage", {
      _request_id: requestId, _tokens_in: 12, _tokens_out: 3, _upstream_status: 200, _latency_ms: 12,
    });
  });
  it.each([null, {}, { input_tokens: -1, output_tokens: 1.5 }, { input_tokens: "0", output_tokens: NaN }])("keeps missing/invalid usage unknown %#", async usage => {
    const p = await prepareOpaqueInference(admin() as never, raw, input);
    const client = admin(true);
    await recordOpaqueInferenceUsage(client as never, p, { usage, upstreamStatus: 500, latencyMs: 0 });
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ _tokens_in: null, _tokens_out: null });
  });
  it("refuses a failed accounting acknowledgement", async () => {
    const p = await prepareOpaqueInference(admin() as never, raw, input);
    await expect(recordOpaqueInferenceUsage(admin(false) as never, p, { usage: null, upstreamStatus: 0, latencyMs: 0 })).rejects.toMatchObject({ status: 503 });
  });
  it("records an observed overrun before refusing the provider success", async () => {
    const p = await prepareOpaqueInference(admin() as never,raw,input);
    const client=admin(true);
    await expect(recordOpaqueInferenceUsage(client as never,p,{usage:{input_tokens:12,output_tokens:1025},upstreamStatus:200,latencyMs:1})).rejects.toMatchObject({status:502});
    expect(client.rpc).toHaveBeenCalledWith("record_public_ai_inference_usage",expect.objectContaining({_tokens_out:1025}));
  });
  it("maps accounting transport failures to a safe 503", async () => {
    const p = await prepareOpaqueInference(admin() as never,raw,input);
    const client={rpc:vi.fn().mockRejectedValue(new Error(raw))};
    await expect(recordOpaqueInferenceUsage(client as never,p,{usage:null,upstreamStatus:0,latencyMs:0})).rejects.toMatchObject({status:503,message:"inference accounting unavailable"});
  });
});
