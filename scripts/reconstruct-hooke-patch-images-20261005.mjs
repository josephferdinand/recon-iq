import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='output/recon-retained-source-recovery-20261005';
const sha=value=>createHash('sha256').update(value).digest('hex');
const plans=[
 {name:'engine',file:'src/lib/recon-engine.ts',patches:[1,2,3],expected:'523644c6137e5beb91a0ae0eebc616d58b7201f822b3f41eca07ad82f7742647'},
 {name:'count-ui',file:'src/components/recons-tab.tsx',patches:[6,7,8],expected:'5768b300a8f4a508935204b25a969448bc9863df45f3a1b0b8807f20e1db5842'},
];
function section(patch,file){
 const lines=patch.replaceAll('\r\n','\n').split('\n');let active=false;const result=[];
 for(const line of lines){if(line.startsWith('*** Update File: ')){active=line.replaceAll('\\','/').endsWith('/'+file);continue;}if(line.startsWith('*** ')){active=false;continue;}if(active)result.push(line);}
 return result;
}
function apply(source,lines){
 const chunks=[];let current=[];
 for(const line of lines){if(line.startsWith('@@')){if(current.length)chunks.push(current);current=[];}else if(/^[ +\-]/.test(line))current.push(line);}
 if(current.length)chunks.push(current);
 let text=source.replaceAll('\r\n','\n');
 for(const chunk of chunks){
  const before=chunk.filter(line=>line[0]!=='+').map(line=>line.slice(1)).join('\n');
  const after=chunk.filter(line=>line[0]!=='-').map(line=>line.slice(1)).join('\n');
  if(!before)throw new Error('Unanchored patch refused');
  const first=text.indexOf(before),second=first<0?-1:text.indexOf(before,first+1);
  if(first<0||second>=0)throw new Error(first<0?'Captured patch preimage absent':'Captured patch context ambiguous');
  text=text.slice(0,first)+after+text.slice(first+before.length);
 }
 return text;
}
await mkdir(root+'/reconstructed',{recursive:true});const results=[];
for(const plan of plans){
 const archived=spawnSync('git',['show','989fda7:'+plan.file],{maxBuffer:2000000});
 if(archived.status!==0)throw new Error('Retained approved baseline absent');
 const variants=[['approved989',archived.stdout.toString()],['canonical',await readFile(plan.file,'utf8')]];
 for(const [basis,source]of variants){
  try{
   let text=source;
   for(const number of plan.patches){const patch=await readFile(root+'/patches/patch-'+String(number).padStart(3,'0')+'.txt','utf8');const edits=section(patch,plan.file);if(!edits.length)throw new Error('Known source patch section missing');text=apply(text,edits);}
   const candidates=[text,text.replace(/\r?\n/g,'\r\n')];
   const exact=candidates.find(value=>sha(value)===plan.expected);
   const filename=plan.name+'-'+basis+(exact?'-EXACT':'-UNQUALIFIED')+'.txt';
   await writeFile(root+'/reconstructed/'+filename,exact??text,{flag:'wx'});
   results.push({name:plan.name,basis,exact:!!exact,sha256:sha(exact??text),expected:plan.expected,file:filename});
  }catch(error){results.push({name:plan.name,basis,exact:false,reason:error.message});}
 }
}
await writeFile(root+'/RECONSTRUCTION.json',JSON.stringify({at:new Date().toISOString(),results,oldCommandsExecuted:false,originalFilesChanged:false},null,2),{flag:'wx'});
console.log(JSON.stringify({results,receipt:root+'/RECONSTRUCTION.json'}));
