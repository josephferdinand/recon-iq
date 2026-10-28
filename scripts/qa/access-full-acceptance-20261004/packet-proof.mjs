import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {out,sha,tenant} from './common.mjs';
const require=createRequire(import.meta.url),manifest=JSON.parse(await readFile(path.join(out,'packet','MANIFEST.json'),'utf8'));
const bu='103f53b1-d52e-4e4d-b975-5500abe09d5c',group='861d9b82-258b-4e2b-abe6-ad7ffe32b9b4';
function moduleFrom(source){
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};
 const createServerFn=()=>{let validate=x=>x;const b={middleware:()=>b,validator:v=>(validate=v,b),handler:h=>async({data,context})=>h({data:validate(data),context})};return b;};
 vm.runInNewContext(compiled,{exports,require:name=>name==='@tanstack/react-start'?{createServerFn}:name.includes('auth-middleware')?{requireSupabaseAuth:()=>({})}:require(name),console,Error},{timeout:3000});
 return exports;
}
function context(options={}){
 const writes=[],rpcCalls=[];const c={userId:'86655159-7270-4635-a0f0-e3a627ad49fc',writes,rpcCalls};
 c.supabase={rpc:async(name,args)=>{rpcCalls.push({name,args});if(options.rpcThrows)throw Error('Role transport unavailable');return {data:name==='effective_user_permissions'?[{permission_id:'owned.fixture.read'}]:name==='is_platform_admin'?options.platform===true:options.admin===true,error:options.roleError?{message:'role unavailable'}:null};},from:table=>{
  const filters={};let mutation=false;
  const result=()=>table==='business_units'&&!mutation?{data:!options.buError&&options.active!==false&&filters.id===bu&&filters.tenant_id===tenant?{id:bu}:null,error:options.buError?{message:'BU unavailable'}:null}:{data:{id:table==='tenant_groups'?group:bu},error:null};
  const b={select:()=>b,eq:(k,v)=>(filters[k]=v,b),insert:row=>(writes.push({table,row}),mutation=true,b),update:row=>(writes.push({table,row}),mutation=true,b),single:async()=>result(),maybeSingle:async()=>result(),then:(yes,no)=>Promise.resolve(result()).then(yes,no)};return b;
 }};return c;
}
const results=[];
const record=async(name,fn)=>{await fn();results.push({name,passed:true});};
for(const entry of manifest.sourceFiles.filter(x=>x.file.endsWith('.functions.ts'))){
 const before=await readFile(entry.preimage,'utf8'),after=await readFile(entry.proposed,'utf8');assert.equal(sha(before),entry.preimageSha256);assert.equal(sha(after),entry.postimageSha256);
 const old=moduleFrom(before),fixed=moduleFrom(after);const groupFile=entry.file.endsWith('groups.functions.ts'),name=groupFile?'createGroup':'createBusinessUnit',data={tenant_id:tenant,name:'Owned scoped QA',...(groupFile?{bu_id:bu}:{})};
 await record(entry.kind+' '+name+' old platform-only bypass reproduced locally',async()=>{const ctx=context({platform:true});await old[name]({data,context:ctx});assert.ok(ctx.writes.some(x=>x.table=== (groupFile?'tenant_groups':'business_units')));});
 await record(entry.kind+' '+name+' platform-only refused before business write',async()=>{const ctx=context({platform:true});await assert.rejects(fixed[name]({data,context:ctx}),/tenant_admin required/);assert.equal(ctx.writes.length,0);assert.ok(ctx.rpcCalls.every(x=>x.name!=='is_platform_admin'));});
 await record(entry.kind+' '+name+' ordinary refused',async()=>{const ctx=context();await assert.rejects(fixed[name]({data,context:ctx}),/tenant_admin required/);assert.equal(ctx.writes.length,0);});
 await record(entry.kind+' '+name+' pure tenant admin allowed',async()=>{const ctx=context({admin:true});const result=await fixed[name]({data,context:ctx});assert.equal(result.id,groupFile?group:bu);assert.ok(ctx.writes.some(x=>x.table==='audit_log'));});
 await record(entry.kind+' '+name+' errored role response fails closed',async()=>{const ctx=context({admin:true,roleError:true});await assert.rejects(fixed[name]({data,context:ctx}),/tenant_admin required/);assert.equal(ctx.writes.length,0);});
 await record(entry.kind+' '+name+' role transport failure performs no write',async()=>{const ctx=context({admin:true,rpcThrows:true});await assert.rejects(fixed[name]({data,context:ctx}),/transport unavailable/);assert.equal(ctx.writes.length,0);});
 if(groupFile){
  for(const [label,value] of [['omitted',undefined],['null',null],['malformed','x']])await record(entry.kind+' createGroup '+label+' BU refused before write',async()=>{const ctx=context({admin:true});await assert.rejects(fixed.createGroup({data:{tenant_id:tenant,name:'Owned scoped QA',...(value===undefined?{}:{bu_id:value})},context:ctx}));assert.equal(ctx.writes.length,0);});
  for(const [label,options,id] of [['foreign',{admin:true},'00000000-0000-4000-8000-000000000001'],['archived',{admin:true,active:false},bu],['unavailable',{admin:true,buError:true},bu]])await record(entry.kind+' createGroup '+label+' BU refused before write',async()=>{const ctx=context(options);await assert.rejects(fixed.createGroup({data:{...data,bu_id:id},context:ctx}),/active Business Unit/);assert.equal(ctx.writes.length,0);});
  await record(entry.kind+' legacy group name-only edit remains available',async()=>{const ctx=context({admin:true});await fixed.updateGroup({data:{tenant_id:tenant,group_id:group,name:'Legacy retained name edit'},context:ctx});assert.ok(ctx.writes.some(x=>x.table==='tenant_groups'));});
  await record(entry.kind+' explicit BU removal refused',async()=>{const ctx=context({admin:true});await assert.rejects(fixed.updateGroup({data:{tenant_id:tenant,group_id:group,bu_id:null},context:ctx}));assert.equal(ctx.writes.length,0);});
  await record(entry.kind+' old permission inspector other-user leak reproduced locally',async()=>{const ctx=context();const rows=await old.effectivePermissions({data:{tenant_id:tenant,user_id:'72ebbe01-4ec7-403c-95b1-9a0482085cf2'},context:ctx});assert.equal(rows.length,1);});
  await record(entry.kind+' ordinary other-user inspector denied before permission lookup',async()=>{const ctx=context();await assert.rejects(fixed.effectivePermissions({data:{tenant_id:tenant,user_id:'72ebbe01-4ec7-403c-95b1-9a0482085cf2'},context:ctx}),/administrative access/);assert.ok(!ctx.rpcCalls.some(x=>x.name==='effective_user_permissions'));});
  await record(entry.kind+' ordinary self inspector retained',async()=>{const ctx=context();const rows=await fixed.effectivePermissions({data:{tenant_id:tenant,user_id:ctx.userId},context:ctx});assert.equal(rows.length,1);});
  for(const [name,options] of [['tenant-admin',{admin:true}],['platform-admin',{platform:true}]])await record(entry.kind+' '+name+' existing inspect scope retained',async()=>{const ctx=context(options);const rows=await fixed.effectivePermissions({data:{tenant_id:tenant,user_id:'72ebbe01-4ec7-403c-95b1-9a0482085cf2'},context:ctx});assert.equal(rows.length,1);});
  await record(entry.kind+' inspector errored authority fails closed',async()=>{const ctx=context({admin:true,roleError:true});await assert.rejects(fixed.effectivePermissions({data:{tenant_id:tenant,user_id:'72ebbe01-4ec7-403c-95b1-9a0482085cf2'},context:ctx}),/administrative access/);assert.ok(!ctx.rpcCalls.some(x=>x.name==='effective_user_permissions'));});
 }
}
for(const entry of manifest.sourceFiles.filter(x=>x.file.endsWith('.tsx'))){const before=await readFile(entry.preimage,'utf8'),after=await readFile(entry.proposed,'utf8');const marker='function PresetsList(';assert.equal(before.slice(before.indexOf(marker)),after.slice(after.indexOf(marker)));const diagnostics=ts.transpileModule(after,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true}).diagnostics??[];assert.equal(diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);results.push({name:entry.kind+' changed form parses; preset and permission inspector bytes unchanged',passed:true});}
await writeFile(path.join(out,'packet','FOCUSED-PROOF.json'),JSON.stringify({at:new Date().toISOString(),tier:'local isolated mocked handler behavioral proof, not deployment',cases:results.length,results,globalBuildRun:false},null,2));console.log(JSON.stringify({passed:results.length,globalBuildRun:false}));
