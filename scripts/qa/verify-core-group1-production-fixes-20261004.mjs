import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {manifestEntries} from 'file:///./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/scripts/qa/resolve-benchmark-bindings-5fbb-20261003.mjs';
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',packet='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const refresh=JSON.parse(await readFile(process.argv[2],'utf8'));
if(refresh.deployment_id!=='85ff19c0-358c-491f-bf76-3f8c59fcc3b9')throw new Error('Current release QA receipt required');
const actor=refresh.actors.find(a=>a.label==='platform-maker');
if(!actor?.provider_subject_verified||actor.aal!=='aal2'||!actor.current_active_tenant_admin||actor.expires_at<Date.now()/1000+300)throw new Error('Current actual MFA authority required');
const session=JSON.parse(await readFile(actor.session_file,'utf8')).session;
const transport=JSON.parse(await readFile(`${root}/FVI-QA-TRANSPORT-PROD-20261001.json`,'utf8'));
const headers={apikey:transport.anonKey,authorization:`Bearer ${session.access_token}`,'content-type':'application/json'};
const sha=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(await readFile(`${packet}/audit/core-group1-ready-artifact-manifest-20261004.json`,'utf8'));
const mfa=manifest.artifacts.filter(a=>a.path.includes('mfa-challenge')&&a.path.endsWith('.js'));
if(mfa.length!==1)throw new Error('One current MFA client module required');
const mfaPath='/'+mfa[0].path.replaceAll('\\','/');
const served=await fetch('https://app.reconiq.example'+mfaPath,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
if(!served.ok||sha(Buffer.from(await served.arrayBuffer()))!==mfa[0].sha256)throw new Error('Reviewed new MFA module not served');
let operation;
const ssr=`${packet}/dist/_worker.js/_ssr`;
for(const file of (await readdir(ssr)).filter(f=>/^server-[\w-]+\.mjs$/.test(f))){try{const entries=manifestEntries(await readFile(path.join(ssr,file),'utf8'),file);operation=entries.find(e=>e.operation==='upsertRecon');}catch(e){if(!e.message.startsWith('exact_manifest_export_required'))throw e;}}
if(!operation)throw new Error('Current actual reconciliation operation required');
const response=await fetch(transport.apiUrl+'/rest/v1/recon_definitions?select=id,name,description,recon_type,sides,governance_state&tenant_id=eq.aa5ed999-69eb-41a0-a9c6-fbb439efcffb&id=eq.deaaa689-0da4-464b-86f4-7787c4b27a7f&limit=2',{headers,redirect:'error',signal:AbortSignal.timeout(25000)});
const rows=await response.json();
if(!response.ok||!Array.isArray(rows)||rows.length!==1||rows[0].governance_state!=='approved_locked')throw new Error('Exact immutable owned existing name required');
const definition=rows[0];
const data={tenant_id:actor.tenant_id,name:definition.name,description:'Owned QA duplicate-name negative test; no new definition intended.',recon_type:definition.recon_type,sides:definition.sides,rules:[],owner_bu_ids:['55aada23-06cb-4e8b-92f4-9deb93f1731c']};
const require=createRequire('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/package.json');
const {toJSONAsync,fromCrossJSON}=require('seroval');
const {defaultSerovalPlugins}=require('@tanstack/router-core');
const savedResponseFile=process.argv[3];
let privateFile,raw,http,serialized;
if(savedResponseFile){
  if(path.dirname(path.resolve(savedResponseFile))!==path.resolve(root))throw new Error('Owned private response required');
  const saved=JSON.parse(await readFile(savedResponseFile,'utf8'));
  if(saved.state!=='response-observed'||saved.operation!==operation.function_id||saved.payloadSha256!==sha(JSON.stringify(data))||saved.expectedExistingId!==definition.id)throw new Error('Actual correlated response changed');
  privateFile=savedResponseFile;raw=saved.rawBody;http=saved.http;serialized=raw.includes('$TSR/Error');
}else{
  privateFile=`${root}/FVI-CORE-GROUP1-DUPLICATE-NAME-${Date.now()}.json`;
  await writeFile(privateFile,JSON.stringify({at:new Date().toISOString(),state:'intent',operation:operation.function_id,payloadSha256:sha(JSON.stringify(data)),expectedExistingId:definition.id}),{flag:'wx',mode:0o600});
  const attempt=await fetch('https://app.reconiq.example/_serverFn/'+operation.function_id,{method:'POST',headers:{...headers,Origin:'https://app.reconiq.example','x-tsr-serverFn':'true',Accept:'application/json'},body:JSON.stringify(await toJSONAsync({data})),redirect:'error',signal:AbortSignal.timeout(30000)});
  raw=await attempt.text();http=attempt.status;serialized=attempt.headers.get('x-tss-serialized')==='true';
}
let observed;
try{const parsed=JSON.parse(raw),decoded=serialized?fromCrossJSON(parsed,{plugins:defaultSerovalPlugins}):parsed;observed=decoded?.error?.message??decoded?.message??null;}catch(e){observed=e?.message??(typeof e==='string'?e:null);}
if(!savedResponseFile)await writeFile(privateFile,JSON.stringify({at:new Date().toISOString(),state:'response-observed',http,serialized,operation:operation.function_id,payloadSha256:sha(JSON.stringify(data)),rawBody:raw,observedMessage:observed,expectedExistingId:definition.id},null,2));
const expected='A reconciliation with this name already exists in this workspace. Choose a different name and save again.';
if(observed!==expected)throw new Error('Actual duplicate-name business guidance unconfirmed; private response retained');
const result={at:new Date().toISOString(),deployment:'85ff19c0-358c-491f-bf76-3f8c59fcc3b9',mfaModule:{path:mfaPath,sha256:mfa[0].sha256,hostedExact:true},duplicateName:{ordinaryRealMfaCaller:true,http,expectedGuidanceObserved:true,responseReceipt:privateFile,installedTanstackErrorPlugin:true,existingResponseReconciled:!!savedResponseFile,writeReplayed:false},fullRecoveryOrAccessClosure:false};
const file=`${packet}/audit/core-group1-hosted-fixes-20261004.json`;
await writeFile(file,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({hostedMfaModuleExact:true,hostedDuplicateGuidance:true,receipt:file}));
