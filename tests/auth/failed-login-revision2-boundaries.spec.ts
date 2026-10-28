import { describe,expect,it,vi } from "vitest";
import { renderFailedLoginEmail } from "@/lib/email-templates/failed-login";
import { processFailedLoginQueueMessage } from "@/lib/failed-login-email.server";
const id="10000000-0000-4000-8000-000000000001",requestId="20000000-0000-4000-8000-000000000001",lease="30000000-0000-4000-8000-000000000001";
describe("new claimed support-reference and delivery-ID boundaries",()=>{
  it("renders the recorded server support reference instead of an untrusted payload reference",async()=>{
    const notice=await renderFailedLoginEmail({attemptId:id,requestId,occurredAt:"2026-10-03T17:00:00Z",outcome:"invalid_credentials",origin:"https://app.reconiq.example"});
    expect(notice.text).toContain(requestId);expect(notice.text).not.toContain(id);
  });
  it("refuses credential-shaped support reference before rendering",async()=>{
    await expect(renderFailedLoginEmail({attemptId:id,requestId:"fixture.part.signature",occurredAt:"2026-10-03T17:00:00Z",outcome:"invalid_credentials",origin:"https://app.reconiq.example"})).rejects.toThrow();
  });
  it("queue uses the trusted claimed support reference and rechecks an injected sender receipt",async()=>{
    vi.stubEnv("SUPABASE_URL","https://YOUR_PROJECT_REF.supabase.co");
    const rpc=vi.fn(async(name:string)=>({error:null,data:name==="failed_login_claim"?{send:true,to:"owned@example.test",request_id:requestId,lease_id:lease,occurred_at:"2026-10-03T17:00:00Z",outcome:"invalid_credentials"}:true}));
    const sender=vi.fn(async(req: {textBody:string})=>{expect(req.textBody).toContain(requestId);expect(req.textBody).not.toContain("forged-reference");return{state:"provider_accepted" as const,messageId:"fixture.part.signature"};});
    const result=await processFailedLoginQueueMessage({rpc},{msg_id:12,message:{template:"auth.failed_login.verified",attempt_id:id,request_id:"forged-reference"}},"test-key",sender);
    expect(result).toEqual({sent:0,failed:1,state:"uncertain"});
    expect(rpc).toHaveBeenCalledWith("failed_login_settle",expect.objectContaining({_state:"uncertain",_provider_message_id:null,_diagnostic_code:"provider_response_unknown"}));
    vi.unstubAllEnvs();
  });
});
