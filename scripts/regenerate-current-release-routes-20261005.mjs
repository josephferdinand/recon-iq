import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {Generator,getConfig} from '@tanstack/router-generator';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const out=path.resolve('output/parent-integrated-next-20261005/home-reports/generated-routes');
const mirror=path.join(out,'mirror');
const hash=x=>createHash('sha256').update(x).digest('hex');
await mkdir(out,{recursive:true});
const file=path.join(candidate,'src/routeTree.gen.ts');
const old=await readFile(file),text=old.toString('utf8');
const marker="import type { getRouter } from './router.tsx'",at=text.indexOf(marker);
if(at<0)throw Error('Required existing Start registration footer absent');
let count=0;
async function copy(relative=''){
 for(const entry of await readdir(path.join(candidate,'src/routes',relative),{withFileTypes:true})){
  const next=path.join(relative,entry.name);
  if(entry.isDirectory())await copy(next);
  else {const target=path.join(mirror,'src/routes',next);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readFile(path.join(candidate,'src/routes',next)),{flag:'wx'});count++;}
 }
}
if(process.argv[2]==='resume'){
 if(hash(await readFile(path.join(out,'routeTree.before.ts')))!==hash(old))throw Error('Candidate changed after frozen route preparation');
}else{
 await copy();
 await writeFile(path.join(out,'routeTree.before.ts'),old,{flag:'wx'});
}
const config=getConfig({routesDirectory:'./src/routes',generatedRouteTree:'./src/routeTree.gen.ts',quoteStyle:'double',semicolons:true,disableLogging:true,routeTreeFileFooter:text.slice(at).split(/\r?\n/)},mirror);
await new Generator({config,root:mirror}).run();
const next=await readFile(path.join(mirror,'src/routeTree.gen.ts'));
for(const expected of ['/request-invite','report-scheduler','router: Awaited<ReturnType<typeof getRouter>>','config: Awaited<ReturnType<typeof startInstance.getOptions>>']){if(!next.toString('utf8').includes(expected))throw Error('Required current route/footer missing: '+expected);}
if(next.toString('utf8').includes(mirror))throw Error('Mirror path escaped into runtime');
await writeFile(file,next);
const receipt={at:new Date().toISOString(),routeFiles:count,pre:hash(old),post:hash(next),footerPreserved:true,runtimeRoutesUnmodified:true,compilerPassed:false};
await writeFile(path.join(out,'RECEIPT.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify(receipt));
