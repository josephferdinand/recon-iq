import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root=process.cwd(), candidate='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const out=path.join(root,'scripts/qa/output/resource-mapping-display-20261004');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=[];
let previous;try{previous=JSON.parse(await fs.readFile(path.join(out,'SOURCE_MANIFEST.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const [page,type,ids] of [['data-sources-tab','data_source','rows.map((row) => row.id)'],['data-prep-tab','data_prep_pipeline','pipelineRows.map((row: any) => row.id)']]){
  const file='src/components/'+page+'.tsx', bytes=await fs.readFile(path.join(candidate,file)), source=bytes.toString('utf8');
  const prior=previous?.files.find(x=>x.file===file);if(prior&&prior.candidatePreimageSHA256!==sha(bytes))throw Error('Shared page drift; explicit rebase required: '+file);
  let post=source; const replace=(old,value)=>{if(post.split(old).length!==2)throw Error('Exact companion preimage changed: '+file);post=post.replace(old,value);};
  replace('import { getResourceAccessSummaries } from "@/lib/resource-access-summaries.functions";', 'import { useResourceMappingDisplay } from "@/hooks/use-resource-mapping-display";');
  replace('  const getAccessSummaries = useServerFn(getResourceAccessSummaries);\r\n','');
  const start=post.indexOf('  const accessQ = useQuery({'),end=post.indexOf('  const accessById =',start);
  if(start<0||end<0||!post.slice(start,end).includes('resource_type: "'+type+'"'))throw Error('Summary query not exact: '+file);
  post=post.slice(0,start)+'  const accessQ = useResourceMappingDisplay({ tenantId, resourceType: "'+type+'", resourceIds: '+ids+' });\r\n'+post.slice(end);
  for(const [dir,data] of [['preimages',bytes],['postimages',Buffer.from(post)]]){const target=path.join(out,dir,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);}
  manifest.push({file,candidatePreimageSHA256:sha(bytes),postimageSHA256:sha(Buffer.from(post)),appliedToSharedPage:false,lease:'PARENT_OWNERSHIP_ACK_REQUIRED',purpose:'access-summary import/query only; all view/write/editor/style sections byte-preserved'});
}
const own=['src/lib/resource-mapping-display.ts','src/hooks/use-resource-mapping-display.ts','tests/resource-mapping-display.spec.ts','tests/resource-mapping-display-integration.spec.tsx'];
for(const file of own){const data=await fs.readFile(path.join(root,file));const target=path.join(candidate,file);await fs.mkdir(path.dirname(target),{recursive:true});try{const old=await fs.readFile(target);if(sha(old)!==sha(data)){const prior=previous?.files.find(x=>x.file===file&&x.lease==='VOLTA_NEW_DISJOINT_FILE');if(!prior||prior.sha256!==sha(old))throw Error('Disjoint candidate file already occupied: '+file);await fs.writeFile(target,data);}}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(target,data,{flag:'wx'});}manifest.push({file,sha256:sha(data),bytes:data.length,lease:'VOLTA_NEW_DISJOINT_FILE'});}
// Mirror only the QA fixture/postimage files required by the focused candidate tests.
for(const page of ['data-sources-tab','data-prep-tab']){const file='src/components/'+page+'.tsx',target=path.join(candidate,'scripts/qa/output/resource-mapping-display-20261004/postimages',file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(out,'postimages',file),target);}
await fs.writeFile(path.join(out,'SOURCE_MANIFEST.json'),JSON.stringify({at:new Date().toISOString(),candidate,files:manifest,appPageEdits:0},null,2)+'\n');
console.log(JSON.stringify({status:'DISJOINT_SOURCE_AND_EXACT_PAGE_COMPANIONS_READY',sharedPageEdits:0,files:manifest.length}));
