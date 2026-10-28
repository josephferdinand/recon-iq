import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const bin='C:/Program Files/PostgreSQL/17/bin';
const data=path.join(out,'native-pg17-data');
const scopeFocus=process.argv.includes('--focus-scope-validation');
const versionFocus=process.argv.includes('--focus-version-evidence');
const supplement=process.argv.includes('--supplement-own-fixture')||scopeFocus||versionFocus;
const fixture=path.join(out,versionFocus?'native-version.sql':scopeFocus?'native-scope.sql':supplement?'native-supplement.sql':'native-fixture.sql');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let lastStderr='';
const run=(exe,args)=>{
 let fd;const log=path.join(out,'native-pg-control.log');
 if(exe==='pg_ctl')fd=fs.openSync(log,'a');
 const r=spawnSync(path.join(bin,exe+'.exe'),args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:3*1024*1024,...(fd!==undefined?{stdio:['ignore',fd,fd]}:{})});
 if(fd!==undefined)fs.closeSync(fd);
 lastStderr=r.stderr??'';
 fs.appendFileSync(path.join(out,'native-run.log'),`\n${exe}: exit ${r.status}\n${r.stdout??''}${r.stderr??''}`);
 if(r.error||r.status!==0)throw new Error(`${exe} failed; inspect native-run.log (${r.status})`);
 return r.stdout;
};
if(fs.statfsSync(out).bavail*fs.statfsSync(out).bsize<1024*1024*1024)throw new Error('Less than 1GiB free; native fixture refused');
const resume=process.argv.includes('--resume-own-fixture')||supplement;
if(fs.existsSync(data)&&!resume)throw new Error('Native fixture data already exists; inspect saved outcome, never overwrite or restart blindly');
const probe=net.createServer();
await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
let port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
let prior;
if(resume){
 prior=JSON.parse(fs.readFileSync(path.join(out,'native-receipt.json'),'utf8'));
 if(supplement&&prior.status!==(versionFocus?'NATIVE_SCOPE_PASSED_CURRENT_CATALOG_PENDING':scopeFocus?'NATIVE_SUPPLEMENT_PASSED_CURRENT_CATALOG_PENDING':'NATIVE_WORKFLOW_PASSED_CURRENT_CATALOG_PENDING'))throw new Error('Focus requires retained completed predecessor proof');
 fs.copyFileSync(path.join(out,'native-receipt.json'),path.join(out,'native-receipt-'+Date.now()+'.json'));
 port=prior.port;
 if(!fs.existsSync(path.join(data,'PG_VERSION'))||fs.readFileSync(path.join(data,'PG_VERSION'),'utf8').trim()!=='17')throw new Error('Own cluster identity mismatch');
}
let started=false;
const report={tier:'synthetic native PG17, non-Docker; not hosted authentication/workflow proof',fixtureSha256:sha(fixture),port,ready:false};
try{
 report.engine=run('postgres',['--version']).trim();
 if(!resume){
  run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
  fs.appendFileSync(path.join(data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${port}\nmax_connections=10\nshared_buffers='16MB'\nmin_wal_size='32MB'\nmax_wal_size='64MB'\n`);
 }
 if(resume&&fs.existsSync(path.join(data,'postmaster.pid')))run('pg_ctl',['-D',data,'status']);
 else run('pg_ctl',['-D',data,'-l',path.join(out,'native-server.log'),'-w','start']);
 started=true;
 const database=supplement?prior.database:'mapped_attempt_'+Date.now();report.database=database;
 if(!supplement)run('psql',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE '+database]);
 const proof=run('psql',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-f',fixture]);
 report.status=versionFocus?'NATIVE_VERSION_PASSED_CURRENT_CATALOG_PENDING':scopeFocus?'NATIVE_SCOPE_PASSED_CURRENT_CATALOG_PENDING':supplement?'NATIVE_SUPPLEMENT_PASSED_CURRENT_CATALOG_PENDING':'NATIVE_WORKFLOW_PASSED_CURRENT_CATALOG_PENDING';report.proof=proof.slice(-1800);
 report.cases=[...lastStderr.matchAll(/NOTICE:\s+PASS: ([^\r\n]+)/g)].map(m=>m[1]);
 if(supplement)report.retainedPrimary={fixtureSha256:prior.fixtureSha256,database:prior.database,engine:prior.engine};
 if(scopeFocus)report.retainedSupplement={cases:prior.cases,retainedPrimary:prior.retainedPrimary};
 if(versionFocus)report.retainedEarlier={cases:prior.cases,retainedSupplement:prior.retainedSupplement,retainedPrimary:prior.retainedPrimary};
}catch(e){report.status='FAILED';report.error=e.message;process.exitCode=1;}
finally{
 if(started){try{run('pg_ctl',['-D',data,'-m','fast','-w','stop']);report.stopped=true;}catch(e){report.stopError=e.message;process.exitCode=1;}}
 fs.writeFileSync(path.join(out,'native-receipt.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
