// Deterministic transport/auth doubles only. No real JWT, MFA, provider or
// hosted actor/token acceptance is asserted by these tests.
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {runOwnedAiQa,validateOwnedAiInputs,publicNegativeBody} from '../docs/handover/returns/2026-10-04-heisenberg-owned-ai-qa.mjs';

const actor='20000000-0000-4000-8000-000000000002';
const tenant='10000000-0000-4000-8000-000000000001';
const expected={route:'a'.repeat(64),helper:'b'.repeat(64)};
const jwt=(aal='aal2')=>`synthetic.${Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aal})).toString('base64url')}.unit-test-only`;
const input={environment:'PROD',application_origin:'https://app.reconiq.example',supabase_url:'https://YOUR_PROJECT_REF.supabase.co',qa_actor_authorized:true,
 actor_id:actor,tenant_id:tenant,model_key:'synthetic-qa-model',access_token:jwt(),publishable_key:'synthetic-public',server_key:'synthetic-server',real_mfa_evidence_reference:'synthetic-unit-reference-only'};
const ack={environment:'PROD',application_origin:input.application_origin,deployment_id:'90000000-0000-4000-8000-000000000009',curie_principal_applied:true,ai_contract_applied:true,
 current_budget_guard_pass:true,route_source_sha256:expected.route,helper_source_sha256:expected.helper};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const requestId='40000000-0000-4000-8000-000000000004';
function harness(options:{aal?:string;authDenied?:boolean;uncertainIssue?:boolean}={}){
 let now=Date.UTC(2026,9,4),counter=0,auditCounter=1,held=false;
 const tokens=new Map<string,any>();const audits=new Map<string,any>();const calls:any[]=[];const saves:any[]=[];
 const makeAudit=(action:string,resource:string,tokenId?:string)=>{
  const row={id_text:String(auditCounter++),tenant_id:tenant,actor_user_id:actor,action,resource_id:resource,context:tokenId?{token_id:tokenId}:{},row_hash:'synthetic-row-chain'};
  audits.set(`${action}:${resource}`,row);return row;
 };
 const fetch=vi.fn(async (url:string,opts:any)=>{
  const u=new URL(url);const body=opts.body?JSON.parse(opts.body):undefined;
  calls.push({origin:u.origin,path:u.pathname,body,authorization:opts.headers.authorization});
  if(u.pathname==='/auth/v1/user')return Response.json(options.authDenied?{error:'test-denial'}:{id:actor},{status:options.authDenied?401:200});
  if(u.pathname.endsWith('/rpc/issue_user_delegated_api_token')){
   const id=`30000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`;
   const token={id,hash:body._token_hash,name:body._name,prefix:body._prefix,scope:body._scopes,expiresAt:Date.parse(body._expires_at),revoked:false};tokens.set(body._token_hash,token);
   const row=makeAudit('api.token.create',id);
   if(options.uncertainIssue&&counter===1)throw Error('synthetic transport failure after commit');
   return Response.json({id,audit_id:row.id_text});
  }
  if(u.pathname.endsWith('/rpc/revoke_user_delegated_api_token')){
   const token=[...tokens.values()].find(x=>x.id===body._token_id);if(!token)throw Error('test token absent');
   token.revoked=true;const row=makeAudit('api.token.revoke',token.id);return Response.json({id:token.id,audit_id:row.id_text});
  }
  if(u.pathname.endsWith('/rpc/prepare_public_ai_inference')){
   const token=tokens.get(body._token_hash);held=true;makeAudit('api.ai.inference.prepare',requestId,token.id);
   return Response.json({request_id:requestId,token_id:token.id,subject_user_id:actor,tenant_id:tenant,principal_kind:'user_delegated',route:{model_key:input.model_key},max_tokens:1,max_input_tokens:65536});
  }
  if(u.pathname.endsWith('/rpc/record_public_ai_inference_usage')){
   const token=[...tokens.values()].find(x=>x.scope.includes('ai.inference'));makeAudit('api.ai.inference.record',requestId,token.id);return Response.json(true);
  }
  if(u.pathname==='/rest/v1/audit_log'){
   const action=u.searchParams.get('action')!.slice(3),resource=u.searchParams.get('resource_id')!.slice(3);
   return Response.json(audits.has(`${action}:${resource}`)?[audits.get(`${action}:${resource}`)]:[]);
  }
  if(u.pathname==='/rest/v1/api_tokens'){
   const name=u.searchParams.get('name')!.slice(3),prefix=u.searchParams.get('prefix')!.slice(3);
   return Response.json([...tokens.values()].filter(x=>x.name===name&&x.prefix===prefix).map(x=>({id:x.id,name:x.name,prefix:x.prefix,created_by:actor,tenant_id:tenant})));
  }
  if(u.pathname==='/api/public/ai/inference'){
   if(body.tenant_id===tenant)throw Error('Forbidden positive public probe');
   const raw=opts.headers.authorization.slice(7),token=tokens.get(hash(raw));
   const [status,error]=token.revoked?[401,'token revoked']:token.expiresAt<=now?[401,'token expired']:!token.scope.includes('ai.inference')?[403,'token lacks ai.inference scope']:[403,'tenant scope mismatch'];
   return Response.json({error},{status:Number(status)});
  }
  throw Error('Unapproved endpoint');
 });
 return {fetch,calls,tokens,saves,held:()=>held,deps:{fetch,now:()=>now,pause:async(ms:number)=>{now+=ms;},save:async(r:any)=>{saves.push(JSON.parse(JSON.stringify(r)));}}};
}

describe('owned AI QA driver deployment/MFA and no-paid boundary',()=>{
 it.each([
  {...ack,ai_contract_applied:false},{...ack,curie_principal_applied:false},{...ack,current_budget_guard_pass:false},
  {...ack,route_source_sha256:'c'.repeat(64)},{...ack,helper_source_sha256:'c'.repeat(64)},
  {...ack,application_origin:'https://unapproved.invalid'},
 ])('refuses an incomplete or mismatched parent ACK before network %#',async invalid=>{
  const h=harness();await expect(runOwnedAiQa(input,invalid,expected,h.deps)).rejects.toThrow();expect(h.fetch).not.toHaveBeenCalled();
 });
 it('refuses cross-project and unauthorized actor input',()=>{
  expect(()=>validateOwnedAiInputs({...input,supabase_url:'https://other.invalid'},ack,expected)).toThrow();
  expect(()=>validateOwnedAiInputs({...input,qa_actor_authorized:false},ack,expected)).toThrow();
 });
 it('always selects a different tenant for public HTTP probes',()=>{
  for(let n=0;n<20;n++)expect(publicNegativeBody(tenant).tenant_id).not.toBe(tenant);
 });
 it('performs bounded normal mint/preparation/unknown receipt/public denials/cleanup without a provider call',async()=>{
  const h=harness(),r=await runOwnedAiQa(input,ack,expected,h.deps);
  expect(r.status).toBe('LIVE_QUALIFIED_PREPARE_NEGATIVES_AND_UNKNOWN_HOLD_PROVEN_FULL_INFERENCE_OPEN');
  expect(r.publicPositiveInferenceExecuted).toBe(false);expect(r.knownUsageSettlementLive).toBe(false);expect(r.remaining.length).toBeGreaterThan(0);
  expect(h.held()).toBe(true);expect([...h.tokens.values()].every(x=>x.revoked)).toBe(true);
  expect(h.calls.filter(x=>x.path==='/api/public/ai/inference')).toHaveLength(4);
  expect(h.calls.every(x=>[input.application_origin,input.supabase_url].includes(x.origin))).toBe(true);
  expect(h.calls.find(x=>x.path.endsWith('/record_public_ai_inference_usage')).body).toMatchObject({_tokens_in:null,_tokens_out:null});
  expect(JSON.stringify(h.saves)).not.toContain(input.server_key);expect(JSON.stringify(h.saves)).not.toContain(input.access_token);
  expect(JSON.stringify(h.saves)).not.toContain('_token_hash');
 });
 it('refuses an AAL1 test session before minting anything',async()=>{
  const h=harness(),r=await runOwnedAiQa({...input,access_token:jwt('aal1')},ack,expected,h.deps);
  expect(r.status).toBe('FAILED');expect(h.tokens.size).toBe(0);expect(h.calls).toHaveLength(1);
 });
 it('refuses an unverified actor before any named write',async()=>{
  const h=harness({authDenied:true}),r=await runOwnedAiQa(input,ack,expected,h.deps);
  expect(r.status).toBe('FAILED');expect(h.tokens.size).toBe(0);
 });
 it('recovers and revokes only its uncertain NEW mint through ordinary caller metadata',async()=>{
  const h=harness({uncertainIssue:true}),r=await runOwnedAiQa(input,ack,expected,h.deps);
  expect(r.status).toBe('FAILED');expect(h.tokens.size).toBe(1);expect([...h.tokens.values()][0].revoked).toBe(true);
  expect(h.calls.filter(x=>x.path==='/rest/v1/api_tokens')).toHaveLength(1);
  expect(h.calls.filter(x=>x.path==='/rest/v1/api_tokens')[0].authorization).toBe(`Bearer ${input.access_token}`);
  expect(h.calls.filter(x=>x.path.endsWith('/issue_user_delegated_api_token'))).toHaveLength(1);
  expect(r.failureCode).toBe('QA_STAGE_FAILED_DETAILS_WITHHELD');
 });
});
