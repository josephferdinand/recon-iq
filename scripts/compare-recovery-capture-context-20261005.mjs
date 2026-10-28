import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),results=[];
for(const[environment,oldName,newName]of[['PROD','FVI-CORE-SUCCESSOR-METADATA-PROD-458-433-1791168046365.json','FVI-RECON-ATOMIC-RECOVERY-CONTEXT-PROD-1791170630706.json'],['DEV','FVI-CORE-SUCCESSOR-METADATA-DEV-458-433-1791168058639.json','FVI-RECON-ATOMIC-RECOVERY-CONTEXT-DEV-1791170641330.json']]){
 const a=JSON.parse(await readFile(root+'/'+oldName,'utf8')).captures.find(x=>x.kind==='recovery_consumed').rows[0].recovery_shapes;
 const b=JSON.parse(await readFile(root+'/'+newName,'utf8')).captures.find(x=>x.kind==='recovery_exact_write_transport_context').rows[0].recovery_shapes;
 const differences=[];
 function visit(before,after,p=''){if(JSON.stringify(before)===JSON.stringify(after))return;if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)){for(const key of new Set([...Object.keys(before),...Object.keys(after)]))visit(before[key],after[key],p?p+'.'+key:key);}else differences.push({path:p,beforeHash:sha(before??null),afterHash:sha(after??null),...(p==='search_path'?{before,after}:{})});}
 visit(a,b);results.push({environment,oldReceipt:oldName,currentReceipt:newName,differences,allOtherConsumedFieldsExact:differences.every(x=>x.path==='search_path')});
}
const file='docs/evidence/FVI_RECOVERY_CONSUMED_CONTEXT_DIFF_2026-10-05-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),results,noSQLMutated:true},null,2),{flag:'wx'});console.log(JSON.stringify({file,results}));
