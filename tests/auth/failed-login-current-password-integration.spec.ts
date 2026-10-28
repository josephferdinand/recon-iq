import {describe,expect,it,vi} from "vitest";
import {changeProfilePassword} from "@/lib/profile-password-change";
import {profileLoginVerification} from "@/lib/profile-login-notifications";
const user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"owned@example.test"};
const input={currentPassword:"FixtureCurrent!234",newPassword:"FixtureChanged!567",confirmation:"FixtureChanged!567",signOutOthers:false,mfaCode:"123456"};
function fixture(){return{getUser:vi.fn(async()=>({data:{user},error:null})),signInWithPassword:vi.fn(async()=>({data:{user,session:{}},error:null})),setSession:vi.fn(async()=>({data:{user,session:{}},error:null})),updateUser:vi.fn(async()=>({data:{user},error:null})),signOut:vi.fn(async()=>({error:null})),mfa:{getAuthenticatorAssuranceLevel:vi.fn(async()=>({data:{currentLevel:"aal1",nextLevel:"aal1"},error:null})),listFactors:vi.fn(async()=>({data:{all:[{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",status:"verified",factor_type:"totp"}]},error:null})),challengeAndVerify:vi.fn(async()=>({data:{},error:null}))}};}
const success={mode:"captured" as const,ok:true as const,value:{access_token:"fixture-issued",refresh_token:"fixture-issued-refresh"}};
describe("current-password and password-change MFA notification integration",()=>{
  it("uses trusted current-password capture and fresh session before the authorized update",async()=>{
    const auth=fixture(),password=vi.fn(async()=>success),mfa=vi.fn(async()=>success);
    await changeProfilePassword(auth,input,profileLoginVerification(auth,{password,mfa}));
    expect(password).toHaveBeenCalledWith({data:{attemptId:expect.any(String),password:input.currentPassword}});
    expect(auth.signInWithPassword).not.toHaveBeenCalled();expect(auth.setSession).toHaveBeenCalledWith(success.value);
    expect(auth.setSession.mock.invocationCallOrder[0]).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0]);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("real wrong-current-password response cannot update a password or switch sessions",async()=>{
    const auth=fixture(),password=vi.fn(async()=>({mode:"captured" as const,ok:false as const,error:{message:"Invalid login credentials",code:"invalid_credentials",status:400}}));
    await expect(changeProfilePassword(auth,input,profileLoginVerification(auth,{password,mfa:async()=>success}))).rejects.toMatchObject({code:"reauthentication"});
    expect(auth.updateUser).not.toHaveBeenCalled();expect(auth.setSession).not.toHaveBeenCalled();expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("captured password-change MFA failure cannot update and cannot retry through the browser provider",async()=>{
    const auth=fixture();auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({data:{currentLevel:"aal1",nextLevel:"aal2"},error:null});
    const mfa=vi.fn(async()=>({mode:"captured" as const,ok:false as const,error:{message:"Authenticator code expired",code:"mfa_expired",status:400}}));
    await expect(changeProfilePassword(auth,input,profileLoginVerification(auth,{password:async()=>success,mfa}))).rejects.toMatchObject({code:"mfa_verification"});
    expect(mfa).toHaveBeenCalledWith({data:{attemptId:expect.any(String),factorId:expect.any(String),code:"123456"}});expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("keeps existing provider paths when capture is disabled",async()=>{
    const auth=fixture();await changeProfilePassword(auth,input,profileLoginVerification(auth,{password:async()=>({mode:"legacy"}),mfa:async()=>({mode:"legacy"})}));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({email:user.email,password:input.currentPassword});expect(auth.setSession).not.toHaveBeenCalled();
  });
  it("transport uncertainty does not perform an uncaptured current-password retry",async()=>{
    const auth=fixture();await expect(changeProfilePassword(auth,input,profileLoginVerification(auth,{password:async()=>{throw Error("withheld");},mfa:async()=>success}))).rejects.toThrow();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("a mismatched fresh account is rejected before update or session revocation",async()=>{
    const auth=fixture();auth.setSession.mockResolvedValue({data:{user:{...user,id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},session:{}},error:null});
    await expect(changeProfilePassword(auth,input,profileLoginVerification(auth,{password:async()=>success,mfa:async()=>success}))).rejects.toMatchObject({code:"identity"});expect(auth.updateUser).not.toHaveBeenCalled();expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("a mismatched elevated MFA account also stops before update",async()=>{
    const auth=fixture();auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({data:{currentLevel:"aal1",nextLevel:"aal2"},error:null});
    auth.setSession.mockResolvedValueOnce({data:{user,session:{}},error:null}).mockResolvedValueOnce({data:{user:{...user,id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},session:{}},error:null});
    await expect(changeProfilePassword(auth,input,profileLoginVerification(auth,{password:async()=>success,mfa:async()=>success}))).rejects.toMatchObject({code:"identity"});expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
