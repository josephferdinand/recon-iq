import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const environment=process.argv[2],phase=process.argv[3],targets={PROD:'YOUR_PROJECT_REF',DEV:'YOUR_PROJECT_REF'};
if(!targets[environment]||!['dry-run','apply'].includes(phase)||process.env.FVI_ALLOW_HOME_REFERENCE_REPORTS_SQL!=='YES')throw Error('Explicit reviewed environment/phase required');
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',base=`${privateRoot}/FVI-HOME-REFERENCE-REPORTS-${environment}-20261004-v5`,proof=JSON.parse(await readFile(base+'-PREPARED.json','utf8'));
const sql=await readFile(base+(phase==='dry-run'?'-DRY-RUN.sql':'-APPLY.sql'),'utf8');const sha=x=>createHash('sha256').update(x).digest('hex');
if(proof.ref!==targets[environment]||sha(sql)!==(phase==='dry-run'?proof.dryRunSha256:proof.applySha256))throw Error('Prepared immutable packet drift');
if(phase==='apply'){
 const dry=JSON.parse(await readFile(base+'-DRY-RUN-RECEIPT.json','utf8'));if(!dry.rollbackVerified||dry.packetSha256!==proof.dryRunSha256)throw Error('Actual PG17 rollback validation absent');
 const build=await readFile('./LOCAL_USER/AppData/Local/Temp/fvi-codex-audit-20260930-4746723/home-reference-reports-protected-prod-build-20261004.log','utf8');if(!build.includes('"ok":true')||!build.includes('"runtime_dev_ref_files":0'))throw Error('Required protected production build absent');
 try{await readFile(base+'-APPLY-RECEIPT.json');throw Error('Committed receipt exists; readback only');}catch(e){if(e.code!=='ENOENT')throw e;}
}
const vault=await readFile('./.private/CREDENTIALS.md','utf8'),a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(a<0||b<=a)throw Error('Canonical credential markers absent');const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Management access unavailable');
async function query(text,readOnly){const r=await fetch(`https://api.supabase.com/v1/projects/${targets[environment]}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:readOnly,query:text}),signal:AbortSignal.timeout(200000)});if(!r.ok){const errorFile=base+'-'+phase+'-ERROR-'+Date.now()+'.txt';await writeFile(errorFile,await r.text());throw Error(`${environment} ${phase} HTTP${r.status}; protected diagnostic ${errorFile}; reconcile before retry`);}return r.json();}
const identity="SELECT current_setting('server_version_num')::int AS engine,(SELECT count(*) FROM supabase_migrations.schema_migrations)::int AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest";
const before=await query(identity,true);if(before.length!==1||before[0].engine<170000||before[0].ledger!==proof.initialLedger||before[0].latest!==proof.initialLatest)throw Error('Current actual PG17/ledger identity drift');
await query(sql,false);const after=await query(identity,true);
if(phase==='dry-run'&&JSON.stringify(before)!==JSON.stringify(after))throw Error('Rollback ledger identity changed');
if(phase==='apply'&&(after.length!==1||after[0].ledger!==proof.expectedLedger||after[0].latest!==proof.expectedLatest))throw Error('Committed ledger readback mismatch');
const receipt={at:new Date().toISOString(),environment,ref:targets[environment],phase,packetSha256:sha(sql),before,after,rollbackVerified:phase==='dry-run',hostedWorkflowAcceptance:false};await writeFile(base+(phase==='dry-run'?'-DRY-RUN-RECEIPT.json':'-APPLY-RECEIPT.json'),JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({environment,phase,verified:true,engine:after[0].engine,ledger:after[0].ledger,latest:after[0].latest,hostedWorkflowAcceptance:false}));





