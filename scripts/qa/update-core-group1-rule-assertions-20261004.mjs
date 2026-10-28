import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',oldAckFile=process.argv[2];
const ack=JSON.parse(await readFile(oldAckFile,'utf8')),source=await readFile(ack.driver_file,'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
if(sha(source)!==ack.driver_sha256)throw new Error('Actual QA driver preimage changed');
const assertions=[
  ["same(definition.rules, pack.spec.rules, 'approved_recon_rules_changed');","same(definition.rules, pack.spec.rules.map(rule => ({ ...rule, params: rule.params ?? {} })), 'approved_recon_rules_changed');"],
  ["same(run.definition_snapshot.rules, pack.spec.rules, 'run_snapshot_rules_changed');","same(run.definition_snapshot.rules, pack.spec.rules.map(rule => ({ ...rule, params: rule.params ?? {} })), 'run_snapshot_rules_changed');"],
];
let next=source;
for(const [before,after] of assertions){if(next.split(before).length!==2)throw new Error('Exact rules assertion boundary changed');next=next.replace(before,after);}
const runtimeFile='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930/src/lib/recons.functions.ts';
const runtime=await readFile(runtimeFile,'utf8');
if(!runtime.includes('} = rule.params ?? {};')||!runtime.includes('return { ...rule, params };'))throw new Error('Actual deployed rule defaulting source absent');
const journalFile=ack.config_file.replace('parent-owned-nonsecret-bindings.json','FVI-CORE455-20261004-A-journal.jsonl');
const events=(await readFile(journalFile,'utf8')).trim().split('\n').map(JSON.parse);
if(events.some(event=>event.state==='intent'&&!events.some(done=>done.key===event.key&&done.state==='completed'&&done.payload_sha256===event.payload_sha256)))throw new Error('Actual unresolved operation exists');
const tag=Date.now();
await writeFile(`${root}/FVI-CORE455-DRIVER-PRE-RULE-DEFAULT-CONTRACT-${tag}.mjs`,source,{flag:'wx',mode:0o600});
await writeFile(ack.driver_file,next);
const transition={at:new Date().toISOString(),previousDriverSha256:ack.driver_sha256,nextDriverSha256:sha(next),actualRuntimeSourceSha256:sha(runtime),change:'Expected approved/run rules include actual server params={} default only; all input fields/rule order/keys/tolerances and entire saved-rule equality retained',completedOperations:events.filter(e=>e.state==='completed').length,businessWrites:0,noReplay:true};
await appendFile(journalFile,JSON.stringify({key:'parent-observed-rule-default-contract-transition',state:'qualified',...transition})+'\n');
const file=`${root}/FVI-CORE-GROUP1-RECON-F52-ACK-RULE-CONTRACT-${tag}.json`;
await writeFile(file,JSON.stringify({...ack,driver_sha256:sha(next),source_contract_transition:transition,predecessor_ack:oldAckFile},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({ackFile:file,completedOperationsPreserved:transition.completedOperations,exactRuleEqualityRetained:true,businessWrites:0}));
