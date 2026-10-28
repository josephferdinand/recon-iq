import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const environment=process.argv[2]??'PROD';
const targets={PROD:{ref:'YOUR_PROJECT_REF',envelope:'73098cf86a3977ea4440fe8018a2cc6ac179f8be289d2421d03b2debc4c329b7',catalog:'2c936fd96ba4b0f76616950836dfbf6b837369f6403066e9a6d5c657d9aafe21'},DEV:{ref:'YOUR_PROJECT_REF',envelope:'6da6de770095888a50403cd380f2f023a5dc6db1d7aa13ecf83dba496dacd87d',catalog:'714a80be37c261c6db7664ad586ffbee3684754f21da4e7326b1738d3580c3a2'}};
if(!targets[environment])throw Error('Explicit FVI environment required');
const raw=await readFile('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/output/hilbert-report-current-qualified-20261003-v2/'+environment.toLowerCase()+'-reports-010000-apply.sql','utf8');
const start=raw.indexOf('CREATE TEMP VIEW _hilbert_report_current_capture AS'),finish=raw.indexOf(') AS private_report_catalog;',start);
if(start<0||finish<start)throw Error('Exact captured query absent');
const query=raw.slice(start+'CREATE TEMP VIEW _hilbert_report_current_capture AS'.length,finish+') AS private_report_catalog;'.length);
const expectedEnvelope=await readFile(root+'/FVI-REPORTS-FULL-'+environment+'-CATALOG-20261003.json','utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');if(sha(expectedEnvelope)!==targets[environment].envelope)throw Error('Frozen expected capture drift');
const expected=JSON.parse(expectedEnvelope).results[0].rows[0].private_report_catalog.catalog;
const vault=await readFile('./.private/CREDENTIALS.md','utf8');const a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(a<0||b<=a)throw Error('Canonical vault section absent');const token=vault.slice(a,b).split(/\r?\n/).find(s=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(s))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw Error('Canonical access absent');
if(process.argv[3]==='wrapper'){
 let diagnostic=await readFile(root+'/FVI-HOME-REFERENCE-REPORTS-'+environment+'-20261004-v4-DRY-RUN.sql','utf8');
 const old=`RAISE EXCEPTION 'Captured ${environment} application catalog preimage changed' USING ERRCODE='40001';`;
 if(diagnostic.split(old).length!==3||!diagnostic.trim().endsWith('ROLLBACK;'))throw Error('Exact two rollback diagnostic sites required');
 diagnostic=diagnostic.replace(old,`RAISE EXCEPTION 'Report pre catalog mismatch observed %', (SELECT encode(sha256(convert_to((private_report_catalog->'catalog')::text,'UTF8')),'hex') FROM _hilbert_report_current_capture) USING ERRCODE='40001';`);
 diagnostic=diagnostic.replace(old,`RAISE EXCEPTION 'Report post catalog mismatch JSON %', (SELECT (private_report_catalog->'catalog')::text FROM _hilbert_report_current_capture) USING ERRCODE='40001';`);
 const r=await fetch('https://api.supabase.com/v1/projects/'+targets[environment].ref+'/database/query',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:diagnostic,read_only:false}),signal:AbortSignal.timeout(30000)});
 const body=await r.text();const message=JSON.parse(body)?.message??'';const marker='Report post catalog mismatch JSON ';const start=message.indexOf(marker),end=message.lastIndexOf('\nCONTEXT:');const postCatalogText=start>=0&&end>start?message.slice(start+marker.length,end).trim():null;
 const path=root+'/FVI-REPORT-WRAPPER-DIAGNOSTIC-'+Date.now()+'.json';await writeFile(path,JSON.stringify({at:new Date().toISOString(),environment,rollbackOnly:true,guardPredicatesAndExpectedDigestsUnchanged:true,onlyErrorLabelsChanged:true,querySha256:sha(diagnostic),http:r.status,response:body,postCatalogText},null,2),{flag:'wx'});console.log(JSON.stringify({path,http:r.status,postCatalogCaptured:postCatalogText!==null,postCatalogSHA256:postCatalogText?sha(postCatalogText):null,message:postCatalogText?'Catalog diagnostic retained privately':message.slice(0,400)}));
} else {
const sql="BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public,extensions; WITH observed AS ("+query.trim().replace(/;$/,'')+") SELECT private_report_catalog->'catalog' AS actual_catalog, (private_report_catalog->'catalog')::text AS actual_catalog_text, encode(sha256(convert_to((private_report_catalog->'catalog')::text,'UTF8')),'hex') AS actual_sha, encode(sha256(convert_to(("+"'"+JSON.stringify(expected).replaceAll("'","''")+"'::jsonb)::text,'UTF8')),'hex') AS expected_pg_sha FROM observed; ROLLBACK;";
const response=await fetch('https://api.supabase.com/v1/projects/'+targets[environment].ref+'/database/query',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Readonly profile diagnostic HTTP'+response.status);const result=await response.json();if(result.length!==1)throw Error('Diagnostic shape changed');
const observed=result[0];const changes=[];
function compare(x,y,path){if(x===y)return;if(typeof x!==typeof y||x===null||y===null||typeof x!=='object'){changes.push({path,expectedSha256:sha(JSON.stringify(x)??'undefined'),actualSha256:sha(JSON.stringify(y)??'undefined')});return;}for(const key of new Set([...Object.keys(x),...Object.keys(y)]))compare(x[key],y[key],path+'/'+key);}
compare(expected,observed.actual_catalog,'catalog');
const receipt={at:new Date().toISOString(),read_only:true,environment,querySha256:sha(sql),frozenExpectedSha256:sha(expectedEnvelope),actualSha256:observed.actual_sha,expectedPgSha256:observed.expected_pg_sha,configuredSha256:targets[environment].catalog,changes,actualCatalog:observed.actual_catalog,actualCatalogText:observed.actual_catalog_text};
const path=root+'/FVI-REPORT-PROFILE-DIAGNOSTIC-'+Date.now()+'.json';await writeFile(path,JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({path,actualSha256:receipt.actualSha256,expectedPgSha256:receipt.expectedPgSha256,configuredSha256:receipt.configuredSha256,changedFields:changes.length,changes:changes.slice(0,20)}));
}
