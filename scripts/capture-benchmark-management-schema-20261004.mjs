import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',ref='YOUR_PROJECT_REF';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(a<0||b<=a)throw Error('Canonical operational section absent');
const token=vault.slice(a,b).split(/\r?\n/).find(s=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(s))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw Error('FVI metadata access unavailable');
const sha=s=>createHash('sha256').update(s).digest('hex');
async function query(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Current readonly identity HTTP'+r.status);return r.json();}
const identitySql="SELECT current_setting('server_version_num')::int AS engine,(SELECT count(*) FROM supabase_migrations.schema_migrations)::int AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest";
const before=await query(identitySql);if(before[0]?.engine!==170006||before[0]?.ledger!==451||before[0]?.latest!=='20261003180000')throw Error('Current PROD identity drift');
const endpoint=`https://api.supabase.com/v1/projects/${ref}/database/openapi?schema=public`;
const r=await fetch(endpoint,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Official readonly Management OpenAPI HTTP'+r.status);
const raw=await r.text(),document=JSON.parse(raw);if(!document.paths||(!document.definitions&&!document.components?.schemas))throw Error('Actual schema document missing');
const after=await query(identitySql);if(JSON.stringify(after)!==JSON.stringify(before))throw Error('Schema capture identity changed');
const names=['get_typed_data_resource_editor','register_typed_data_resource','set_typed_data_resource_owners','approve_data_prep_pipeline','submit_recon_definition_promotion','decide_recon_definition_promotion','request_recon_definition_edit','decide_recon_definition_edit','get_recon_run_result_page','get_recon_run_result_status_counts'];
const missing=names.filter(n=>!document.paths['/rpc/'+n]?.post);if(missing.length)throw Error('Current OpenAPI required RPCs absent: '+missing.join(','));
const at=new Date().toISOString(),tag=at.replaceAll(/[:.]/g,'-'),file=root+'/FVI-BENCHMARK-CURRENT-MANAGEMENT-OPENAPI-'+tag+'.json';
const envelope={at,environment:'PROD',ref,schema:'public',deployment_id:'7180321a-e9c5-4014-bd9b-a3f1c52e392b',ledger:451,latest:'20261003180000',source:'official read-only Management API OpenAPI; not ordinary-caller permission proof',endpoint,readOnly:true,documentSha256:sha(raw),documentRawText:raw,document,identityBefore:before,identityAfter:after,requiredRpcNames:names,businessReadsOrWrites:0,privilegedCredentialsIncluded:false};
const bytes=JSON.stringify(envelope,null,2);await writeFile(file,bytes,{flag:'wx'});console.log(JSON.stringify({file,sha256:sha(bytes),documentSha256:sha(raw),ledger:451,latest:after[0].latest,rpcCount:10,source:envelope.source,credentialsInArtifact:false}));
