// Parent-owned post-release invocation only. No credentials/tokens in source/logs.
// Creates/revokes only one NEW QA token through the normal authenticated RPCs.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
const args=process.argv.slice(2);
const inputPath=args.find(x=>x.startsWith('--input='))?.slice(8);
if(!args.includes('--execute')||!inputPath||!args.some(x=>x.startsWith('--release-ack=')&&x.length>14)){
 console.log(JSON.stringify({status:'NOT_RUN',requires:'Parent release ACK, --execute, --input=<private JSON path>',inputKeys:['environment','actor_id','tenant_id','tenant_slug','recon_id','run_id','qa_actor_authorized','access_token','publishable_key','supabase_url','application_origin','receipt_path'],scope:'One new QA token; authenticated issue, opaque reads, own audit receipts, revoke, post-revoke denial. Existing tokens/keys untouched.'}));process.exit(0);
}
const input=JSON.parse(await readFile(inputPath,'utf8'));
const environments={PROD:{ref:'YOUR_PROJECT_REF',origin:'https://app.reconiq.example'},DEV:{ref:'YOUR_PROJECT_REF',origin:'https://dev.app.reconiq.example'}};
const target=environments[input.environment];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
if(!target||input.application_origin!==target.origin||input.supabase_url!==`https://${target.ref}.supabase.co`||input.qa_actor_authorized!==true
 ||!['actor_id','tenant_id','recon_id','run_id'].every(k=>uuid.test(input[k]??''))||!/^[a-z0-9-]{1,64}$/u.test(input.tenant_slug??'')
 ||typeof input.access_token!=='string'||typeof input.publishable_key!=='string'||typeof input.receipt_path!=='string')throw Error('Explicit authorized QA inputs/target required; values withheld');
const signedHeaders={apikey:input.publishable_key,authorization:`Bearer ${input.access_token}`,'content-type':'application/json'};
const receipt={environment:input.environment,at:new Date().toISOString(),operatorReleaseAck:args.find(x=>x.startsWith('--release-ack=')).slice(14),actorId:input.actor_id,tenantId:input.tenant_id,reconId:input.recon_id,runId:input.run_id,stages:[],status:'IN_PROGRESS'};
const save=()=>writeFile(input.receipt_path,JSON.stringify(receipt,null,2));
const auditId=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/u.test(value)&&BigInt(value)<=9223372036854775807n;
const call=async(url,options)=>{const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw Error(`HTTP${response.status} invalid JSON; body withheld`);}return{http:response.status,data,bodySha256:createHash('sha256').update(text).digest('hex')};};
const rpc=async(name,body)=>{const result=await call(`${input.supabase_url}/rest/v1/rpc/${name}`,{method:'POST',headers:signedHeaders,body:JSON.stringify(body)});if(result.http!==200)throw Error(`${name} HTTP${result.http}; body withheld`);return result.data;};
const verifyAudit=async(id,action,resource,tokenId)=>{
 if(!auditId(id))throw Error('Invalid committed int8 receipt');
 const select='id_text:id::text,tenant_id,actor_user_id,action,resource_id,context,row_hash';
 const result=await call(`${input.supabase_url}/rest/v1/audit_log?select=${encodeURIComponent(select)}&id=eq.${id}`,{headers:signedHeaders});
 const row=result.data?.[0];
 if(result.http!==200||result.data.length!==1||row.id_text!==id||row.tenant_id!==input.tenant_id||row.actor_user_id!==input.actor_id||row.action!==action||row.resource_id!==resource||!row.row_hash
   ||(tokenId&&row.context?.api_token_id!==tokenId))throw Error('Caller-bound audit readback unavailable/mismatched; no privileged fallback');
 return{id,action,resource,actorId:row.actor_user_id,tenantId:row.tenant_id,bodySha256:result.bodySha256};
};
const raw=`fvi_${randomBytes(24).toString('hex')}`;let tokenId,revoked=false;
const base=`${target.origin}/api/v1/${encodeURIComponent(input.tenant_slug)}/recons/${input.recon_id}/runs`;
try{
 const user=await call(`${input.supabase_url}/auth/v1/user`,{headers:signedHeaders});
 if(user.http!==200||user.data.id!==input.actor_id)throw Error('Actual authenticated actor mismatch; no role/session repair');
 const payload=JSON.parse(Buffer.from(input.access_token.split('.')[1]??'','base64url').toString('utf8'));
 // Server acceptance of the signed user token precedes recording its AAL claim;
 // this is still not evidence of an interactive MFA challenge in this driver.
 receipt.signedSessionAal=payload.aal??null;
 const issued=await rpc('issue_user_delegated_api_token',{_tenant_id:input.tenant_id,_name:`Owned API read QA ${randomUUID()}`,_prefix:raw.slice(0,12),_token_hash:createHash('sha256').update(raw).digest('hex'),_scopes:['recons.read'],_expires_at:new Date(Date.now()+3600000).toISOString()});
 if(!uuid.test(issued.id??'')||!auditId(issued.audit_id))throw Error('Issue receipt invalid');
 tokenId=issued.id;receipt.newTokenId=tokenId;await save();
 receipt.stages.push(await verifyAudit(issued.audit_id,'api.token.create',tokenId));await save();
 const opaqueHeaders={authorization:`Bearer ${raw}`,'x-fvi-request-id':randomUUID()};
 for(const [mode,url] of [['history',`${base}/history?page=1&days=30`],['results',`${base}/${input.run_id}/results?page=1&status=all`]]){
  const result=await call(url,{headers:opaqueHeaders});const data=result.data;
  if(result.http!==200||data.page!==1||data.page_size!==50||!auditId(data.audit_id))throw Error(`${mode} read contract HTTP${result.http}; body withheld`);
  if(mode==='history'&&(!Array.isArray(data.rows)||data.rows.length>50||data.rows.some(r=>r.definition_id!==input.recon_id)))throw Error('History scope/page mismatch');
  if(mode==='results'&&(data.run?.id!==input.run_id||data.run?.definition_id!==input.recon_id||!Array.isArray(data.results)||data.results.length>50))throw Error('Exact result scope/page mismatch');
  receipt.stages.push({mode,http:result.http,page:data.page,pageSize:data.page_size,rowCount:(mode==='history'?data.rows:data.results).length,storedCounts:mode==='results'?{matched:data.run.matched_count,exceptions:data.run.exception_count,total:data.run.total_rows}:undefined,bodySha256:result.bodySha256,
   audit:await verifyAudit(data.audit_id,mode==='history'?'api.reconciliation.run_history.read':'api.reconciliation.run_results.read',mode==='history'?input.recon_id:input.run_id,tokenId)});await save();
 }
 const revoke=await rpc('revoke_user_delegated_api_token',{_tenant_id:input.tenant_id,_token_id:tokenId});
 if(revoke.id!==tokenId||!auditId(revoke.audit_id))throw Error('Revocation receipt mismatch');
 revoked=true;receipt.stages.push(await verifyAudit(revoke.audit_id,'api.token.revoke',tokenId));await save();
 const denied=await call(`${base}/history?page=1&days=30`,{headers:opaqueHeaders});
 if(![401,404].includes(denied.http))throw Error(`Post-revoke read not denied: HTTP${denied.http}`);
 receipt.stages.push({stage:'post-revoke',http:denied.http});receipt.status='LIVE-PROVEN bounded normal issuance/opaque read/audit/revoke';
}catch(error){receipt.status='FAILED';receipt.failure=error.message;process.exitCode=1;}
finally{
 if(tokenId&&!revoked){try{const cleanup=await rpc('revoke_user_delegated_api_token',{_tenant_id:input.tenant_id,_token_id:tokenId});receipt.cleanupNewToken={id:tokenId,revoked:cleanup.id===tokenId&&auditId(cleanup.audit_id)};}catch{receipt.cleanupNewToken={id:tokenId,revoked:false,requiresParentAction:true};}}
 await save();console.log(JSON.stringify({environment:input.environment,status:receipt.status,receipt:input.receipt_path,newTokenId:tokenId,cleanupRequiresParent:receipt.cleanupNewToken?.requiresParentAction??false}));
}
