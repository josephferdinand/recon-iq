import {readFile,writeFile} from 'node:fs/promises';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const begin=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(begin<0||end<=begin)throw new Error('FVI credential boundary missing');
const token=vault.slice(begin,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw new Error('FVI management authority missing');
const sql=`SELECT clock_timestamp() AS captured_at, current_setting('server_version_num') AS engine,
 (SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,
 (SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,
 (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (
  SELECT indexrelid::regclass::text AS name, indisunique, indisvalid, indimmediate,
    indpred IS NULL AS unrestricted, indexprs IS NULL AS plain_columns,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,position)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      WHERE k.position<=i.indnkeyatts ORDER BY k.position) AS key_columns
  FROM pg_index i WHERE i.indrelid='public.aidp_pages'::regclass ORDER BY indexrelid) x) AS indexes,
 (SELECT count(*)::int FROM (SELECT 1 FROM public.aidp_pages GROUP BY document_id,page_index,purpose HAVING count(*)>1) d) AS duplicate_key_groups,
 (SELECT jsonb_agg(x) FROM (SELECT attname,attnotnull FROM pg_attribute
   WHERE attrelid='public.aidp_pages'::regclass AND attname IN ('document_id','page_index','purpose') ORDER BY attname) x) AS key_fields`;
const refs=[['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']];const receipts=[];
for(const [environment,ref]of refs){const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(25000)});const raw=await response.text();const file='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-PDF-PAGE-ARBITER-'+environment+'-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),environment,ref,http:response.status,readOnly:true,result:JSON.parse(raw)},null,2),{flag:'wx'});if(!response.ok){receipts.push({environment,http:response.status,success:false,receipt:file});continue;}const row=JSON.parse(raw)[0];const target=['document_id','page_index','purpose'];const matches=(row.indexes??[]).filter(x=>x.indisunique&&x.indisvalid&&x.indimmediate&&x.unrestricted&&x.plain_columns&&x.key_columns.length===3&&target.every(k=>x.key_columns.includes(k)));receipts.push({environment,ref,capturedAt:row.captured_at,engine:row.engine,ledger:row.ledger,latest:row.latest,validExactArbiterCount:matches.length,duplicateKeyGroups:row.duplicate_key_groups,receipt:file});}
const receipt={at:new Date().toISOString(),results:receipts,noWrites:true,noBusinessRowsCopied:true};await writeFile('docs/evidence/FVI_PDF_PAGE_ARBITER_READBACK_2026-10-05-'+Date.now()+'.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
