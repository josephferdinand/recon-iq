// Targeted follow-up only: retained Curie PG17 fixtures, no accepted-suite rerun.
// JWT AAL claims and settings are synthetic; this is not a real MFA/login proof.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const packet='docs/handover/returns/2026-10-03-curie-recon-read-packet';
const q=x=>`"${String(x).replaceAll('"','""')}"`,lit=x=>`'${String(x).replaceAll("'","''")}'`;
const results=[];
const docker=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:30000,maxBuffer:3*1024*1024});if(r.error||r.status!==0)throw Error(`${args[0]} failed: ${r.error?.message??r.stderr}`);return r.stdout;};
for(const environment of ['PROD','DEV']){
 const original=JSON.parse(readFileSync(`${packet}/native-${environment}/receipt.json`));
 const name=original.container;if(!/^fvi-curie-recon-read-(prod|dev)-[a-f0-9]{8}$/u.test(name)||original.status!=='PASS')throw Error('Retained accepted fixture absent');
 if(docker(['inspect','--format','{{index .Config.Labels "fvi.owner"}}',name]).trim()!=='curie-recon-read')throw Error('Fixture ownership mismatch');
 const file=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-RECON-TOKEN-ASSURANCE-${environment}-20261003.json`;
 const bytes=readFileSync(file),catalog=JSON.parse(bytes);
 if(catalog.read_only!==true||catalog.ledger!==(environment==='PROD'?448:426)||catalog.latest!=='20261002133100')throw Error('Current catalog identity drift');
 const policies=catalog.policies.filter(p=>p.tablename==='api_tokens');
 const baseline=JSON.parse(readFileSync(`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-RECON-READ-SUPPLEMENT-${environment}-20261003.json`));
 if(JSON.stringify(policies)!==JSON.stringify(baseline.policies.filter(p=>p.tablename==='api_tokens')))throw Error('Current token RLS drift; requalify');
 const guard=catalog.helpers.find(h=>h.schema==='public'&&h.name==='guard_api_token_principal_metadata');
 if(guard.definition!==baseline.helpers.find(h=>h.schema==='public'&&h.name===guard.name).definition)throw Error('Token trigger drift');
 if(/aal2|mfa_required|assurance/iu.test(JSON.stringify(policies)+guard.definition))throw Error('Actual token assurance predicate found: preserve it before testing');
 const output=`${packet}/assurance-${environment}`;mkdirSync(output,{recursive:true});
 const columns=catalog.columns.filter(c=>c.table==='tenant_security_settings');
 let sql=`BEGIN; RESET ROLE; CREATE TABLE public.tenant_security_settings(${columns.map(c=>`${q(c.name)} ${c.type}${c.default?` DEFAULT ${c.default}`:''}${c.not_null?' NOT NULL':''}`).join(',')});
 ALTER TABLE public.tenant_security_settings ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE ON public.tenant_security_settings TO authenticated;
 `;
 for(const p of catalog.policies.filter(p=>p.tablename==='tenant_security_settings'))sql+=`CREATE POLICY ${q(p.policyname)} ON public.tenant_security_settings AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':q(r)).join(',')}${p.qual?` USING (${p.qual})`:''}${p.with_check?` WITH CHECK (${p.with_check})`:''};\n`;
 sql+=`INSERT INTO public.tenant_security_settings(tenant_id) VALUES('ca000000-0000-4000-8000-000000000001');\n`;
 let cases=0;
 for(const required of [false,true])for(const aal of ['aal1','aal2']){
  const label=`mfa_required=${required}, ${aal}`;cases++;
  const claims=JSON.stringify({sub:'ca000000-0000-4000-8000-000000000012',role:'authenticated',aal});
  const hash=`${required?'1':'0'}${aal==='aal1'?'1':'2'}`.repeat(32);
  const rpcHash=`${required?'3':'4'}${aal==='aal1'?'1':'2'}`.repeat(32);
  sql+=`RESET ROLE; UPDATE public.tenant_security_settings SET mfa_required=${required}; SET ROLE authenticated;
  SELECT set_config('request.jwt.claims',${lit(claims)},true),set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000012',true),set_config('request.jwt.claim.role','authenticated',true);
  SELECT fvi_test.assert_true(auth.jwt()->>'aal'=${lit(aal)},'explicit synthetic AAL claim');
  SELECT fvi_test.assert_true((SELECT mfa_required=${required} FROM public.tenant_security_settings WHERE tenant_id='ca000000-0000-4000-8000-000000000001'),'actual-shaped visible tenant policy flag');
  INSERT INTO public.api_tokens(tenant_id,name,prefix,token_hash,scopes,created_by)
   VALUES('ca000000-0000-4000-8000-000000000001',${lit('old direct '+label)},'fvi_12121212',${lit(hash)},ARRAY['recons.read'],auth.uid());
  SELECT fvi_test.assert_true((SELECT principal_kind='unclassified' FROM public.api_tokens WHERE token_hash=${lit(hash)}),${lit('old direct issuance allowed: '+label)});
  UPDATE public.api_tokens SET revoked_at=clock_timestamp() WHERE token_hash=${lit(hash)};
  SELECT fvi_test.assert_true((SELECT revoked_at IS NOT NULL FROM public.api_tokens WHERE token_hash=${lit(hash)}),${lit('old direct revocation allowed: '+label)});
  INSERT INTO fvi_test.state(key,value) SELECT ${lit('assurance-'+label)},public.issue_user_delegated_api_token('ca000000-0000-4000-8000-000000000001',${lit('new RPC '+label)},'fvi_34343434',${lit(rpcHash)},ARRAY['recons.read'],NULL)->>'id';
  SELECT fvi_test.assert_true((SELECT principal_kind='user_delegated' AND subject_user_id=auth.uid() FROM public.api_tokens WHERE token_hash=${lit(rpcHash)}),${lit('new self-bound issuance allowed: '+label)});
  SELECT public.revoke_user_delegated_api_token('ca000000-0000-4000-8000-000000000001',(SELECT value::uuid FROM fvi_test.state WHERE key=${lit('assurance-'+label)}));
  SELECT fvi_test.assert_true((SELECT revoked_at IS NOT NULL FROM public.api_tokens WHERE token_hash=${lit(rpcHash)}),${lit('new atomic revocation allowed: '+label)});
  SELECT ${lit('PASS '+label+' old-insert/old-revoke/new-issue/new-revoke')};\n`;
 }
 sql+='RESET ROLE; ROLLBACK; SELECT version();\n';writeFileSync(`${output}/qualification.sql`,sql);
 let receipt,started=false;
 try{
  docker(['start',name]);started=true;
  for(let n=0;n<30;n++){if(spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{timeout:1000}).status===0)break;if(n===29)throw Error('Retained own fixture not healthy');await new Promise(resolve=>setTimeout(resolve,250));}
  const log=docker(['exec','-i',name,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'],sql);writeFileSync(`${output}/qualification.log`,log);
  receipt={status:'PASS',at:new Date().toISOString(),environment,retainedContainer:name,metadataSha256:createHash('sha256').update(bytes).digest('hex'),migrationSha256:original.migrationSha256,combinations:cases,operationsChecked:cases*4,conclusion:'Old current token RLS and new issuance/revocation allow AAL1 and AAL2 at both mfa_required=false and true; flag is not an enforced token-level AAL2 gate.',scope:'Synthetic AAL claims, captured RLS/token trigger/helper bodies and tenant policy shape on retained PG17.6 fixture; no hosted Auth/MFA/opaque-call proof, settings values not captured, no hosted mutations.'};
 }catch(error){receipt={status:'FAIL',environment,error:error.message};process.exitCode=1;}
 finally{if(started)docker(['stop',name]);}
 writeFileSync(`${output}/receipt.json`,JSON.stringify(receipt,null,2));results.push(receipt);console.log(JSON.stringify(receipt));
}
writeFileSync(`${packet}/token-assurance-summary.json`,JSON.stringify(results,null,2));
