import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const sha=x=>createHash('sha256').update(x).digest('hex');
const base='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-OPAQUE-AI-DEV-RELEASE-20261004-v1';
const out=fileURLToPath(new URL('./output/',import.meta.url));
const originalAggregate="EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') FROM (SELECT %s FROM %I.%I)x',";
export function fingerprint(args){return `n:=0;h:=sha256(convert_to('FVI-OA-ROWSET-V2','UTF8'));FOR item IN EXECUTE format('SELECT sha256(convert_to(to_jsonb(x)::text,''UTF8'')) AS digest FROM (SELECT %s FROM %I.%I)x ORDER BY 1',${args}) LOOP h:=sha256(h||item.digest);n:=n+1;END LOOP;v:=encode(h,'hex');`;}
export function rewritePacket(packet){
 const lines=packet.split('\n');const oldSnapshot=lines.find(x=>x.startsWith('DO $snapshot$ ')),oldPreserve=lines.find(x=>x.startsWith('DO $preserve$ '));
 if(!oldSnapshot||!oldPreserve||lines.filter(x=>x.startsWith('DO $snapshot$ ')).length!==1||lines.filter(x=>x.startsWith('DO $preserve$ ')).length!==1)throw Error('Exact verification blocks absent');
 function change(old,args){
  const aggregate=originalAggregate+args+') INTO n,v;';
  if(!old.includes(aggregate))throw Error('Exact aggregate preimage absent');
  let next=old.replace('n bigint;v text;BEGIN','n bigint;v text;h bytea;item record;wm text;started timestamptz;BEGIN wm:=current_setting(\'work_mem\');PERFORM set_config(\'work_mem\',\'4MB\',true);');
  if(next===old)throw Error('Exact declaration preimage absent');
  next=next.replace(aggregate,fingerprint(args));
  const end=next.startsWith('DO $snapshot$ ')?'END $snapshot$;':'END $preserve$;';
  if(!next.endsWith(end))throw Error('Block terminator drift');
  next=next.slice(0,-end.length).replace(/END;$/,'')+`PERFORM set_config('work_mem',wm,true);END ${end.slice(4)}`;
  // The replacement must stay inside the verification wrappers only.
  return next;
 }
 const newSnapshot=change(oldSnapshot,'cols,r.nspname,r.relname');
 const newPreserve=change(oldPreserve,'r.projection,r.schema_name,r.table_name');
 const candidate=packet.replace(oldSnapshot,newSnapshot).replace(oldPreserve,newPreserve);
 if(candidate.replace(newSnapshot,oldSnapshot).replace(newPreserve,oldPreserve)!==packet)throw Error('Non-verification bytes changed');
 return {candidate,oldSnapshot,oldPreserve,newSnapshot,newPreserve};
}
export async function loadFrozen(){
 const prepared=JSON.parse(await readFile(base+'-PREPARED.json','utf8'));
 const packet=await readFile(base+'-DRY-RUN.sql','utf8');
 if(prepared.environment!=='DEV'||prepared.initialLedger!==431||sha(packet)!==prepared.dryRunSha256)throw Error('DEV packet drift');
 const sources=[];for(const [path,h] of prepared.sourceFiles){const text=await readFile(path,'utf8');if(sha(text)!==h)throw Error('Source drift');sources.push(text);}
 if(sha(sources.join('\n'))!=='2c8fc13fe376bc48fdcf9084b21feaaec2b08fa8b9c62a5644c9f4430dd6f991'||prepared.sourceSha256!==sha(sources.join('\n')))throw Error('Coupled source digest drift');
 return {prepared,packet,sources};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 await mkdir(out,{recursive:true});const {prepared,packet}=await loadFrozen();const result=rewritePacket(packet);
 await writeFile(out+'DEV-REVIEW-ONLY-DRY-RUN.sql',result.candidate);
 await writeFile(out+'snapshot-replacement.sql',result.newSnapshot+'\n');
 await writeFile(out+'preserve-replacement.sql',result.newPreserve+'\n');
 const report={at:new Date().toISOString(),sourceSha256:prepared.sourceSha256,originalDryRunSha256:sha(packet),candidateDryRunSha256:sha(result.candidate),onlyChangedBlocks:['snapshot','preserve'],nonVerificationBytesUnchanged:true,existingSourceBodiesAndGuardsUnchanged:true,parentReleaseScriptEdited:false,sqlExecuted:false,applyPacketCreated:false,oldBlockHashes:{snapshot:sha(result.oldSnapshot),preserve:sha(result.oldPreserve)},newBlockHashes:{snapshot:sha(result.newSnapshot),preserve:sha(result.newPreserve)}};
 await writeFile(out+'rewrite-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
