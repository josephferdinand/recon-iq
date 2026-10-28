// @vitest-environment jsdom
// Actual NEXT pages; synthetic transport/identity fixtures, no hosted MFA claim.
import React from "react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
const m=vi.hoisted(()=>({password:vi.fn(),mfa:vi.fn(),current:vi.fn(),policy:vi.fn(),landing:vi.fn(),navigate:vi.fn(),getUser:vi.fn(),setSession:vi.fn(),signIn:vi.fn(),signOut:vi.fn(),assurance:vi.fn(),factors:vi.fn(),challenge:vi.fn(),reset:vi.fn(),update:vi.fn(),toast:vi.fn(),rate:vi.fn(),report:vi.fn()}));
vi.mock("@tanstack/react-router",()=>({createFileRoute:()=> (o:any)=>({...o,useSearch:()=>({redirect:"/owned/workspace"}),useLoaderData:()=>null,useParams:()=>({slug:"owned"})}),useNavigate:()=>m.navigate,useSearch:()=>({}),Link:({to,children}:any)=><a href={to}>{children}</a>}));
vi.mock("@tanstack/react-start",()=>({useServerFn:(fn:any)=>fn}));
vi.mock("@/lib/failed-login-notifications.functions",()=>({passwordSignInWithNotifications:m.password,verifyLoginMfaWithNotifications:m.mfa,reauthenticateCurrentPasswordWithNotifications:m.current,evaluateLoginPolicyWithNotifications:m.policy}));
vi.mock("@/lib/auth-landing.functions",()=>({postLoginLanding:m.landing,resolveLandingTenant:m.landing}));
vi.mock("@/lib/tenant-branding.functions",()=>({getTenantBrandingBySlug:vi.fn()}));
vi.mock("@/lib/security/auth-rate-limit.functions",()=>({checkAuthRateLimit:m.rate}));
vi.mock("@/lib/cross-domain",()=>({appUrl:(p:string)=>p}));
vi.mock("@/lib/sessions.functions",()=>({revokeAllSessions:vi.fn()}));
vi.mock("@/components/back-button",()=>({BackButton:()=>null}));
vi.mock("@tanstack/react-query",()=>({useMutation:(o:any)=>({mutate:()=>{Promise.resolve().then(o.mutationFn).then(o.onSuccess,o.onError);},isPending:false})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getUser:m.getUser,setSession:m.setSession,signInWithPassword:m.signIn,signOut:m.signOut,resetPasswordForEmail:m.reset,updateUser:m.update,mfa:{getAuthenticatorAssuranceLevel:m.assurance,listFactors:m.factors,challengeAndVerify:m.challenge}}}}));
vi.mock("@/lib/auth-audit",async original=>({...await original<any>(),reportAuthEvent:m.report}));
vi.mock("sonner",()=>({toast:{error:m.toast,success:vi.fn(),warning:vi.fn()}}));
import {Route as AuthRoute} from "@/routes/auth";
import {Route as MfaRoute} from "@/routes/mfa-challenge";
import {Route as TenantRoute} from "@/routes/t.$slug.auth";
import {Route as ProfileRoute} from "@/routes/_authenticated/profile.security";
const Auth=AuthRoute.component as React.ComponentType,Mfa=MfaRoute.component as React.ComponentType,Tenant=TenantRoute.component as React.ComponentType,Profile=ProfileRoute.component as React.ComponentType;
const actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",factor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",tenant="cccccccc-cccc-4ccc-8ccc-cccccccccccc",requestId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
beforeEach(()=>{
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  // jsdom has no point hit-testing; input-otp uses it only for its password
  // manager badge layout probe, not identity/authentication verification.
  Object.defineProperty(document,"elementFromPoint",{configurable:true,value:()=>null});
  m.getUser.mockResolvedValue({data:{user:null},error:null});m.landing.mockResolvedValue({path:"/owned/workspace",tenant:{id:tenant,slug:"owned"}});
  m.password.mockResolvedValue({mode:"captured",ok:false,error:{code:"invalid_credentials",message:"Invalid login credentials",status:400,requestId,hint:"Use Forgot Password to request recovery."}});
  m.mfa.mockResolvedValue({mode:"captured",ok:false,error:{code:"mfa_expired",message:"That authentication code is invalid or expired.",status:400,requestId}});
  m.policy.mockResolvedValue({action:"allow",matched:null});m.rate.mockResolvedValue({allowed:true});
  m.assurance.mockResolvedValue({data:{currentLevel:"aal1",nextLevel:"aal2"},error:null});m.factors.mockResolvedValue({data:{all:[{id:factor,status:"verified",factor_type:"totp"}]},error:null});
  m.setSession.mockResolvedValue({data:{user:{id:actor,email:"owned@example.test"},session:{}},error:null});
});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
function password(Page:React.ComponentType){render(<Page/>);const email=screen.getByLabelText(/Email/i);fireEvent.change(email,{target:{value:"owned@example.test"}});fireEvent.change(screen.getByLabelText(/^Password$/i),{target:{value:"fixture-wrong"}});fireEvent.submit(email.closest("form")!);}
describe("actual NEXT current-flow wiring",()=>{
  it("main sign-in failure uses the capture endpoint and safe support/recovery guidance",async()=>{password(Auth);const text=(await screen.findByRole("alert")).textContent;expect(text).toContain(requestId);expect(text).not.toMatch(/after\s+\d+\s+failed/);expect(m.signIn).not.toHaveBeenCalled();});
  it("NEXT reset outage is never sent to the sign-in notification endpoint",async()=>{m.reset.mockResolvedValue({error:{message:"temporarily unavailable",status:503}});render(<Auth/>);fireEvent.click(screen.getByRole("button",{name:/Forgot password/i}));const email=screen.getByLabelText(/Email/i);fireEvent.change(email,{target:{value:"owned@example.test"}});fireEvent.submit(email.closest("form")!);await screen.findByRole("alert");expect(m.password).not.toHaveBeenCalled();});
  it("actual NEXT premium MFA form uses capture and retains code clearing on failure",async()=>{m.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});render(<Mfa/>);const code=await screen.findByLabelText("Six-digit code");fireEvent.change(code,{target:{value:"123456"}});fireEvent.submit(code.closest("form")!);expect((await screen.findByRole("alert")).textContent).toContain(requestId);expect((code as HTMLInputElement).value).toBe("");expect(m.challenge).not.toHaveBeenCalled();expect(m.setSession).not.toHaveBeenCalled();});
  it("tenant policy block checks actual tenant scope and revokes only the local session",async()=>{m.password.mockResolvedValue({mode:"captured",ok:true,value:{access_token:"fixture-issued",refresh_token:"fixture-refresh"}});m.policy.mockResolvedValue({action:"block"});password(Tenant);await waitFor(()=>expect(m.signOut).toHaveBeenCalledWith({scope:"local"}));expect(m.policy).toHaveBeenCalledWith({data:{attemptId:expect.any(String),tenantId:tenant}});expect(m.navigate).not.toHaveBeenCalled();});
  it("current-password service outage in the actual NEXT form is truthful and cannot update or revoke sessions",async()=>{m.getUser.mockResolvedValue({data:{user:{id:actor,email:"owned@example.test"}},error:null});m.current.mockResolvedValue({mode:"captured",ok:false,error:{code:"provider_unavailable",message:"Sign-in service is temporarily unavailable",status:503,requestId}});render(<Profile/>);fireEvent.change(screen.getByLabelText("Current password"),{target:{value:"FixtureCurrent!234"}});fireEvent.change(screen.getByLabelText("New password"),{target:{value:"FixtureChanged!567"}});fireEvent.change(screen.getByLabelText("Confirm new password"),{target:{value:"FixtureChanged!567"}});fireEvent.submit(screen.getByLabelText("Current password").closest("form")!);const text=(await screen.findByRole("alert")).textContent;expect(text).not.toContain("Current password is incorrect");expect(m.update).not.toHaveBeenCalled();expect(m.signOut).not.toHaveBeenCalled();expect(m.signIn).not.toHaveBeenCalled();});
  it("password-change MFA outage remains a service failure and cannot update or revoke sessions",async()=>{
    m.getUser.mockResolvedValue({data:{user:{id:actor,email:"owned@example.test"}},error:null});m.current.mockResolvedValue({mode:"captured",ok:true,value:{access_token:"fixture-issued",refresh_token:"fixture-refresh"}});
    m.mfa.mockResolvedValue({mode:"captured",ok:false,error:{code:"provider_unavailable",message:"Sign-in service is temporarily unavailable",status:503,requestId}});
    render(<Profile/>);fireEvent.change(screen.getByLabelText("Current password"),{target:{value:"FixtureCurrent!234"}});fireEvent.change(screen.getByLabelText("New password"),{target:{value:"FixtureChanged!567"}});fireEvent.change(screen.getByLabelText("Confirm new password"),{target:{value:"FixtureChanged!567"}});
    const form=screen.getByLabelText("Current password").closest("form")!;fireEvent.submit(form);await waitFor(()=>expect(document.getElementById("password-change-mfa-code")).not.toBeNull());fireEvent.change(document.getElementById("password-change-mfa-code")!,{target:{value:"123456"}});fireEvent.submit(form);
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("temporarily unavailable"));expect(screen.getByRole("alert").textContent).not.toContain("Check the current code");expect(m.update).not.toHaveBeenCalled();expect(m.signOut).not.toHaveBeenCalled();expect(m.challenge).not.toHaveBeenCalled();
  });
});
