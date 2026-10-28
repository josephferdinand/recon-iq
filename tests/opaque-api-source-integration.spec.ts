// Mocked transport/DB contract integration only; no hosted auth/MFA/SQL proof.
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
const mocks=vi.hoisted(()=>({admin:undefined as any,caller:undefined as any,jwt:undefined as any,createClient:vi.fn(),resolve:vi.fn()}));
vi.mock('@tanstack/react-start',()=>({createServerFn:()=>{const builder:any={middleware:()=>builder,validator:(validate:any)=>{builder.validate=validate;return builder;},handler:(handler:any)=>({handler,validate:builder.validate})};return builder;}}));
vi.mock('@/integrations/supabase/auth-middleware',()=>({requireSupabaseAuth:()=>({})}));
vi.mock('@tanstack/react-router',()=>({createFileRoute:()=> (config:any)=>config}));
vi.mock('@/integrations/supabase/client.server',()=>({get supabaseAdmin(){return mocks.admin;}}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.createClient}));
vi.mock('@/lib/ai-inference-router.server',()=>({resolveInferenceRoute:mocks.resolve}));
import {createApiToken,revokeApiToken} from '@/lib/gtm.functions';
import {API_TOKEN_SCOPE_IDS,newApiTokenScopesSchema} from '@/lib/api-token-scopes';
import {Route as Ai} from '@/routes/api/public/ai/inference';
import {Route as History} from '@/routes/api/v1/$tenantSlug/recons/$reconId/runs/history';
import {Route as Results} from '@/routes/api/v1/$tenantSlug/recons/$reconId/runs/$runId/results';
const actor='aa000000-0000-4000-8000-000000000001',tenant='aa000000-0000-4000-8000-000000000002',tokenId='aa000000-0000-4000-8000-000000000003';
const recon='aa000000-0000-4000-8000-000000000004',runId='aa000000-0000-4000-8000-000000000005',requestId='aa000000-0000-4000-8000-000000000006';
const policy='aa000000-0000-4000-8000-000000000007',provider='aa000000-0000-4000-8000-000000000008',catalog='aa000000-0000-4000-8000-000000000009';
const create=createApiToken as any,revoke=revokeApiToken as any;
let row:any,memberActive:boolean,countFault:number|undefined,transportFault:boolean;
const savedRun=()=>({id:runId,run_uid:'QA-SOURCE-ONLY',definition_id:recon,status:'processed',matched_count:null,exception_count:null,total_rows:null,started_at:'2026-10-04T00:00:00Z',completed_at:null,matched_input_memberships:null});
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
function tableQuery(table:string){
 if(!['api_tokens','tenants'].includes(table))throw Error('Unexpected direct business table access');
 const filters:Record<string,unknown>={};
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q;},update:()=>q,
  maybeSingle:async()=>{
   if(transportFault)throw Error('PRIVATE DB transport detail');
   if(table==='api_tokens')return{data:row&&filters.token_hash===row.token_hash?row:null,error:null};
   return{data:filters.id===tenant&&filters.slug==='qa-tenant'?{id:tenant,slug:'qa-tenant',name:'QA'}:null,error:null};
  },then:(resolve:any)=>resolve({error:null})};return q;
}
beforeEach(()=>{
 row=null;memberActive=true;countFault=undefined;transportFault=false;
 mocks.caller={rpc:vi.fn(async(name:string,args:any)=>{
  if(name==='issue_user_delegated_api_token'){
   row={id:tokenId,tenant_id:tenant,created_by:actor,subject_user_id:actor,issuer_user_id:actor,principal_kind:'user_delegated',scopes:args._scopes,expires_at:args._expires_at,revoked_at:null,token_hash:args._token_hash};
   return{data:{id:tokenId,audit_id:'9007199254740993'},error:null};
  }
  if(name==='revoke_user_delegated_api_token'){row.revoked_at=new Date().toISOString();return{data:{id:tokenId,audit_id:'9007199254740994'},error:null};}
  throw Error('Unknown caller RPC');
 }),from:vi.fn(()=>{throw Error('Caller direct-write fallback prohibited');})};
 mocks.admin={from:vi.fn(tableQuery),rpc:vi.fn(async(name:string,args:any)=>{
  if(name==='rate_limit_hit')return{data:{allowed:true},error:null};
  if(name==='read_reconciliation_runs_for_api'){
   if(!memberActive||row.principal_kind!=='user_delegated')return{data:null,error:{code:'42501',message:'PRIVATE SQL denial'}};
   const data=args._mode==='history'?{rows:[savedRun()],total:countFault??1,page:1,page_size:50,has_next:false,audit_id:'9223372036854775807'}:
    {run:savedRun(),results:[],field_names:null,parent_count:countFault??null,page:1,page_size:50,has_next:false,status_counts:countFault===undefined?null:{match_groups:countFault,exception_items:0,exception_buckets:{}},audit_id:'9223372036854775807'};
   return{data,error:null};
  }
  if(name==='prepare_public_ai_inference'){
   if(row.revoked_at)return{data:{error:'token_revoked'},error:null};
   if(!memberActive||row.principal_kind!=='user_delegated')return{data:{error:'principal_denied'},error:null};
   if(!row.scopes.includes('ai.inference'))return{data:{error:'missing_scope'},error:null};
   return{data:{request_id:requestId,token_id:tokenId,tenant_id:tenant,subject_user_id:actor,principal_kind:'user_delegated',max_tokens:8,max_input_tokens:65536,
    route:{policy_id:policy,policy_name:'QA source policy',chain_index:0,provider_instance_id:provider,provider_code:'qa',provider_display:'QA',model_catalog_id:catalog,model_key:'qa-model',endpoint:'https://fixture.invalid/chat',auth_method:'bearer',custom_headers:{},api_version:null,vault_secret_id:null},vault:null},error:null};
  }
  if(name==='record_public_ai_inference_usage')return{data:true,error:null};
  throw Error('Unknown privileged RPC');
 })};
 mocks.createClient.mockReset().mockReturnValue(mocks.admin);mocks.resolve.mockReset();
 vi.stubEnv('SUPABASE_URL','https://fixture-db.invalid');vi.stubEnv('SUPABASE_PUBLISHABLE_KEY','synthetic-public');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','synthetic-server');
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{message:{content:'source fixture'}}],usage:{prompt_tokens:12,completion_tokens:2}})));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const mint=async(scopes=['recons.read','ai.inference'])=>create.handler({data:create.validate({tenant_id:tenant,name:'QA source token',scopes}),context:{userId:actor,supabase:mocks.caller}});
const get=(route:any,raw:string,path:string)=>route.server.handlers.GET({request:new Request(`https://app.reconiq.example${path}`,{headers:{authorization:`Bearer ${raw}`}}),params:{tenantSlug:'qa-tenant',reconId:recon,runId}});
const history=(raw:string)=>get(History,raw,`/api/v1/qa-tenant/recons/${recon}/runs/history?page=1&days=30`);
const results=(raw:string)=>get(Results,raw,`/api/v1/qa-tenant/recons/${recon}/runs/${runId}/results?page=1&status=all`);
const inference=(raw:string)=>(Ai as any).server.handlers.POST({request:new Request('https://app.reconiq.example/api/public/ai/inference',{method:'POST',headers:{authorization:`Bearer ${raw}`,'content-type':'application/json'},body:JSON.stringify({tenant_id:tenant,model:'qa-model',messages:[{role:'user',content:'source fixture only'}],max_tokens:8})})});

describe('normal issuer → real source routes → named principal/policy/budget contracts',()=>{
 it('carries one normally minted opaque verifier through both reads and reserved inference, without actor/JWT or table fallback',async()=>{
  const issued=await mint();expect(row.token_hash).toBe(hash(issued.token));
  const h=await history(issued.token),r=await results(issued.token),a=await inference(issued.token);
  expect(h.status).toBe(200);expect(r.status).toBe(200);expect(a.status).toBe(200);
  expect((await h.json()).rows[0]).toMatchObject({matched_count:null,total_rows:null});
  expect((await r.json()).audit_id).toBe('9223372036854775807');
  expect(mocks.admin.rpc.mock.calls.filter((x:any)=>x[0]==='read_reconciliation_runs_for_api').every((x:any)=>x[1]._token_id===tokenId&&!('_actor_user_id' in x[1])&&!('_claims' in x[1]))).toBe(true);
  expect(mocks.admin.rpc).toHaveBeenCalledWith('record_public_ai_inference_usage',expect.objectContaining({_request_id:requestId,_tokens_in:12,_tokens_out:2}));
  expect(mocks.admin.from.mock.calls.every((x:any)=>['api_tokens','tenants'].includes(x[0]))).toBe(true);
  expect(mocks.caller.from).not.toHaveBeenCalled();expect(mocks.resolve).not.toHaveBeenCalled();
 });
 it('revoke through the normal exact-tenant RPC denies both reads and inference before further provider work',async()=>{
  const issued=await mint();await revoke.handler({data:revoke.validate({id:issued.id,tenant_id:tenant}),context:{userId:actor,supabase:mocks.caller}});
  expect((await history(issued.token)).status).toBe(401);expect((await results(issued.token)).status).toBe(401);expect((await inference(issued.token)).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['inactive-member','unclassified'])('current SQL contract denies %s on both purposes; UI scope is not permission',async fault=>{
  const issued=await mint();if(fault==='inactive-member')memberActive=false;else row.principal_kind='unclassified';
  expect((await history(issued.token)).status).toBe(404);expect((await results(issued.token)).status).toBe(404);expect((await inference(issued.token)).status).toBe(403);expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects old aliases/wildcard and preserves separate exact inference/read scope decisions',async()=>{
  expect(API_TOKEN_SCOPE_IDS).toContain('recons.read');expect(API_TOKEN_SCOPE_IDS).not.toContain('recon.read');
  for(const scopes of [['recon.read'],['*'],['recons.read','recons.read']])expect(newApiTokenScopesSchema.safeParse(scopes).success).toBe(false);
  const readOnly=await mint(['recons.read']);expect((await history(readOnly.token)).status).toBe(200);expect((await inference(readOnly.token)).status).toBe(403);expect(fetch).not.toHaveBeenCalled();
 });
 it('maps hash/tenant auth transport failure to the leased read error without raw exception data',async()=>{
  const issued=await mint();transportFault=true;const response=await history(issued.token);
  expect(response.status).toBe(503);expect(await response.text()).toBe('{"error":"authentication_unavailable"}');expect(fetch).not.toHaveBeenCalled();
 });
 it.each([9007199254740992,1.5,-1])('refuses unsafe stored total/parent/bucket count %s instead of silently rounding',async value=>{
  const issued=await mint();countFault=value;expect((await history(issued.token)).status).toBe(503);expect((await results(issued.token)).status).toBe(503);
 });
 it('safe create/revoke transport failures never expose a bearer, retry, or use direct writes',async()=>{
  mocks.caller.rpc.mockRejectedValue(new Error('PRIVATE transport/provider detail'));
  await expect(mint()).rejects.toThrow('API token issuance unavailable.');
  await expect(revoke.handler({data:{id:tokenId,tenant_id:tenant},context:{userId:actor,supabase:mocks.caller}})).rejects.toThrow('API token revocation unavailable.');
  expect(mocks.caller.from).not.toHaveBeenCalled();expect(mocks.caller.rpc).toHaveBeenCalledTimes(2);
 });
});
