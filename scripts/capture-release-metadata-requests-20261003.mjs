import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const canonical='./LOCAL_USER/OneDrive - 8gsp1y/Documents/ChatGPT/ReconIQ';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw Error('Canonical credential section unavailable');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Management access unavailable');
const sha=x=>createHash('sha256').update(x).digest('hex');
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const requestGroups={
 core:[
  {label:'AI-SUPPLEMENT',path:'docs/handover/returns/2026-10-03-heisenberg-ai-catalog-request.sql',single:true},
  {label:'HOME-TEAM-P1',path:'scripts/qa/output/carson-home-team-p1-fix-20261003/catalog-request.sql',single:false},
 ],
 reports:[
  {label:'REPORTS-GUARD',base:candidate,path:'output/hilbert-report-forward-rebase-20261003-v1/current-report-ledger-helper-guard.sql',single:true,transaction:true},
  {label:'REPORTS-FULL',base:candidate,path:'output/hilbert-regulatory-atomic-increment-20261003-v1/regulatory-current-catalog-additional-preflight.sql',single:true,transaction:true},
 ],
 budget:[
  {label:'AI-RESERVATION',path:'docs/handover/returns/2026-10-03-heisenberg-ai-reservation-catalog-request.sql',single:true},
 ],
 benchmark:[
  {label:'BENCHMARK-RPC',base:candidate,path:'scripts/qa/benchmark-remaining-rpc-catalog-readonly-20261003.sql',single:true,environment:'PROD'},
 ],
 activity:[
  {label:'RELEASE-ACTIVITY',path:'scripts/qa/report-release-activity-readonly-20261004.sql',single:true,environment:'PROD'},
 ],
 reconGovernance:[
  {label:'RECON-PROMOTION',path:'scripts/qa/recon-promotion-current-metadata-20261004.sql',single:true,environment:'PROD'},
 ],
 ownedReconEligibility:[
  {label:'OWNED-RECON-ELIGIBILITY',path:'scripts/qa/recon-owned-promotion-eligibility-readonly-20261004.sql',single:true,environment:'PROD'},
 ],
 coreNextOpaque:[
  {label:'CORE-NEXT-OPAQUE',path:'docs/handover/returns/2026-10-04-heisenberg-next-integration-catalog-request.sql',single:true},
 ],
};
const requests=requestGroups[process.argv[2]??'core'];if(!requests)throw Error('Reviewed metadata group required');
for(const request of requests){
 const raw=await readFile(`${request.base??canonical}/${request.path}`,'utf8');
 let queries;
 if(request.single){
  let query=raw.replace("'name',a.attname,'type'","'attnum',a.attnum,'generated',a.attgenerated,'identity',a.attidentity,'name',a.attname,'type'");
  if(request.transaction){query=query.replace(/^\s*BEGIN[^;]*;\s*$/gm,'').replace(/^\s*ROLLBACK;\s*$/gm,'');}
  queries=[query];
 }else{
  // This reviewed metadata request contains no function bodies or quoted semicolons.
  // Strip comments and execute only its SELECTs; transaction/control/EXPLAIN comments
  // are not executed or relabelled as ordinary caller evidence.
  queries=raw.replace(/^\s*--.*$/gm,'').split(';').map(x=>x.trim()).filter(x=>/^SELECT\b/i.test(x));
  if(queries.length!==5)throw Error('Reviewed metadata statement count changed');
 }
 for(const [environment,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
  if(request.environment && request.environment!==environment)continue;
  const results=[];
  for(const query of queries){
   const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:true,query}),signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw Error(`${request.label} ${environment} readonly HTTP${r.status}; body withheld`);
   // Preserve the wire representation: JSON.parse rounds int8 metadata beyond
   // Number.MAX_SAFE_INTEGER. Parsed rows are convenient; rawResponseText is
   // authoritative for lossless integer and canonical jsonb qualification.
   const rawResponseText=await r.text();
   results.push({querySha256:sha(query),rows:JSON.parse(rawResponseText),rawResponseText,parsedRowsMayRoundUnsafeIntegers:true});
  }
  const result={at:new Date().toISOString(),environment,ref,label:request.label,read_only:true,noBusinessRowsCaptured:true,ordinaryCallerExplainRun:false,requestFile:request.path,requestSha256:sha(raw),results};
  const bytes=JSON.stringify(result,null,2),tag=result.at.replaceAll(/[:.]/g,'-'),file=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-${request.label}-${environment}-CATALOG-${tag}.json`;
  await writeFile(file,bytes,{flag:'wx'});console.log(JSON.stringify({environment,label:request.label,file,sha256:sha(bytes),statements:results.length,rowCounts:results.map(x=>x.rows.length),ordinaryCallerExplainRun:false}));
 }
}
