import { describe,it,expect,vi } from "vitest";
vi.mock("@/integrations/supabase/auth-middleware",()=>({requireSupabaseAuth:()=>"synthetic-auth-middleware"}));
vi.mock("@tanstack/react-start",()=>({createServerFn:()=>{let parse=(v:any)=>v;const chain:any={middleware:()=>chain,validator:(v:any)=>{parse=v;return chain;},handler:(handler:any)=>(args:any)=>handler({data:parse(args.data),context:args.context})};return chain;}}));
import { executeStatusIncidentCommand } from "@/lib/status.workflow.functions";
const command={request_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",incident_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",expected_revision:1,action:"review",payload:{reason:"Synthetic independent review"}};
const context=(admin:boolean,error:any=null)=>({userId:"11111111-1111-4111-8111-111111111111",supabase:{rpc:vi.fn().mockImplementation((name:string)=>name==="is_platform_admin"?Promise.resolve({data:admin,error:null}):({abortSignal:async()=>({data:{id:command.incident_id,revision:1,workflow_state:"reviewed",request_id:command.request_id},error})}))}});
describe("status command current-caller transport",()=>{
 it("checks current platform access before the action RPC",async()=>{const ctx=context(false);await expect((executeStatusIncidentCommand as any)({data:command,context:ctx})).rejects.toThrow("Current platform");expect(ctx.supabase.rpc).toHaveBeenCalledTimes(1);});
 it("uses fixed RPC/action fields and never accepts a caller actor override",async()=>{const ctx=context(true);await (executeStatusIncidentCommand as any)({data:{...command,actor_id:"forged"},context:ctx});expect(ctx.supabase.rpc.mock.calls[1]).toEqual(["status_incident_command",{_request_id:command.request_id,_incident_id:command.incident_id,_expected_revision:1,_action:"review",_payload:command.payload}]);});
 it("returns a refresh instruction on stale revision without exposing diagnostics",async()=>{const ctx=context(true,{code:"40001",message:"synthetic private database diagnostic"});await expect((executeStatusIncidentCommand as any)({data:command,context:ctx})).rejects.toThrow("This incident changed");});
});
