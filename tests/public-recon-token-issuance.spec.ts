import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(() => { throw new Error("Unexpected direct table fallback"); }) }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder: any = { middleware: () => builder, validator: (validate: any) => { builder.validate = validate; return builder; }, handler: (handler: any) => ({ handler, validate: builder.validate }) };
  return builder;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
import { createApiToken, revokeApiToken } from "@/lib/gtm.functions";
const create = createApiToken as any, revoke = revokeApiToken as any;
const tenant = "ca000000-0000-4000-8000-000000000001", token = "ca000000-0000-4000-8000-000000000021";
const context = { userId: "ca000000-0000-4000-8000-000000000011", supabase: { rpc, from } };
const input = { tenant_id: tenant, name: "QA token", scopes: ["recons.read", "ai.inference"] };
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: { id: token, audit_id: "9007199254740993" }, error: null }); });
describe("qualified normal new API token issuance", () => {
  it("mints self-bound through authenticated audited RPC without actor/issuer/classification input", async () => {
    const result = await create.handler({ data: create.validate(input), context });
    expect(result).toMatchObject({ id: token }); expect(result.token).toMatch(/^fvi_[0-9a-f]{48}$/u);
    expect(rpc).toHaveBeenCalledWith("issue_user_delegated_api_token", {
      _tenant_id: tenant, _name: input.name, _prefix: result.token.slice(0,12),
      _token_hash: createHash("sha256").update(result.token).digest("hex"), _scopes: input.scopes, _expires_at: null,
    });
    expect(from).not.toHaveBeenCalled(); expect(result).not.toHaveProperty("token_hash");
  });
  it("ignores supplied actor/subject override fields", async () => {
    await create.handler({ data: create.validate({ ...input, created_by: token, subject_user_id: token, issuer_user_id: token, principal_kind: "tenant_machine" }), context });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("_actor");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("created_by");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("subject_user_id");
  });
  it.each([[], ["*"], ["recon.read"], ["recons.read", "recons.read"]])("rejects unsupported scope set %s before issuance", scopes => {
    expect(() => create.validate({ ...input, scopes })).toThrow(); expect(rpc).not.toHaveBeenCalled();
  });
  it("caps requested expiry and passes a new bounded timestamp", async () => {
    const before = Date.now(); await create.handler({ data: create.validate({ ...input, expires_in_days: 1 }), context });
    expect(Date.parse(rpc.mock.calls[0][1]._expires_at)).toBeGreaterThanOrEqual(before + 86400000);
    expect(() => create.validate({ ...input, expires_in_days: 731 })).toThrow();
  });
  it.each([null, { id: token }, { id: token, audit_id: "invalid" }, { id: token, audit_id: "9223372036854775808" }])("never returns raw bearer without committed valid receipt %s", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(create.handler({ data: create.validate(input), context })).rejects.toThrow("API token issuance unavailable.");
    expect(from).not.toHaveBeenCalled();
  });
  it("denies SQL permission errors without retrying/direct insert or disclosing internals", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private SQL identity" } });
    await expect(create.handler({ data: create.validate(input), context })).rejects.toThrow("API token issuance unavailable.");
    expect(rpc).toHaveBeenCalledTimes(1); expect(from).not.toHaveBeenCalled();
  });
  it("revokes only exact tenant/token through atomic attributed RPC", async () => {
    expect(await revoke.handler({ data: revoke.validate({ id: token, tenant_id: tenant }), context })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("revoke_user_delegated_api_token", { _tenant_id: tenant, _token_id: token });
    expect(from).not.toHaveBeenCalled();
  });
  it("rejects mismatched revoke receipt without fallback", async () => {
    rpc.mockResolvedValue({ data: { id: tenant, audit_id: "9" }, error: null });
    await expect(revoke.handler({ data: { id: token, tenant_id: tenant }, context })).rejects.toThrow("API token revocation unavailable.");
  });
});
