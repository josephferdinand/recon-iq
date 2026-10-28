import {readFile,writeFile} from 'node:fs/promises';
const root='output/recon-retained-source-recovery-20261005';
function decode(raw){
 const marker=raw.indexOf('"output":');if(marker<0)throw new Error('Named tool output absent');
 const start=raw.indexOf('"',marker+'"output":'.length);let result='',complete=false;
 for(let index=start+1;index<raw.length;index++){
  const char=raw[index];
  if(char==='"'){complete=true;break;}
  if(char==='\n'||char==='\r')break;
  if(char!=='\\'){result+=char;continue;}
  const next=raw[++index];
  const escapes={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','"':'"','\\':'\\','/':'/'};
  if(Object.hasOwn(escapes,next)){result+=escapes[next];continue;}
  if(next==='u'&&/^[a-f0-9]{4}$/i.test(raw.slice(index+1,index+5))){result+=String.fromCharCode(parseInt(raw.slice(index+1,index+5),16));index+=4;continue;}
  break;
 }
 return{result,complete};
}
const results=[];
for(const number of [23,31]){
 const raw=await readFile(root+'/read-output-'+number+'.txt','utf8');const decoded=decode(raw);
 await writeFile(root+'/decoded-prefix-'+number+'.txt',decoded.result,{flag:'wx'});
 results.push({record:number,chars:decoded.result.length,lines:decoded.result.split(/\r?\n/).length,completeJsonString:decoded.complete,first100:decoded.result.slice(0,100),last100:decoded.result.slice(-100)});
}
await writeFile(root+'/DECODED-PREFIX-RECEIPT.json',JSON.stringify(results,null,2),{flag:'wx'});
console.log(JSON.stringify(results));
