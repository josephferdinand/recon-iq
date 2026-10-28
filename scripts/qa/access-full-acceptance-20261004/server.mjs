import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {toJSONAsync,fromCrossJSON} from 'seroval';
import {defaultSerovalPlugins} from '@tanstack/router-core';
import {host,sha} from './common.mjs';
const compiled='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930/dist/_worker.js/_ssr';
const mappings=[];
for(const filename of await readdir(compiled)){
 if(!/^(business-units|groups|access|governance-[a-z-]+|rbac|data-sources|data-prep(?:-request)?|recon-access-setup|recon-defs-io|recon-evidence|recons|tenant-admin)\.functions.*\.mjs$/.test(filename))continue;
 const s=await readFile(path.join(compiled,filename),'utf8');
 for(const match of s.matchAll(/id:[`"]([a-f0-9]{64})[`"],name:[`"]([a-zA-Z0-9]+)[`"],filename:[`"]([^`"]+)[`"]}/g))mappings.push({id:match[1],name:match[2],source:match[3],compiled:filename,compiledSha256:sha(s)});
}
export async function server(actor,name,data,{method='POST',source}={}){
 const matches=mappings.filter(m=>m.name===name&&(!source||m.source===source));
 if(matches.length!==1)throw Error('Exact compiled handler mapping missing/ambiguous: '+name);
 const map=matches[0];const payload=JSON.stringify(await toJSONAsync({data},{plugins:defaultSerovalPlugins}));
 const url=host+'/_serverFn/'+map.id+(method==='GET'?'?'+new URLSearchParams({payload}):'');
 const start=Date.now();const r=await fetch(url,{method,headers:{Authorization:'Bearer '+actor.session.access_token,'x-tsr-serverFn':'true','Content-Type':'application/json',Accept:'application/json'},...(method==='POST'?{body:payload}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 const raw=await r.json();const value=r.headers.has('x-tss-serialized')?fromCrossJSON(raw,{plugins:defaultSerovalPlugins}):raw;
 const error=value instanceof Error?value:value?.error;
 return {http:r.status,ms:Date.now()-start,map,data:error?null:value?.result??value,error:error?{message:String(error.message??error).replace(/eyJ[A-Za-z0-9_.-]+|Bearer\s+\S+/g,'[redacted]'),status:error.status,code:error.code}:null};
}
