import {readFile,writeFile} from 'node:fs/promises';
const root='output/recon-retained-source-recovery-20261005';
function decode(raw,start){
 let result='',complete=false;
 for(let index=start+1;index<raw.length;index++){
  const char=raw[index];if(char==='"'){complete=true;break;}if(char==='\n'||char==='\r')break;
  if(char!=='\\'){result+=char;continue;}const next=raw[++index];
  const escapes={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','"':'"','\\':'\\','/':'/'};
  if(Object.hasOwn(escapes,next)){result+=escapes[next];continue;}
  if(next==='u'&&/^[a-f0-9]{4}$/i.test(raw.slice(index+1,index+5))){result+=String.fromCharCode(parseInt(raw.slice(index+1,index+5),16));index+=4;continue;}break;
 }
 return{result,complete};
}
const receipts=[];
for(const record of [23,31]){
 const raw=await readFile(root+'/read-output-'+record+'.txt','utf8');let cursor=0,number=0;
 while((cursor=raw.indexOf('"output":',cursor))>=0){
  const start=raw.indexOf('"',cursor+9);cursor+=9;if(start<0)break;
  const value=decode(raw,start),file='read-section-'+record+'-'+(++number)+'.txt';
  await writeFile(root+'/'+file,value.result,{flag:'wx'});
  receipts.push({record,number,file,bytes:Buffer.byteLength(value.result),lines:value.result.split(/\r?\n/).length,completeJsonString:value.complete,first90:value.result.slice(0,90),last90:value.result.slice(-90)});
 }
}
await writeFile(root+'/READ-SECTIONS.json',JSON.stringify(receipts,null,2),{flag:'wx'});
console.log(JSON.stringify(receipts));
