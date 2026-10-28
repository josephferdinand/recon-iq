// Real PG sessions/barriers on the caller's Curie fixture only.
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
export async function qualifyReadRevocation({name,psql,output}){
 const log=[],results=[];
 const start=(label,sql)=>{
  const process=spawn('docker',['exec','-i',name,'psql','-X','-At','-U','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';const listeners=[];
  process.stdout.on('data',b=>{stdout+=b;for(const listener of listeners)listener();});process.stderr.on('data',b=>{stderr+=b;});
  const done=new Promise(resolve=>process.on('close',code=>resolve({code,stdout,stderr})));
  process.stdin.write(`SET application_name='${label}';\n${sql}\n`);
  return {process,done,marker:marker=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error(`${label} marker timeout`)),15000);
   const check=()=>{if(stdout.includes(marker)){clearTimeout(timer);resolve();}};listeners.push(check);check();
  })};
 };
 const service=`SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false);`;
 const waitForLock=async label=>{
  for(let n=0;n<60;n++){
   const state=psql(`SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${label}' AND wait_event_type='Lock') THEN 'LOCK_BARRIER_SEEN' ELSE 'PENDING' END;`);
   if(state.includes('LOCK_BARRIER_SEEN'))return;
   await new Promise(resolve=>setTimeout(resolve,100));
  }throw Error('No actual pg_stat_activity lock barrier');
 };
 for(const kind of ['token','membership']){
  const token=`ca000000-0000-4000-8000-0000000000${kind==='token'?'27':'28'}`;
  psql(`INSERT INTO public.api_tokens(id,tenant_id,name,prefix,token_hash,scopes,created_by,principal_kind,subject_user_id)
    VALUES('${token}','ca000000-0000-4000-8000-000000000001','New race ${kind}','fvi_99999999',repeat('${kind==='token'?'9':'8'}',64),ARRAY['recons.read'],'ca000000-0000-4000-8000-000000000011','user_delegated','ca000000-0000-4000-8000-000000000011');`);
  const mutation=kind==='token'?`UPDATE public.api_tokens SET revoked_at=clock_timestamp() WHERE id='${token}';`:
   `UPDATE public.tenant_members SET active=false WHERE tenant_id='ca000000-0000-4000-8000-000000000001' AND user_id='ca000000-0000-4000-8000-000000000011';`;
  let reader,writer;
  try{
   reader=start(`curie_${kind}_read_first`,`BEGIN; ${service} SELECT fvi_test.read_api(token=>'${token}')->>'audit_id'; SELECT 'READ_HELD';`);
   await reader.marker('READ_HELD');
   writer=start(`curie_${kind}_write_after`,`BEGIN; ${mutation} COMMIT; SELECT 'WRITE_DONE';`);
   await waitForLock(`curie_${kind}_write_after`);
   reader.process.stdin.end('COMMIT;\n');const read=await reader.done;
   writer.process.stdin.end();const write=await writer.done;
   log.push({kind,order:'read-first',read,write});
   if(read.code!==0||write.code!==0||!write.stdout.includes('WRITE_DONE'))throw Error(`${kind} read-first failure`);
   const denied=psql(`${service} SELECT fvi_test.denied('SELECT fvi_test.read_api(token=>''${token}'')','42501');`);log.push({kind,postCommitDenied:denied});
   results.push({kind,order:'read-first',writerBlocked:true,postCommitDenied:true});
  }finally{for(const client of [reader,writer])if(client&&client.process.exitCode===null){client.process.stdin.end('ROLLBACK;\n');await client.done;}}
  // Membership may be restored in this isolated fixture, not token revocation.
  if(kind==='membership')psql(`UPDATE public.tenant_members SET active=true WHERE user_id='ca000000-0000-4000-8000-000000000011';`);
  const secondToken=kind==='token'?'ca000000-0000-4000-8000-000000000029':token;
  if(kind==='token')psql(`INSERT INTO public.api_tokens(id,tenant_id,name,prefix,token_hash,scopes,created_by,principal_kind,subject_user_id)
    VALUES('${secondToken}','ca000000-0000-4000-8000-000000000001','New race token2','fvi_77777777',repeat('7',64),ARRAY['recons.read'],'ca000000-0000-4000-8000-000000000011','user_delegated','ca000000-0000-4000-8000-000000000011');`);
  const secondMutation=kind==='token'?mutation.replaceAll(token,secondToken):mutation;
  try{
   writer=start(`curie_${kind}_write_first`,`BEGIN; ${secondMutation} SELECT 'WRITE_HELD';`);await writer.marker('WRITE_HELD');
   reader=start(`curie_${kind}_read_after`,`BEGIN; ${service} SELECT fvi_test.read_api(token=>'${secondToken}'); COMMIT;`);
   await waitForLock(`curie_${kind}_read_after`);
   writer.process.stdin.end('COMMIT;\n');const write=await writer.done;
   reader.process.stdin.end();const read=await reader.done;log.push({kind,order:'revoke-first',read,write});
   if(write.code!==0||read.code===0||!read.stderr.includes('not permitted'))throw Error(`${kind} revoke-first denial failure`);
   results.push({kind,order:'revoke-first',readerBlocked:true,afterCommitDenied:true});
  }finally{for(const client of [reader,writer])if(client&&client.process.exitCode===null){client.process.stdin.end('ROLLBACK;\n');await client.done;}}
  if(kind==='membership')psql(`UPDATE public.tenant_members SET active=true WHERE user_id='ca000000-0000-4000-8000-000000000011';`);
 }
 writeFileSync(`${output}/concurrency.json`,JSON.stringify(log,null,2));return results;
}
