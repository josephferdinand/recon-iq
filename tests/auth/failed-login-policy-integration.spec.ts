import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), rules: vi.fn(), audit: vi.fn(), rpc: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate: (v: unknown) => unknown;
  const b: any = { middleware: () => b, validator: (v: any) => { validate = v; return b; }, handler: (h: any) => async ({ data, context }: any) => h({ data: validate(data), context }) };
  return b;
} }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: mocks.request, getRequestHeader: (key: string) => mocks.request().headers.get(key), getRequestIP: () => "192.0.2.1" }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
import { evaluateConditionalAccess } from "@/lib/tenant-admin-batch2.functions";
const id="50000000-0000-4000-8000-000000000001",actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",tenant="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const context = () => {
  const chain: any = { select: vi.fn(() => chain), eq: vi.fn(() => chain), order: mocks.rules };
  return { userId: actor, claims: { amr: [] }, supabase: { from: (name: string) => name === "conditional_access_rules" ? chain : { insert: mocks.audit } } };
};
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL","https://YOUR_PROJECT_REF.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","fixture-server-secret"); vi.stubEnv("FAILED_LOGIN_NOTIFICATIONS_ENABLED","true");
  mocks.request.mockReturnValue(new Request("https://app.reconiq.example/test",{headers:{origin:"https://app.reconiq.example","cf-connecting-ip":"192.0.2.1","cf-ipcountry":"ZZ","user-agent":"Fixture"}}));
  mocks.audit.mockResolvedValue({error:null});
  mocks.rpc.mockImplementation(async (name: string) => ({ error:null,data:name === "failed_login_begin" ? {acquired:true,outcome:"pending",requestId:"60000000-0000-4000-8000-000000000001"} : true }));
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const rule=(action: string)=>({id:"rule-1",name:"Current rule",action,priority:1,conditions:{blocked_countries:["ZZ"]}});
describe("actual conditional-access login notification branch",()=>{
  it("captures a real server-evaluated block for the authenticated actor after the existing audit",async()=>{
    mocks.rules.mockResolvedValue({data:[rule("block")],error:null});
    const result=await(evaluateConditionalAccess as any)({data:{tenantId:tenant,loginAttemptId:id},context:context()});
    expect(result).toMatchObject({action:"block",matched:{id:"rule-1"}});
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({event_type:"conditional_access.match",user_id:actor}));
    expect(mocks.rpc).toHaveBeenCalledWith("failed_login_begin",expect.objectContaining({_id:id,_stage:"policy",_email:null,_user_id:actor,_request_id:expect.any(String)}));
    expect(mocks.rpc).toHaveBeenCalledWith("failed_login_finish",expect.objectContaining({_outcome:"policy_blocked"}));
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });
  it.each(["allow","step_up"])("retains %s behavior with no failure email",async action=>{
    mocks.rules.mockResolvedValue({data:[rule(action)],error:null});
    expect((await(evaluateConditionalAccess as any)({data:{tenantId:tenant,loginAttemptId:id},context:context()})).action).toBe(action);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps unmatched/no-tenant results and ordinary admin evaluations notification-free",async()=>{
    mocks.rules.mockResolvedValue({data:[{...rule("block"),conditions:{blocked_countries:["OTHER"]}}],error:null});
    expect((await(evaluateConditionalAccess as any)({data:{tenantId:tenant,loginAttemptId:id},context:context()})).action).toBe("allow");
    expect((await(evaluateConditionalAccess as any)({data:{tenantId:null,loginAttemptId:id},context:context()})).action).toBe("allow");
    mocks.rules.mockResolvedValue({data:[rule("block")],error:null});
    expect((await(evaluateConditionalAccess as any)({data:{tenantId:tenant},context:context()})).action).toBe("block");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("browser hints cannot authorize an email even if an admin evaluator result matches",async()=>{
    mocks.rules.mockResolvedValue({data:[rule("block")],error:null});
    expect((await(evaluateConditionalAccess as any)({data:{tenantId:tenant,loginAttemptId:id,hints:{country:"ZZ"}},context:context()})).action).toBe("block");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("a recorder outage cannot turn a genuine policy block into allow",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    mocks.rules.mockResolvedValue({data:[rule("block")],error:null}); mocks.rpc.mockResolvedValue({data:null,error:{message:"withheld"}});
    expect((await(evaluateConditionalAccess as any)({data:{tenantId:tenant,loginAttemptId:id},context:context()})).action).toBe("block");
    expect(log).toHaveBeenCalledWith("[failed-login]",{code:"notification_record_unavailable",attemptId:id});log.mockRestore();
  });
  it("duplicate block notification does not finish or enqueue an already completed attempt",async()=>{
    mocks.rules.mockResolvedValue({data:[rule("block")],error:null});
    mocks.rpc.mockResolvedValue({error:null,data:{acquired:false,outcome:"policy_blocked",requestId:"60000000-0000-4000-8000-000000000001"}});
    await(evaluateConditionalAccess as any)({data:{tenantId:tenant,loginAttemptId:id},context:context()});
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("disabled activation retains the policy result without notification RPCs",async()=>{
    vi.stubEnv("FAILED_LOGIN_NOTIFICATIONS_ENABLED","false");mocks.rules.mockResolvedValue({data:[rule("block")],error:null});
    expect((await(evaluateConditionalAccess as any)({data:{tenantId:tenant,loginAttemptId:id},context:context()})).action).toBe("block");expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
