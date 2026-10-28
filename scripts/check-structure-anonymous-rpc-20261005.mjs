import{readFile,writeFile}from'node:fs/promises';
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',results=[];
for(const[environment,ref,date]of[['PROD','YOUR_PROJECT_REF','20261001'],['DEV','YOUR_PROJECT_REF','20261002']]){
 const transport=JSON.parse(await readFile(root+'/FVI-QA-TRANSPORT-'+environment+'-'+date+'.json','utf8'));
 if(transport.projectRef!==ref||new URL(transport.apiUrl).hostname!==ref+'.supabase.co')throw Error('Exact public transport target');
 const legacy=!transport.anonKey.startsWith('sb_publishable_');if(legacy&&JSON.parse(Buffer.from(transport.anonKey.split('.')[1],'base64url')).role!=='anon')throw Error('Public transport role');
 const response=await fetch(transport.apiUrl+'/rest/v1/rpc/seed_tenant_group_presets_for_bu',{method:'POST',headers:{apikey:transport.anonKey,'content-type':'application/json',...(legacy?{authorization:'Bearer '+transport.anonKey}:{})},body:JSON.stringify({_tenant_id:'00000000-0000-0000-0000-000000000000',_bu_id:'00000000-0000-0000-0000-000000000000'}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(![401,403].includes(response.status)||data.code!=='42501')throw Error('Anonymous purpose-RPC refusal differs; no replay');
 results.push({environment,ref,http:response.status,code:data.code,anonymousExecutionDenied:true,noBusinessWrite:true});
}
const file='docs/evidence/FVI_STRUCTURE_ANONYMOUS_REFUSAL_2026-10-05-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),results,realHostedAnonymous:true,positiveActorAcceptance:false},null,2),{flag:'wx'});console.log(JSON.stringify({file,results}));
