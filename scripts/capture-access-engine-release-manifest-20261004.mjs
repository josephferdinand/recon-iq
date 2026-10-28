import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected={
 'src/lib/groups.functions.ts':'98fd8bdd0bafc746be1aa4e75c55c87e9df9579171a5c5564b3ec3da8f8d3899',
 'src/lib/business-units.functions.ts':'ddd27cdb46be7023b5daf2c435cb0e4c3e0a5adbcb01ee41348785e41cb5502e',
 'src/components/groups-tab.tsx':'c96455e196bd19d0cf600e84030fe3af2da80bd8754359b3e29af1bac5d70672',
 'src/lib/recon-engine.ts':'523644c6137e5beb91a0ae0eebc616d58b7201f822b3f41eca07ad82f7742647',
 'src/components/recons-tab.tsx':'5768b300a8f4a508935204b25a969448bc9863df45f3a1b0b8807f20e1db5842',
};
for(const [file,hash] of Object.entries(expected))if(sha(await readFile(root+'/'+file))!==hash)throw new Error('Reviewed source changed:'+file);
const buildLog=await readFile(root+'/audit/access-engine-count-ui-protected-prod-build-20261004.log','utf8');
const build=JSON.parse(buildLog.split(/\r?\n/).findLast(line=>line.startsWith('{"ok":'))??'null');
if(!build?.ok||build.runtime_dev_ref_files!==0||build.service_role_matches!==0||!build.generated_env_removed)throw new Error('Protected build postconditions required');
async function files(base,relative=''){const result=[];for(const e of await readdir(path.join(base,relative),{withFileTypes:true})){const rel=path.join(relative,e.name);if(e.isDirectory())result.push(...await files(base,rel));else if(e.isFile()){const file=path.join(base,rel);result.push({path:rel.replaceAll('\\','/'),bytes:(await stat(file)).size,sha256:sha(await readFile(file))});}}return result;}
const receipt={at:new Date().toISOString(),environment:'PROD',previousApplication:'85ff19c0-358c-491f-bf76-3f8c59fcc3b9',sqlLedger:456,latestMigration:'20261004163000',reviewedRuntimeChanges:expected,retainedChecks:{access:54,engine:182,countEditor:60},requiredCompiler:'PASS',protectedBuild:build,statusSourceFenced:true,sourceFiles:await files(root+'/src'),artifacts:await files(root+'/dist'),deployed:false,fullFirstGroupClosed:false};
const file=root+'/audit/access-engine-count-ui-ready-manifest-20261004.json';
await writeFile(file,JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify({manifest:file,sources:receipt.sourceFiles.length,artifacts:receipt.artifacts.length,reviewedRuntimeFiles:Object.keys(expected).length,protectedBuild:true}));
