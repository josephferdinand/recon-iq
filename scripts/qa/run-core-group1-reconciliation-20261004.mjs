import { readFile, writeFile, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = './LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const ackFile = process.argv[2];
if (!ackFile || path.dirname(path.resolve(ackFile)) !== path.resolve(root)) throw new Error('Private current ACK required');
const ack = JSON.parse(await readFile(ackFile, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
if (!ack.new_independent_owned_qa_case || !ack.preserved_old_unknown_intent || JSON.stringify(ack.execute_scope) !== '["01"]' || sha(await readFile(ack.driver_file)) !== ack.driver_sha256) throw new Error('Frozen full workflow ACK changed');
const driver = await import(pathToFileURL(ack.driver_file).href);
const config = JSON.parse(await readFile(ack.config_file, 'utf8'));
driver.validateBindings(config);
if (sha(driver.stable(config)) !== ack.config_sha256 || config.run_tag !== 'FVI-CORE455-20261004-A') throw new Error('Independent current run binding changed');
const transport = JSON.parse(await readFile(`${root}/FVI-QA-TRANSPORT-PROD-20261001.json`, 'utf8'));
const env = { FVI_BENCHMARK_PUBLISHABLE_KEY: transport.anonKey };
for (const kind of ['maker','checker']) {
  const document = JSON.parse(await readFile(ack.sessions[kind], 'utf8'));
  if (document.user_id !== config.actors[kind].user_id || document.tenant_id !== config.tenant_id || document.session.expires_at < Date.now()/1000+300) throw new Error('Fresh ordinary QA sessions required');
  env[`FVI_BENCHMARK_${kind.toUpperCase()}_TOKEN`] = document.session.access_token;
}
const out = path.dirname(ack.config_file);
if (!process.argv.includes('--execute')) { console.log(JSON.stringify({ready:true,executeScope:['01'],businessWrites:0})); process.exit(0); }
const resume = process.argv.includes('--resume');
if (resume) {
  for(const file of (await readdir(out)).filter(name=>/^actual-(execution|resume-\d+)\.lock$/.test(name))){
    const old = JSON.parse(await readFile(path.join(out,file),'utf8'));
    if (!Number.isInteger(old.pid) || old.pid<=0) throw new Error('Executor PID evidence unavailable');
    const processState=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',`if(Get-Process -Id ${old.pid} -ErrorAction SilentlyContinue){'LIVE'}else{'ABSENT'}`],{encoding:'utf8',windowsHide:true});
    if(processState.status!==0||processState.stdout.trim()!=='ABSENT')throw new Error('An executor remains live or unconfirmed; no restart');
  }
  if(!ack.source_contract_transition?.noReplay)throw new Error('Explicit qualified source transition required');
}
const lock = await open(path.join(out,resume?'actual-resume-'+Date.now()+'.lock':'actual-execution.lock'),'wx');
await lock.writeFile(JSON.stringify({at:new Date().toISOString(),pid:process.pid,ackFile}));
await lock.close();
const journal = new driver.Journal(path.join(out,config.run_tag+'-journal.jsonl'));
if (journal.entries.some(entry => entry.state === 'intent'&&!journal.entries.some(done=>done.key===entry.key&&done.payload_sha256===entry.payload_sha256&&(done.state==='completed'||(done.state==='superseded_uncertain_not_replayed'&&done.replacement_key&&done.proof_file))))) throw new Error('Unresolved intent requires outcome reconciliation, no blind restart');
const packs = driver.inspectPacks(driver.PACK);
if(!resume)journal.record({key:'baseline',config_sha256:ack.config_sha256,driver_sha256:ack.driver_sha256,fixture_sha256:packs.inventory.integrity_sha256,new_case_not_old_intent_replay:true});
try {
  const hosted = await driver.hostedTransport(config,env,journal);
  const units = await hosted.read('checker','business_units',{id:'eq.'+config.bu_id},'id,tenant_id');
  if (units.length !== 1 || units[0].tenant_id !== config.tenant_id) throw new Error('Current owned QA business unit unconfirmed');
  const result = await driver.executeScenario(packs.packs.find(pack => pack.scenario.id === '01'),config,hosted,out);
  const receipt = {at:new Date().toISOString(),result,fullCoreWorkflowVerified:true,fullGroupClosed:false,oldUnknownIntentPreserved:true,wholeTenBenchmarksCompleted:false};
  await writeFile(path.join(out,'hosted-core-workflow-summary.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:'HOSTED_CORE_WORKFLOW_VERIFIED',artifact:path.join(out,'hosted-core-workflow-summary.json'),reconciliation:result.definition_id}));
} catch (error) {
  const code = /^[\w:./ -]{1,220}$/.test(error.message??'') ? error.message : 'hosted_workflow_outcome_unconfirmed';
  await writeFile(path.join(out,'actual-execution-failure-'+Date.now()+'.json'),JSON.stringify({at:new Date().toISOString(),code,unknownIntentPreserved:true,automaticRetry:false}),{flag:'wx'});
  console.error(JSON.stringify({status:'HOSTED_WORKFLOW_GAP_JOURNAL_RETAINED',code}));
  process.exitCode=1;
}
