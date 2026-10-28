import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), deps: vi.fn(), policy: vi.fn(), password: vi.fn(), provider: vi.fn(), factors: vi.fn(), begin: vi.fn(), finish: vi.fn(), diagnostic: vi.fn(), enabled: vi.fn(), ready: vi.fn() }));
// Focused function-body harness: real validators; actual auth middleware itself
// remains parent/hosted evidence, not simulated here as a successful MFA claim.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate: (value: unknown) => unknown;
  const builder: any = { validator: (fn: any) => { validate = fn; return builder; }, middleware: () => builder,
    handler: (handler: any) => async ({ data, context }: any) => handler({ data: validate(data), context }) };
  return builder;
} }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: mocks.request }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
vi.mock("@/lib/tenant-admin-batch2.functions", () => ({ evaluateConditionalAccess: mocks.policy }));
vi.mock("@/lib/failed-login-auth.server", () => ({ failedLoginNotificationsEnabled: mocks.enabled, failedLoginProxyReady: mocks.ready, verifiedLoginRequest: () => "192.0.2.1", loginCaptureDependencies: mocks.deps, serverPasswordSignIn: mocks.password, createFailedLoginProvider: mocks.provider }));
import { evaluateLoginPolicyWithNotifications, passwordSignInWithNotifications, verifyLoginMfaWithNotifications, reauthenticateCurrentPasswordWithNotifications } from "@/lib/failed-login-notifications.functions";
const id = "10000000-0000-4000-8000-000000000001";
const factorId = "20000000-0000-4000-8000-000000000001";
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const context = () => ({ userId: actorId, supabase: { auth: { mfa: { listFactors: mocks.factors } } } });
beforeEach(() => {
  mocks.enabled.mockReturnValue(true); mocks.ready.mockReturnValue(true);
  mocks.request.mockReturnValue(new Request("https://app.reconiq.example/test", { headers: { authorization: "Bearer fixture-current-session" } }));
  mocks.begin.mockResolvedValue({ acquired: true, outcome: "pending" }); mocks.finish.mockResolvedValue(undefined);
  mocks.deps.mockResolvedValue({ begin: mocks.begin, finish: mocks.finish, diagnostic: mocks.diagnostic });
  mocks.factors.mockResolvedValue({ data: { totp: [{ id: factorId, status: "verified" }] }, error: null });
});
afterEach(() => { vi.resetAllMocks(); });
describe("notification server-function trust boundary", () => {
  it("current-password capture derives the account from the verified server actor", async () => {
    mocks.password.mockResolvedValue({mode:"captured",ok:false,error:{code:"invalid_credentials",status:400,message:"Invalid login credentials"}});
    const ctx={...context(),supabase:{auth:{getUser:async()=>({data:{user:{id:actorId,email:"owned@example.test"}},error:null})}}};
    await(reauthenticateCurrentPasswordWithNotifications as any)({data:{attemptId:id,password:"fixture-current"},context:ctx});
    expect(mocks.password).toHaveBeenCalledWith(expect.objectContaining({email:"owned@example.test",expectedUserId:actorId,password:"fixture-current"}),expect.any(Request));
  });
  it("current-password input cannot supply a forged recipient or user identity", async () => {
    await expect((reauthenticateCurrentPasswordWithNotifications as any)({data:{attemptId:id,password:"fixture-current",email:"forged@example.test",expectedUserId:"forged"},context:context()})).rejects.toThrow();expect(mocks.password).not.toHaveBeenCalled();
  });
  it("current-password identity-provider outage stays unavailable rather than inventing a mismatch or recipient", async () => {
    const ctx={...context(),supabase:{auth:{getUser:async()=>({data:{user:null},error:{status:503,code:"unexpected_failure"}})}}};
    const result=await(reauthenticateCurrentPasswordWithNotifications as any)({data:{attemptId:id,password:"fixture-current"},context:ctx});
    expect(result).toMatchObject({mode:"captured",ok:false,error:{status:503,code:"provider_unavailable"}});expect(mocks.password).not.toHaveBeenCalled();
  });
  it("rejects browser-supplied failure/recipient fields before the password provider", async () => {
    await expect((passwordSignInWithNotifications as any)({ data: { attemptId: id, email: "owned@example.test", password: "test-invalid", outcome: "invalid_credentials", recipient: "attacker@example.test" } })).rejects.toThrow();
    expect(mocks.password).not.toHaveBeenCalled();
  });
  it("delegates notification correlation to the real current conditional policy branch", async () => {
    mocks.policy.mockResolvedValue({ action: "block", matched: { id: "rule" } });
    const result = await (evaluateLoginPolicyWithNotifications as any)({ data: { attemptId: id, tenantId: null }, context: context() });
    expect(result.action).toBe("block"); expect(mocks.policy).toHaveBeenCalledWith({ data: { tenantId: null, loginAttemptId: id } });
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it("allow and step-up results do not become failure alerts", async () => {
    for (const action of ["allow", "step_up"]) { mocks.policy.mockResolvedValue({ action }); await (evaluateLoginPolicyWithNotifications as any)({ data: { attemptId: id, tenantId: null }, context: context() }); }
    expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  });
  it("returns a policy block without a second independent notification write", async () => {
    mocks.policy.mockResolvedValue({ action: "block" });
    expect((await (evaluateLoginPolicyWithNotifications as any)({ data: { attemptId: id, tenantId: null }, context: context() })).action).toBe("block");
    expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  });
  it("records a real MFA code rejection without storing the code", async () => {
    const verify = vi.fn(async () => ({ data: null, error: { code: "mfa_verification_failed", status: 422 } }));
    mocks.provider.mockReturnValue({ auth: { mfa: { challengeAndVerify: verify } } });
    const result = await (verifyLoginMfaWithNotifications as any)({ data: { attemptId: id, factorId, code: "123456" }, context: context() });
    expect(result.ok).toBe(false); expect(mocks.finish).toHaveBeenCalledWith("mfa_invalid");
    expect(mocks.deps).toHaveBeenCalledWith(id, "mfa", "192.0.2.1", { userId: actorId });
    expect(verify).toHaveBeenCalledWith({ factorId, code: "123456" }); expect(JSON.stringify(mocks.finish.mock.calls)).not.toContain("123456");
  });
  it("rejects a factor outside the authenticated actor's verified factors", async () => {
    mocks.factors.mockResolvedValue({ data: { totp: [] }, error: null });
    const result = await (verifyLoginMfaWithNotifications as any)({ data: { attemptId: id, factorId, code: "123456" }, context: context() });
    expect(result.ok).toBe(false); expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it("records a genuine MFA factor-provider outage for the current actor without misclassifying an OTP", async () => {
    mocks.factors.mockResolvedValue({ data: null, error: { status: 503, code: "unexpected_failure", message: "withheld" } });
    const result = await (verifyLoginMfaWithNotifications as any)({ data: { attemptId: id, factorId, code: "123456" }, context: context() });
    expect(result.error).toMatchObject({ code: "provider_unavailable", status: 503, requestId: expect.any(String) });
    expect(mocks.finish).toHaveBeenCalledWith("provider_unavailable");
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.finish.mock.calls)).not.toContain("123456");
  });
  it("returns the provider-issued elevated session on successful MFA without a failure outcome", async () => {
    mocks.provider.mockReturnValue({ auth: { mfa: { challengeAndVerify: vi.fn(async () => ({ data: { access_token: "fixture-elevated", refresh_token: "fixture-refresh" }, error: null })) } } });
    const result = await (verifyLoginMfaWithNotifications as any)({ data: { attemptId: id, factorId, code: "123456" }, context: context() });
    expect(result.value).toEqual({ access_token: "fixture-elevated", refresh_token: "fixture-refresh" }); expect(mocks.finish).toHaveBeenCalledWith("success");
  });
  it("duplicate MFA processing does not create another challenge or email", async () => {
    const verify = vi.fn(); mocks.provider.mockReturnValue({ auth: { mfa: { challengeAndVerify: verify } } }); mocks.begin.mockResolvedValue({ acquired: false, outcome: "mfa_invalid" });
    await (verifyLoginMfaWithNotifications as any)({ data: { attemptId: id, factorId, code: "123456" }, context: context() });
    expect(verify).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  });
});
