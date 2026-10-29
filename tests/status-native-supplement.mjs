import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const dir='docs/evidence/status-lane-2026-10-03';
const saved=JSON.parse(fs.readFileSync(dir+'/native-qualification.json','utf8'));
if(!saved.container.startsWith('rq-status-native-20261004-')||saved.kind!=='isolated_synthetic_postgresql_fixture') throw new Error('Unexpected status fixture identity');
const call=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,windowsHide:true});
const sql=fs.readFileSync(dir+'/guarded-status-workflow-proposal.sql','utf8');
let functions='';
for(const name of ['status_validate_incident','status_incident_command']) {
  const start=sql.indexOf('CREATE FUNCTION public.'+name+'('); const end=sql.indexOf('END $$;',start);
  if(start<0||end<start) throw new Error('Changed function definition missing');
  functions+=sql.slice(start,end+7).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')+'\n';
}
try {
  if(call(['start',saved.container]).status!==0) throw new Error('Saved fixture did not resume');
  let ready=false;for(let i=0;i<40;i++){if(call(['exec',saved.container,'pg_isready','-U','postgres']).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));}if(!ready)throw new Error('Saved fixture not ready');
  const result=call(['exec','-i',saved.container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],functions+fs.readFileSync('tests/status-native-supplement.sql','utf8'));
  fs.writeFileSync(dir+'/native-supplement.log',result.stdout+'\n'+result.stderr);
  if(result.status!==0||!result.stdout.includes('STATUS_NATIVE_SUPPLEMENT_PASS'))throw new Error('Supplement failed; see native-supplement.log');
  const publicRead=call(['exec','-i',saved.container,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],"SET ROLE anon;SELECT jsonb_array_length(status_public_snapshot()->'incidents');");
  const privateRead=call(['exec','-i',saved.container,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],"SET ROLE anon;SELECT * FROM status_incident_versions;");
  const ordinaryRead=call(['exec','-i',saved.container,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],"SELECT set_config('fvi.actor','33333333-3333-4333-8333-333333333333',false);SET ROLE authenticated;SELECT count(*) FROM status_incident_workflows;");
  if(publicRead.status!==0||!publicRead.stdout.trim().endsWith('3')||privateRead.status===0||ordinaryRead.status!==0||!ordinaryRead.stdout.trim().endsWith('0'))throw new Error('Public/private role boundary checks failed');
  fs.writeFileSync(dir+'/native-supplement.json',JSON.stringify({at:new Date().toISOString(),container:saved.container,kind:saved.kind,hosted:false,real_mfa:false,result:'PASS',base_checks:34,supplement_checks:9,additional_acl_checks:3,accepted_checks_repeated:false,qualified_sql_sha256:createHash('sha256').update(sql).digest('hex')},null,2));
  console.log(JSON.stringify({result:'PASS',base:34,supplement:9,acl:3,container:saved.container}));
} finally {const result=call(['stop',saved.container]);console.log(JSON.stringify({container:saved.container,stopped:result.status===0,preserved:true}));}
