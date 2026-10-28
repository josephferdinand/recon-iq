import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const bin='C:/Program Files/PostgreSQL/17/bin';
const prior=JSON.parse(fs.readFileSync(path.join(out,'native-receipt.json'),'utf8'));
const bounded=process.argv.includes('--focus-bounded-locks');
if(prior.status!==(bounded?'NATIVE_VERSION_PASSED_CURRENT_CATALOG_PENDING':'NATIVE_SCOPE_PASSED_CURRENT_CATALOG_PENDING')||!prior.stopped)throw new Error('Requires retained completed and stopped own fixture');
const psql=['-X','-At','-h','127.0.0.1','-p',String(prior.port),'-U','postgres','-d',prior.database,'-v','ON_ERROR_STOP=1'];
const data=path.join(out,'native-pg17-data');
const log=fs.openSync(path.join(out,'native-pg-control.log'),'a');
const control=(action)=>{
 const r=spawnSync(path.join(bin,'pg_ctl.exe'),['-D',data,...(action==='start'?['-l',path.join(out,'native-server.log'),'-w','start']:['-m','fast','-w','stop'])],{windowsHide:true,stdio:['ignore',log,log],timeout:20000});
 if(r.error||r.status!==0)throw new Error('Own native pg_ctl '+action+' failed');
};
const execSql=sql=>spawnSync(path.join(bin,'psql.exe'),[...psql,'-c',sql],{windowsHide:true,encoding:'utf8',timeout:10000});
const report={tier:'isolated synthetic native PG17 concurrency; no hosted mutations',ready:false,engine:prior.engine,database:prior.database,cases:[]};
let locker;
try{
 control('start');
 const extract=s=>s.match(/CREATE (?:OR REPLACE )?FUNCTION private\.mapped_recon_governance_lock_scope\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$;/);
 const before=extract(fs.readFileSync(path.join(out,bounded?'native-concurrency-helper.sql':'native-fixture.sql'),'utf8'));
 const after=extract(fs.readFileSync('scripts/qa/mapped-recon-governance-implementation-20261004.inc.sql','utf8'));
 const hash=crypto.createHash('sha256').update(before[1]).digest('hex');
 const patch=`DO $guard$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='private.mapped_recon_governance_lock_scope(uuid,uuid)'::regprocedure)<> '${hash}' THEN RAISE EXCEPTION 'own fixture lock helper preimage changed'; END IF; END $guard$;\n`+after[0].replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION');
 fs.writeFileSync(path.join(out,bounded?'native-bounded-locks-helper.sql':'native-concurrency-helper.sql'),patch);
 const applied=execSql(patch);if(applied.status!==0)throw new Error(applied.stderr);
 if(bounded){
  const seeds=execSql(`INSERT INTO public.bu_user_assignments VALUES('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333331','22222222-2222-2222-2222-222222222222',true);
INSERT INTO public.tenant_groups VALUES('55555555-5555-5555-5555-555555555553','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333331');
INSERT INTO public.tenant_group_members VALUES('55555555-5555-5555-5555-555555555553','22222222-2222-2222-2222-222222222222');`);
  if(seeds.status!==0)throw new Error(seeds.stderr);
 }
 locker=spawn(path.join(bin,'psql.exe'),psql,{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let err='';locker.stderr.on('data',b=>{err+=b.toString();});
 const ready=new Promise((resolve,reject)=>{
  let text='';const timeout=setTimeout(()=>reject(new Error('Own lock acquisition timeout '+err)),10000);
  locker.stdout.on('data',b=>{text+=b.toString();if(text.includes('LOCK_READY')){clearTimeout(timeout);resolve();}});
  locker.once('exit',code=>{clearTimeout(timeout);reject(new Error('Own locker exited '+code+' '+err));});
 });
 locker.stdin.write(`BEGIN; SELECT private.mapped_recon_governance_lock_scope('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444441'); SELECT 'LOCK_READY';\n`);
 await ready;
 const probes=bounded?[
  ['relevant direct BU assignment revocation is serialized',`DELETE FROM public.bu_user_assignments WHERE user_id='22222222-2222-2222-2222-222222222223'`],
  ['relevant group membership revocation is serialized',`DELETE FROM public.tenant_group_members WHERE group_id='55555555-5555-5555-5555-555555555551'`],
 ]:[
  ['new grant FK insertion is serialized',`INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by) VALUES('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444441','33333333-3333-3333-3333-333333333331','user','22222222-2222-2222-2222-222222222223','approve','22222222-2222-2222-2222-222222222222')`],
  ['existing grant revocation is serialized',`DELETE FROM public.recon_definition_bu_grants WHERE recon_id='44444444-4444-4444-4444-444444444441' AND action='run'`],
  ['current principal membership revocation is serialized',`UPDATE public.tenant_members SET active=false WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND user_id='22222222-2222-2222-2222-222222222223'`],
 ];
 for(const [name,sql]of probes){
  const r=execSql(`SET lock_timeout='250ms'; ${sql}`);
  if(r.status!==1||!r.stderr.includes('canceling statement due to lock timeout'))throw new Error(name+' did not block: '+r.stderr);
  report.cases.push({name,passed:true,error:r.stderr.trim()});
 }
 if(bounded)for(const [name,sql]of [
  ['unrelated user association is not locked',`DELETE FROM public.bu_user_assignments WHERE user_id='22222222-2222-2222-2222-222222222222'`],
  ['unrelated group membership is not locked',`DELETE FROM public.tenant_group_members WHERE group_id='55555555-5555-5555-5555-555555555553'`],
 ]){
  const r=execSql(`BEGIN; SET lock_timeout='250ms'; ${sql}; ROLLBACK;`);
  if(r.status!==0)throw new Error(name+' was unexpectedly blocked: '+r.stderr);
  report.cases.push({name,passed:true});
 }
 locker.stdin.end('ROLLBACK;\n');
 await new Promise(resolve=>locker.once('exit',resolve));locker=null;
 report.status=bounded?'NATIVE_BOUNDED_LOCKS_PASSED_CURRENT_CATALOG_PENDING':'NATIVE_CONCURRENCY_PASSED_CURRENT_CATALOG_PENDING';
}catch(e){report.status='FAILED';report.error=e.message;process.exitCode=1;}
finally{
 if(locker){locker.stdin.end('ROLLBACK;\n');await new Promise(resolve=>locker.once('exit',resolve));}
 try{control('stop');report.stopped=true;}catch(e){report.stopError=e.message;process.exitCode=1;}
 fs.closeSync(log);fs.writeFileSync(path.join(out,bounded?'native-bounded-locks-receipt.json':'native-concurrency-receipt.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
