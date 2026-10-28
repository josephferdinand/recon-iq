import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/integrations/supabase/client.server",()=>({supabaseAdmin:{rpc:m.rpc}}));
import { serverPasswordSignIn } from "@/lib/failed-login-auth.server";
const id="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{
  vi.stubEnv("FAILED_LOGIN_NOTIFICATIONS_ENABLED","true");vi.stubEnv("SUPABASE_URL","https://YOUR_PROJECT_REF.supabase.co");vi.stubEnv("SUPABASE_AUTH_SECRET_KEY","sb_secret_fixture");vi.stubEnv("SUPABASE_AUTH_IP_FORWARDING_VERIFIED","true");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","fixture-secret");
  m.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='rate_limit_hit'?[{allowed:false}]:name==='failed_login_begin'?{acquired:true,outcome:'pending',requestId:'20000000-0000-4000-8000-000000000001'}:true}));
});
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
function request(){return new Request('https://app.reconiq.example/test',{headers:{origin:'https://app.reconiq.example','cf-connecting-ip':'192.0.2.1'}});}
describe('actual login rate-control denial capture',()=>{
  it('retains a genuine control denial without contacting the password provider',async()=>{
    const network=vi.fn();vi.stubGlobal('fetch',network);
    const result=await serverPasswordSignIn({attemptId:id,email:'owned@example.test',password:'fixture-password'},request());
    expect(result).toMatchObject({mode:'captured',ok:false,error:{status:429,code:'rate_limited',requestId:'20000000-0000-4000-8000-000000000001'}});
    expect(m.rpc).toHaveBeenCalledWith('rate_limit_hit',expect.objectContaining({_window_seconds:300,_limit:10}));
    expect(m.rpc).toHaveBeenCalledWith('failed_login_finish',expect.objectContaining({_outcome:'rate_limited'}));expect(network).not.toHaveBeenCalled();
  });
  it('records distinct rate denials and never substitutes caller email as the queue recipient',async()=>{
    await serverPasswordSignIn({attemptId:id,email:'unknown@example.test',password:'fixture-password'},request());
    await serverPasswordSignIn({attemptId:'10000000-0000-4000-8000-000000000002',email:'unknown@example.test',password:'fixture-password'},request());
    expect(m.rpc.mock.calls.filter(c=>c[0]==='failed_login_begin')).toHaveLength(2);
    expect(m.rpc.mock.calls.some(c=>c[0]==='enqueue_email')).toBe(false);
    expect(JSON.stringify(m.rpc.mock.calls)).not.toContain('fixture-password');
  });
  it('duplicate rate-denial processing returns the stored support reference without a second finish',async()=>{
    m.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='rate_limit_hit'?[{allowed:false}]:{acquired:false,outcome:'rate_limited',requestId:'20000000-0000-4000-8000-000000000001'}}));
    await serverPasswordSignIn({attemptId:id,email:'owned@example.test',password:'fixture-password'},request());
    expect(m.rpc.mock.calls.filter(c=>c[0]==='failed_login_finish')).toHaveLength(0);
  });
});
