import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root='output/recon-retained-source-recovery-20261005';
const wanted=new Map([
 ['4e677bab86dc28c71d322d947b3abe1f42c0865ef618a5b3834c959b54eb4c02','engine-preimage.ts'],
 ['523644c6137e5beb91a0ae0eebc616d58b7201f822b3f41eca07ad82f7742647','engine-deployed.ts'],
 ['5169d6a0831fc72eab964cb1570baecfee0d4750111ceb93bee58c3606faa501','recons-preimage.tsx'],
 ['5768b300a8f4a508935204b25a969448bc9863df45f3a1b0b8807f20e1db5842','recons-deployed.tsx'],
]);
const records=await readFile(root+'/git-unreachable-metadata.txt','utf8');
const ids=[...records.matchAll(/unreachable blob ([a-f0-9]{40})/g)].map(m=>m[1]);
const sizes=spawnSync('git',['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{input:ids.join('\n')+'\n',encoding:'utf8',maxBuffer:4*1024*1024});
if(sizes.status!==0)throw new Error('Object metadata query failed');
const selected=sizes.stdout.trim().split('\n').map(x=>x.split(' ')).filter(x=>x[1]==='blob'&&Number(x[2])>=15000&&Number(x[2])<=130000);
await mkdir(root+'/unreachable-images',{recursive:true});
const matches=[];
for(const [id]of selected){
 const r=spawnSync('git',['cat-file','blob',id],{maxBuffer:150000});
 if(r.status!==0)continue;
 const raw=r.stdout;
 for(const [variant,buffer]of [['raw',raw],['lf',Buffer.from(raw.toString('utf8').replace(/\r\n/g,'\n'))],['crlf',Buffer.from(raw.toString('utf8').replace(/\r?\n/g,'\r\n'))]]){
  const hash=createHash('sha256').update(buffer).digest('hex');
  if(!wanted.has(hash))continue;
  const file=root+'/unreachable-images/'+wanted.get(hash);
  try{await writeFile(file,buffer,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(createHash('sha256').update(await readFile(file)).digest('hex')!==hash)throw new Error('Recovered image collision');}
  if(!matches.some(x=>x.sha256===hash))matches.push({sha256:hash,blob:id,variant,path:file});
 }
}
const receipt={at:new Date().toISOString(),blobCount:ids.length,sizeQualifiedCount:selected.length,matches,workingSourceModified:false,commandReplay:false};
await writeFile(root+'/UNREACHABLE-RECOVERY-'+Date.now()+'.json',JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify(receipt));
