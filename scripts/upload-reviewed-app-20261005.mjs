import{readFile,writeFile,readdir,mkdir,stat}from'node:fs/promises';
import{createHash}from'node:crypto';
import{spawn}from'node:child_process';
import{createWriteStream}from'node:fs';
import path from'node:path';
const phase=process.argv[2];if(!['freeze','preview','production','readback'].includes(phase))throw Error('Explicit phase required');
const suffix=process.argv[3]==='repair02'?'-repair02':'';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928',root=path.resolve('output/parent-integrated-next-20261005/combined-prod-release'+suffix);
const account='YOUR_CLOUDFLARE_ID',previous='9e4c08cd-bfa6-4e37-bab4-c8377705c390',branch='codex-reviewed-combined-20261005'+suffix;
const sha=x=>createHash('sha256').update(x).digest('hex');
await mkdir(root,{recursive:true});
async function inventory(base,relative=''){const entries=[];for(const f of await readdir(path.join(base,relative),{withFileTypes:true})){const next=path.join(relative,f.name);if(f.isDirectory())entries.push(...await inventory(base,next));else if(f.isFile()){const bytes=await readFile(path.join(base,next));entries.push({path:next.replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});}}return entries.sort((a,b)=>a.path.localeCompare(b.path));}
async function run(args,log,env={}){const output=createWriteStream(log,{flags:'wx'});const child=spawn(process.execPath,args,{cwd:candidate,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});await new Promise(resolve=>output.end(resolve));if(code!==0)throw Error('Reviewed app command failed '+code+'; inspect '+log);}
if(phase==='freeze'){
 const build=await readFile('output/parent-integrated-next-20261005/home-reports/protected-prod-build-current'+suffix+'.log','utf8');
 const compiler=await readFile('output/parent-integrated-next-20261005/home-reports/typecheck-current-release-tickets-final'+suffix+'.log','utf8');
 const strictBytes=await readFile('output/parent-integrated-next-20261005/home-reports/STRICT-ARTIFACT-VERIFICATION'+suffix+'.json','utf8'),strict=JSON.parse(strictBytes);
 if(!build.includes('You can deploy this build')||strict.compileCompleted!==true||strict.runtimeDevRefFiles!==0||strict.serviceRoleMatches!==0||strict.strictSourceBackedStaticDocuments.length!==8||/error TS\d/.test(compiler))throw Error('Required current compiler/protected compiled artifact proof absent');
 await run([path.join(candidate,'scripts/prepare-pages-deploy-config.mjs'),'production'],path.join(root,'prepare-deploy-config.log'));
 const source=await inventory(path.join(candidate,'src')),artifacts=await inventory(path.join(candidate,'dist'));
 const receipt={at:new Date().toISOString(),project:'fvi-app',previous,source,artifacts,sourceSHA256:sha(JSON.stringify(source)),artifactSHA256:sha(JSON.stringify(artifacts)),buildLogSHA256:sha(build),compilerLogSHA256:sha(compiler),strictArtifactVerificationSHA256:sha(strictBytes),originalScanFailurePreserved:true,SQLApplied:false,marketingTouched:false};
 await writeFile(root+'/FROZEN.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({phase,sourceFiles:source.length,artifacts:artifacts.length,artifactSHA256:receipt.artifactSHA256}));process.exit(0);
}
const frozen=JSON.parse(await readFile(root+'/FROZEN.json','utf8'));
if(sha(JSON.stringify(await inventory(path.join(candidate,'dist'))))!==frozen.artifactSHA256)throw Error('Reviewed artifact drift');
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
function value(key){const lines=vault.split(/\r?\n/).filter(x=>x.startsWith('|')&&x.split('|')[1]?.trim().replace(/^[`*]+|[`*]+$/g,'')===key);if(lines.length!==1)throw Error('Unique FVI credential field required');return lines[0].split('|')[2].trim().replace(/^`|`$/g,'').replace(/^<|>$/g,'');}
const token=value('CLOUDFLARE_API_TOKEN');if(value('CLOUDFLARE_ACCOUNT_ID')!==account)throw Error('Account drift');
async function api(suffix){const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/pages/projects/fvi-app'+suffix,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});const data=await r.json();if(!r.ok||!data.success)throw Error('Cloudflare read failed HTTP'+r.status);return data.result;}
async function hosted(url){const r=await fetch(url+'/auth',{signal:AbortSignal.timeout(25000)}),html=await r.text();if(r.status!==200||r.headers.get('x-fvi-csp-nonce-applied')!=='1'||r.headers.has('x-ssr-error'))throw Error('Hosted auth/CSP/privacy failed');const css=[...html.matchAll(/(?:\/assets\/)(styles-[A-Za-z0-9_-]+\.css)/g)].map(x=>x[1])[0];if(!css)throw Error('Hosted stylesheet absent');const local=frozen.artifacts.find(x=>x.path==='assets/'+css);if(!local)throw Error('Hosted stylesheet is not reviewed artifact');const asset=await fetch(url+'/assets/'+css,{signal:AbortSignal.timeout(25000)});if(!asset.ok||sha(Buffer.from(await asset.arrayBuffer()))!==local.sha256)throw Error('Hosted stylesheet hash differs');return{at:new Date().toISOString(),url,authHTTP:200,cspNonceApplied:'1',diagnosticHeadersAbsent:true,stylesheet:css,stylesheetSHA256:local.sha256};}
if(phase==='preview'||phase==='production'){
 const project=await api('');if(project.production_branch!=='main'||project.canonical_deployment?.id!==previous)throw Error('Canonical identity changed; inspect without replay');
 if(phase==='production'){
  const preview=JSON.parse(await readFile(root+'/PREVIEW-READBACK.json','utf8'));if(preview.artifactSHA256!==frozen.artifactSHA256||preview.authHTTP!==200)throw Error('Exact hosted preview proof absent');
  const votes=JSON.parse(await readFile(root+'/COUNCIL-TALLY.json','utf8'));if(votes.affirmativeSeats.length<3||votes.artifactSHA256!==frozen.artifactSHA256||votes.materialFindingsResolved!==true)throw Error('Scoped council threshold absent');
 }
 await writeFile(root+'/'+phase.toUpperCase()+'-INTENT.json',JSON.stringify({at:new Date().toISOString(),phase,artifactSHA256:frozen.artifactSHA256,previous,status:'submission_pending'},null,2),{flag:'wx'});
 await run([path.join(candidate,'node_modules/wrangler/bin/wrangler.js'),'pages','deploy','dist','--project-name','fvi-app','--branch',phase==='preview'?branch:'main','--commit-dirty=true','--commit-message','Reviewed combined core Home Reference Governance Reports PDF Knowledge release'],root+'/'+phase+'-upload.log',{CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,NODE_OPTIONS:'--max-old-space-size=4096',GOMAXPROCS:'2'});
 const deployments=await api('/deployments?per_page=10'),deployment=phase==='preview'?deployments.find(x=>x.environment==='preview'&&x.deployment_trigger?.metadata?.branch===branch):(await api('')).canonical_deployment;
 if(!deployment||deployment.id===previous)throw Error('New completed deployment identity absent; inspect without replay');
 const check=await hosted(phase==='preview'?deployment.url:'https://app.reconiq.example');
 const receipt={...check,phase,deployment:deployment.id,artifactSHA256:frozen.artifactSHA256,previous,SQLApplied:false,fullWorkflowAcceptance:false};
 await writeFile(root+'/'+phase.toUpperCase()+'-READBACK.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
}else{const deployment=(await api('')).canonical_deployment;console.log(JSON.stringify({deployment:deployment.id,...await hosted('https://app.reconiq.example')}));}
