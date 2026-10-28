import{readFile,writeFile}from'node:fs/promises';
import{spawn}from'node:child_process';
import{createWriteStream}from'node:fs';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const file='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-PREVIEW-STARTUP-'+Date.now()+'.log';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
function value(key){const lines=vault.split(/\r?\n/).filter(x=>x.startsWith('|')&&x.split('|')[1]?.trim().replace(/^[`*]+|[`*]+$/g,'')===key);if(lines.length!==1)throw Error('FVI authority ambiguous');return lines[0].split('|')[2].trim().replace(/^`|`$/g,'');}
const output=createWriteStream(file,{flags:'wx'});
const child=spawn(process.execPath,[candidate+'/node_modules/wrangler/bin/wrangler.js','pages','deployment','tail','https://YOUR_PROJECT.pages.dev','--project-name','fvi-app','--format','json'],{cwd:candidate,env:{...process.env,CLOUDFLARE_API_TOKEN:value('CLOUDFLARE_API_TOKEN'),CLOUDFLARE_ACCOUNT_ID:value('CLOUDFLARE_ACCOUNT_ID')},windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
console.log(JSON.stringify({phase:'tail_started',ownedDiagnosticPID:child.pid,privateLog:file}));
await new Promise(resolve=>setTimeout(resolve,7000));
const r=await fetch('https://YOUR_PROJECT.pages.dev/auth',{signal:AbortSignal.timeout(20000)});await r.arrayBuffer();console.log(JSON.stringify({phase:'request',status:r.status}));
await new Promise(resolve=>setTimeout(resolve,6000));child.kill();await new Promise(resolve=>output.end(resolve));
console.log(JSON.stringify({phase:'captured',privateLog:file}));
