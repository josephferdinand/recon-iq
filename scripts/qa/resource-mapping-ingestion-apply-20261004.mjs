// Parent-authorized source-list mapping lease only. No runtime/DB/app deployment actions.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const root=process.cwd(),candidate='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const oldStage=path.join(root,'scripts/qa/output/resource-mapping-display-20261004');
const stage=path.join(root,'scripts/qa/output/resource-mapping-ingestion-20261004');
const sha=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(stage,{recursive:true});
await fs.writeFile(path.join(stage,'PERFILE_LEASE.txt'),'Volta — resumed ingestion mapping display lease, 4 October 2026.\nCurrent user expressly resumed disjoint helper/sourceList mapping work. Candidate-only edits: src/components/data-sources-tab.tsx and src/components/aidp-tab.tsx access-summary imports/query blocks only. New test: tests/resource-mapping-ingestion.spec.tsx. DataPrep companion retained without application. No routes/actions/styles/server functions/roles/RLS/SQL/build/deploy/Docker/global-doc edits. No Reference repeats.\n');
const files=[];
// Prepare and guard every file before the first existing source-list edit.
const dataFile='src/components/data-sources-tab.tsx';
const dataBefore=await fs.readFile(path.join(candidate,dataFile)),dataAfter=await fs.readFile(path.join(oldStage,'postimages',dataFile));
if(sha(dataBefore)!=='aec17d375204e3b0e5aacd9b70956a18f542d139f0803111d4d452e6de806644')throw Error('Current DataSources preimage changed; no edit sent');
if(sha(dataAfter)!=='ec56fd6f78895521e08a05c885cb8e9a169b4e4b6021cda7384ee7c4312dc1f1')throw Error('Qualified DataSources postimage changed; no edit sent');
files.push({file:dataFile,before:dataBefore,after:dataAfter});
const aidpFile='src/components/aidp-tab.tsx',aidpBefore=await fs.readFile(path.join(candidate,aidpFile));
if(sha(aidpBefore)!=='036a20a9bc3c91fa1487565fc9970a3b425797364e376507d15727006da6f0c9')throw Error('Current AIDP preimage changed; no edit sent');
let aidp=aidpBefore.toString('utf8');const replace=(pre,post)=>{if(aidp.split(pre).length!==2)throw Error('AIDP exact summary preimage missing');aidp=aidp.replace(pre,post);};
replace('import { getResourceAccessSummaries } from "@/lib/resource-access-summaries.functions";','import { useResourceMappingDisplay } from "@/hooks/use-resource-mapping-display";');
replace('  const getAccessSummaries = useServerFn(getResourceAccessSummaries);\r\n','');
for(const [variable,type,list] of [['docAccessQ','aidp_document','documents'],['templateAccessQ','aidp_template','templates']]){
  const pre='  const '+variable+' = useQuery({\r\n    queryKey: ["resource-access-summary", tenantId, "'+type+'", '+list+'.map((row: any) => row.id)],\r\n    queryFn: () => getAccessSummaries({ data: { resource_type: "'+type+'", resource_ids: '+list+'.map((row: any) => row.id) } }),\r\n    enabled: '+list+'.length > 0,\r\n  });';
  replace(pre,'  const '+variable+' = useResourceMappingDisplay({ tenantId, resourceType: "'+type+'", resourceIds: '+list+'.map((row: any) => row.id) });');
}
files.push({file:aidpFile,before:aidpBefore,after:Buffer.from(aidp)});
// Existing helpers must exactly match the already-qualified saved source.
for(const file of ['src/lib/resource-mapping-display.ts','src/hooks/use-resource-mapping-display.ts']){
  const a=await fs.readFile(path.join(root,file)),b=await fs.readFile(path.join(candidate,file));if(sha(a)!==sha(b))throw Error('Saved helper drift; no source-list edit sent');
}
for(const item of files){for(const [dir,bytes] of [['preimages',item.before],['postimages',item.after]]){const p=path.join(stage,dir,item.file);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,bytes,{flag:'wx'});}}
// Recheck each current file immediately before its bounded write.
for(const item of files){const p=path.join(candidate,item.file);if(sha(await fs.readFile(p))!==sha(item.before))throw Error('Concurrent shared edit detected; do not overwrite '+item.file);await fs.writeFile(p,item.after);}
const test='tests/resource-mapping-ingestion.spec.tsx',testBytes=await fs.readFile(path.join(root,test));await fs.writeFile(path.join(candidate,test),testBytes,{flag:'wx'});
await fs.writeFile(path.join(stage,'SOURCE_MANIFEST.json'),JSON.stringify({at:new Date().toISOString(),candidate,scope:'INGESTION_SOURCE_LIST_MAPPING_ONLY',files:files.map(x=>({file:x.file,preimageSHA256:sha(x.before),postimageSHA256:sha(x.after),applied:true})),newTest:{file:test,sha256:sha(testBytes)},retainedProof:'../resource-mapping-display-20261004/READY_RESULT.json',businessWrites:0,compilerBuildDeploy:0},null,2)+'\n');
console.log(JSON.stringify({status:'TWO_GUARDED_INGESTION_SOURCE_LIST_PATCHES_APPLIED',candidate,files:files.map(x=>x.file),newTest:test,hostedMutationCount:0}));
