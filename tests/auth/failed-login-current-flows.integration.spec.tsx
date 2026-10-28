// @vitest-environment jsdom
// Actual current pages; provider/framework calls are fixtures, not hosted proof.
import React from "react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { computeLandingPath } from "@/lib/auth-landing-resolver";
const m=vi.hoisted(()=>({password:vi.fn(),verify:vi.fn(),policy:vi.fn(),landing:vi.fn(),tenant:vi.fn(),navigate:vi.fn(),getUser:vi.fn(),setSession:vi.fn(),legacyPassword:vi.fn(),legacyMfa:vi.fn(),assurance:vi.fn(),factors:vi.fn(),signOut:vi.fn(),report:vi.fn(),toast:vi.fn()}));
vi.mock("@tanstack/react-router",()=>({createFileRoute:()=> (o: any)=>({...o,useSearch:()=>({redirect:"/owned/workspace"}),useLoaderData:()=>null,useParams:()=>({slug:"owned"})}),useNavigate:()=>m.navigate,useSearch:()=>({}),Link:({to,children}: any)=><a href={to}>{children}</a>}));
vi.mock("@tanstack/react-start",()=>({useServerFn:(fn: any)=>fn}));
vi.mock("@/lib/failed-login-notifications.functions",()=>({passwordSignInWithNotifications:m.password,verifyLoginMfaWithNotifications:m.verify,evaluateLoginPolicyWithNotifications:m.policy}));
vi.mock("@/lib/auth-landing.functions",()=>({postLoginLanding:m.landing,resolveLandingTenant:m.tenant}));
vi.mock("@/lib/tenant-branding.functions",()=>({getTenantBrandingBySlug:vi.fn()}));
vi.mock("@/lib/cross-domain",()=>({appUrl:(p:string)=>p}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getUser:m.getUser,setSession:m.setSession,signInWithPassword:m.legacyPassword,signOut:m.signOut,mfa:{getAuthenticatorAssuranceLevel:m.assurance,listFactors:m.factors,challengeAndVerify:m.legacyMfa}}}}));
vi.mock("@/lib/auth-audit",async original=>({...await original<any>(),reportAuthEvent:m.report}));
vi.mock("sonner",()=>({toast:{error:m.toast,success:vi.fn(),warning:vi.fn()}}));
import { Route as MfaRoute } from "@/routes/mfa-challenge";
import { Route as TenantRoute } from "@/routes/t.$slug.auth";
import { Route as AuthRoute } from "@/routes/auth";
const Mfa=MfaRoute.component as React.ComponentType,Tenant=TenantRoute.component as React.ComponentType,Auth=AuthRoute.component as React.ComponentType;
const actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",factor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",tenantId="cccccccc-cccc-4ccc-8ccc-cccccccccccc",requestId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
beforeEach(()=>{
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  m.getUser.mockResolvedValue({data:{user:null},error:null});
  m.password.mockResolvedValue({mode:"captured",ok:true,value:{access_token:"fixture-access",refresh_token:"fixture-refresh"}});
  m.verify.mockResolvedValue({mode:"captured",ok:false,error:{message:"That authentication code is invalid or expired.",status:400,code:"mfa_expired",requestId}});
  m.setSession.mockResolvedValue({data:{user:{id:actor,email:"owned@example.test"}},error:null});
  m.policy.mockResolvedValue({action:"allow",matched:null});
  const resolved=computeLandingPath({tenants:[{id:tenantId,slug:"owned",name:"Owned"}],preferredSlug:"owned"});
  m.tenant.mockResolvedValue(resolved);m.landing.mockResolvedValue(resolved);
  m.assurance.mockResolvedValue({data:{currentLevel:"aal1",nextLevel:"aal2"},error:null});
  m.factors.mockResolvedValue({data:{all:[{id:factor,status:"verified",factor_type:"totp"}]},error:null});
});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
async function submitMfa(){m.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});render(<Mfa/>);fireEvent.change(await screen.findByLabelText("Six-digit code"),{target:{value:"123456"}});fireEvent.submit(screen.getByLabelText("Six-digit code").closest("form")!);}
function submitPassword(Page:React.ComponentType){render(<Page/>);const email=screen.getByLabelText(/Email/i),password=screen.getByLabelText(/^Password$/i);fireEvent.change(email,{target:{value:"owned@example.test"}});fireEvent.change(password,{target:{value:"fixture-password"}});fireEvent.submit(email.closest("form")!);}
describe("new current MFA/tenant login integrations",()=>{
  it("MFA expiry uses the real capture endpoint and safe support reference, with no session adoption",async()=>{
    await submitMfa();expect((await screen.findByRole("alert")).textContent).toContain(requestId);
    expect(m.verify).toHaveBeenCalledWith({data:{attemptId:expect.any(String),factorId:factor,code:"123456"}});
    expect(m.legacyMfa).not.toHaveBeenCalled();expect(m.setSession).not.toHaveBeenCalled();expect(m.navigate).not.toHaveBeenCalled();
  });
  it("MFA retry is a distinct attempt and does not relabel a provider outage as a bad code",async()=>{
    m.verify.mockResolvedValue({mode:"captured",ok:false,error:{message:"Sign-in service is temporarily unavailable",status:503,code:"provider_unavailable",requestId}});
    await submitMfa();expect((await screen.findByRole("alert")).textContent).not.toContain("invalid or expired");
    const first=m.verify.mock.calls[0][0].data.attemptId;fireEvent.submit(screen.getByLabelText("Six-digit code").closest("form")!);
    await waitFor(()=>expect(m.verify).toHaveBeenCalledTimes(2));expect(m.verify.mock.calls[1][0].data.attemptId).not.toBe(first);
  });
  it("successful MFA adopts only the elevated provider-issued session before current redirect",async()=>{
    m.verify.mockResolvedValue({mode:"captured",ok:true,value:{access_token:"fixture-aal2",refresh_token:"fixture-refresh"}});
    await submitMfa();await waitFor(()=>expect(m.navigate).toHaveBeenCalledWith({to:"/owned/workspace",replace:true}));
    expect(m.setSession).toHaveBeenCalledWith({access_token:"fixture-aal2",refresh_token:"fixture-refresh"});
    expect(m.report).not.toHaveBeenCalledWith("auth.mfa_failed",expect.anything());
  });
  it("disabled MFA capture uses the current provider SDK instead of changing authentication semantics",async()=>{
    m.verify.mockResolvedValue({mode:"legacy"});m.legacyMfa.mockResolvedValue({data:{},error:null});
    await submitMfa();await waitFor(()=>expect(m.navigate).toHaveBeenCalled());expect(m.legacyMfa).toHaveBeenCalledWith({factorId:factor,code:"123456"});expect(m.setSession).not.toHaveBeenCalled();
  });
  it("MFA capture transport loss cannot retry verification through the legacy path",async()=>{
    m.verify.mockRejectedValue(Error("withheld"));await submitMfa();await screen.findByRole("alert");expect(m.legacyMfa).not.toHaveBeenCalled();expect(m.navigate).not.toHaveBeenCalled();
  });
  it("tenant password failure supplies the trusted endpoint and never navigates or adopts a session",async()=>{
    m.password.mockResolvedValue({mode:"captured",ok:false,error:{code:"invalid_credentials",message:"Invalid login credentials",status:400,requestId}});
    submitPassword(Tenant);await waitFor(()=>expect(m.toast).toHaveBeenCalledWith(expect.stringContaining(requestId)));expect(m.setSession).not.toHaveBeenCalled();expect(m.legacyPassword).not.toHaveBeenCalled();expect(m.navigate).not.toHaveBeenCalled();
  });
  it("tenant login uses actual resolved membership scope and preserves MFA step-up",async()=>{
    submitPassword(Tenant);await waitFor(()=>expect(m.navigate).toHaveBeenCalledWith({to:"/mfa-challenge",search:{redirect:"/owned/workspace"},replace:true}));
    expect(m.tenant).toHaveBeenCalledWith({data:{preferred_slug:"owned"}});expect(m.policy).toHaveBeenCalledWith({data:{attemptId:expect.any(String),tenantId}});
  });
  it("tenant current policy block signs out and prevents landing",async()=>{
    m.policy.mockResolvedValue({action:"block",matched:{id:"rule"}});submitPassword(Tenant);await waitFor(()=>expect(m.signOut).toHaveBeenCalledWith({scope:"local"}));expect(m.navigate).not.toHaveBeenCalled();
  });
  it("tenant verified AAL2 login lands after policy without unnecessary MFA",async()=>{
    m.assurance.mockResolvedValue({data:{currentLevel:"aal2",nextLevel:"aal2"},error:null});submitPassword(Tenant);await waitFor(()=>expect(m.navigate).toHaveBeenCalledWith({to:"/$slug/workspace",params:{slug:"owned"}}));
  });
  it("the main auth page consumes the real nested tenant result for policy evaluation",async()=>{
    submitPassword(Auth);await waitFor(()=>expect(m.policy).toHaveBeenCalledWith({data:{attemptId:expect.any(String),tenantId}}));
  });
  it("captured main-login failure displays trusted recovery guidance without inventing a lockout threshold",async()=>{
    m.password.mockResolvedValue({mode:"captured",ok:false,error:{message:"Invalid login credentials",code:"invalid_credentials",status:400,requestId,hint:"Check your email and password, or use Forgot Password to request a recovery link."}});
    submitPassword(Auth);const text=(await screen.findByRole("alert")).textContent;
    expect(text).toContain("Forgot Password");expect(text).toContain(requestId);expect(text).not.toMatch(/after\s+\d+\s+failed attempts/i);
  });
});
