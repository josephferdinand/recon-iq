import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('./output/',import.meta.url));
await mkdir(out,{recursive:true});
const privateBase='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-OPAQUE-AI-DEV-RELEASE-20261004-v1';
const prepared=JSON.parse(await readFile(privateBase+'-PREPARED.json','utf8'));
const packet=await readFile(privateBase+'-DRY-RUN.sql','utf8');
const hash=x=>createHash('sha256').update(x).digest('hex');
if(hash(packet)!==prepared.dryRunSha256||prepared.environment!=='DEV'||prepared.initialLedger!==431)throw Error('Frozen DEV packet drift');
const source=[];
for(const [path,expected] of prepared.sourceFiles){const s=await readFile(path,'utf8');if(hash(s)!==expected)throw Error('Frozen source drift');source.push(s);}
if(hash(source.join('\n'))!==prepared.sourceSha256)throw Error('Source digest drift');
const names=[...new Set(source.flatMap(s=>[...s.matchAll(/public\.([a-z_][a-z0-9_]*)/g)].map(x=>x[1])))];
const q=s=>"'"+s.replaceAll("'","''")+"'";
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(a<0||b<=a)throw Error('Credential boundary absent');
const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_/.test(token??''))throw Error('Management credential absent');
async function request(label,sql,timeoutMs,readOnly){
 const start=performance.now();
 const r=await fetch('https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/database/query',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:readOnly}),signal:AbortSignal.timeout(timeoutMs)});
 const raw=await r.text();if(!r.ok){await writeFile(out+label+'-error.json',JSON.stringify({at:new Date().toISOString(),status:r.status,raw},null,2));throw Error('DEV metadata HTTP '+r.status);}
 const result={at:new Date().toISOString(),project:'YOUR_PROJECT_REF',readOnly,temporaryOnly:!readOnly,elapsedMs:Math.round(performance.now()-start),rows:JSON.parse(raw)};
 await writeFile(out+label+'.json',JSON.stringify(result,null,2));return result;
}
export const query=(label,sql,timeoutMs=35000)=>request(label,sql,timeoutMs,true);
export function temporaryProbe(label,sql,timeoutMs=35000){
 if(!sql.startsWith('BEGIN')||!sql.endsWith('ROLLBACK;')||/\bCOMMIT\b|\bGRANT\b|\bREVOKE\b|CREATE\s+(?!TEMP\s+TABLE\b)|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE|TRUNCATE)\s+(?!_oa_)[a-z_]/i.test(sql))throw Error('Temporary-only probe boundary failed');
 return request(label,sql,timeoutMs,false);
}
export const identity=`SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,to_regprocedure('public.reserve_copilot_dispatch(uuid,uuid,text,text,integer,jsonb)')::text AS reservation_port`;
const metadata=`SELECT c.oid::text,n.nspname,c.relname,c.relkind,c.reltuples::bigint AS estimated_rows,pg_total_relation_size(c.oid)::text AS total_bytes,pg_relation_size(c.oid)::text AS heap_bytes,coalesce(s.n_live_tup,0)::text AS stats_live_rows,coalesce(s.n_dead_tup,0)::text AS stats_dead_rows,string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) AS projection FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid WHERE (n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY(ARRAY[${names.map(q).join(',')}])) OR (n.nspname='supabase_migrations' AND c.relname='schema_migrations') GROUP BY c.oid,n.nspname,c.relname,s.n_live_tup,s.n_dead_tup ORDER BY pg_total_relation_size(c.oid) DESC`;
const activity=`SELECT pid,backend_type,state,wait_event_type,wait_event,round(extract(epoch FROM (clock_timestamp()-query_start))::numeric,2)::text AS query_age_seconds,position('_oa_oldrows' in query)>0 AS old_verifier,position('_oa_probe' in query)>0 AS new_probe FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND (state='active' OR (position('_oa_oldrows' in query)>0 AND state LIKE 'idle in transaction%')) ORDER BY pid`;
if(process.argv[1]===fileURLToPath(import.meta.url)){
const mode=process.argv[2]??'metadata';
if(mode==='metadata'){
 const evidence={sourceSha256:prepared.sourceSha256,packetSha256:hash(packet),statements:packet.split(/\r?\n/).map((line,i)=>({line:i+1,text:line})).filter(x=>/^(BEGIN|COMMIT|ROLLBACK);/.test(x.text)).map(x=>({line:x.line,text:x.text.slice(0,100)}))};
 await writeFile(out+'frozen-inputs.json',JSON.stringify(evidence,null,2));
 for(const [label,sql] of [['identity-before',identity],['activity',activity],['tables',metadata]]){const r=await query(label,sql);console.log(JSON.stringify({label,elapsedMs:r.elapsedMs,rows:label==='tables'?r.rows.map(x=>({table:x.relname,estimatedRows:x.estimated_rows,bytes:x.total_bytes})):r.rows}));}
}else if(mode==='cost'){
 const tables=JSON.parse(await readFile(out+'tables.json','utf8')).rows;
 for(const t of tables){
  const sql=`BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; SET LOCAL work_mem='4MB'; SELECT '${t.relname}' AS table_name,count(*)::text AS rows,coalesce(sum(octet_length(to_jsonb(x)::text)),0)::text AS projection_bytes FROM (SELECT ${t.projection} FROM "${t.nspname}"."${t.relname}") x; ROLLBACK;`;
  try{const r=await query('cost-'+t.relname,sql);console.log(JSON.stringify({table:t.relname,elapsedMs:r.elapsedMs,rows:r.rows}));}catch(e){console.log(JSON.stringify({table:t.relname,error:e.message}));break;}
 }
 await query('identity-after-cost',identity);
}else throw Error('Explicit supported diagnostic mode required');
}
