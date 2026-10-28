import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const receipt=JSON.parse(fs.readFileSync(path.join(out,'native-receipt.json'),'utf8'));
const source=fs.readFileSync(path.join(out,'unqualified-implementation.sql'),'utf8');
const definitions=[...source.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ((?:public|private)\.[a-z_]+)\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$;/g)];
if(!receipt.stopped||!definitions.length)throw new Error('Missing stopped own native fixture/source');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const bin='C:/Program Files/PostgreSQL/17/bin';const data=path.join(out,'native-pg17-data');
const fd=fs.openSync(path.join(out,'native-pg-control.log'),'a');
const control=action=>{const r=spawnSync(path.join(bin,'pg_ctl.exe'),['-D',data,...(action==='start'?['-l',path.join(out,'native-server.log'),'-w','start']:['-m','fast','-w','stop'])],{windowsHide:true,stdio:['ignore',fd,fd],timeout:20000});if(r.error||r.status!==0)throw new Error('Own cluster '+action+' failed');};
let report={tier:'own native PG17 compiled postimages; not target catalog qualification',ready:false};
try{
 control('start');
 const sql=`SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'source',p.prosrc,'source_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN (${definitions.map(m=>"'"+m[1]+"'").join(',')});`;
 const r=spawnSync(path.join(bin,'psql.exe'),['-X','-At','-h','127.0.0.1','-p',String(receipt.port),'-U','postgres','-d',receipt.database,'-v','ON_ERROR_STOP=1','-c',sql],{windowsHide:true,encoding:'utf8',maxBuffer:3*1024*1024,timeout:15000});
 if(r.status!==0)throw new Error(r.stderr);
 const postimages=JSON.parse(r.stdout);
 for(const m of definitions){const row=postimages.find(p=>p.schema+'.'+p.name===m[1]);if(!row||row.source_sha256!==hash(m[2]))throw new Error('Compiled postimage differs: '+m[1]);}
 fs.writeFileSync(path.join(out,'native-compiled-postimages.json'),JSON.stringify(postimages,null,2)+'\n');
 report={...report,status:'EXACT_COMPILED_SOURCE_MATCH',matched:definitions.length,sourceSha256:hash(source)};
}catch(e){report.status='FAILED';report.error=e.message;process.exitCode=1;}
finally{
 try{control('stop');report.stopped=true;}catch(e){report.stopError=e.message;process.exitCode=1;}
 fs.closeSync(fd);fs.writeFileSync(path.join(out,'native-postimages-receipt.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
