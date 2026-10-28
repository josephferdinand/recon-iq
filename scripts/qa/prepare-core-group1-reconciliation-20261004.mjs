import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = './LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const candidate = './LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const bindingFile = process.argv[2], refreshFile = process.argv[3];
for (const file of [bindingFile, refreshFile]) if (!file || path.dirname(path.resolve(file)) !== path.resolve(root)) throw new Error('Exact private intake files required');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = JSON.parse(await readFile(bindingFile, 'utf8'));
const refreshed = JSON.parse(await readFile(refreshFile, 'utf8'));
if (binding.deployment_id !== 'f52df692-7c26-40b4-bce0-989526f875b1' || binding.ledger_count !== 455 || Object.keys(binding.operations).length !== 6) throw new Error('Current six-operation binding required');
const originalFile = `${candidate}/scripts/qa/benchmark-execution-01-04-20261003.mjs`;
const original = await readFile(originalFile, 'utf8');
const oldRelease = "export const CURRENT_RELEASE = { deployment_id: '7180321a-e9c5-4014-bd9b-a3f1c52e392b', ledger_count: 451, latest_migration: '20261003180000',\n  dev_deployment_id: 'ce449c37-d9cd-4a7a-8d5f-032c881f4e95', dev_ledger_count: 429 };";
const normalized = original.replaceAll('\r\n', '\n');
if (!normalized.includes(oldRelease) || (normalized.match(/loadManagementOpenApi\(config, rpcSchemasFromOpenApi\)/g) ?? []).length !== 2) throw new Error('Frozen driver adaptation boundary changed');
let source = normalized.replace(oldRelease, "export const CURRENT_RELEASE = { deployment_id: 'f52df692-7c26-40b4-bce0-989526f875b1', ledger_count: 455, latest_migration: '20261004082000',\n  dev_deployment_id: 'ce449c37-d9cd-4a7a-8d5f-032c881f4e95', dev_ledger_count: 431 };");
source = source.replace("import { SCHEMA_POLICY_URL } from './benchmark-management-metadata-20261004.mjs';", "import { SCHEMA_POLICY_URL, loadManagementMetadata } from './benchmark-management-metadata-20261004.mjs';")
  .replace("import { loadManagementOpenApi } from './benchmark-management-openapi-20261004.mjs';\n", '')
  .replaceAll('loadManagementOpenApi(config, rpcSchemasFromOpenApi)', 'loadManagementMetadata(config)');
const rpcMarker = '    const result = await response.json();\n    if (denial) {';
if (!source.includes(rpcMarker)) throw new Error('RPC response observation boundary changed');
source = source.replace(rpcMarker, `    const result = await response.json();
    const responseFile = './LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/' + config.run_tag + '-RPC-RESPONSE-' + randomUUID() + '.json';
    writeFileSync(responseFile, stable({at:new Date().toISOString(),actor:kind,rpc:name,payload_sha256:hash(stable(data)),http:response.status,result}), {flag:'wx',mode:0o600});
    journal.record({key:'rpc-response',state:'observed',rpc:name,payload_sha256:hash(stable(data)),http:response.status,receipt_file:responseFile});
    if (denial) {`);
const driverFile = `${candidate}/scripts/qa/benchmark-execution-core455-20261004.mjs`;
try { await writeFile(driverFile, source, { flag: 'wx' }); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const existing = await readFile(driverFile, 'utf8');
  if (sha(existing) !== sha(source)) {
    const previousSource = source.replace(source.slice(source.indexOf('    const result = await response.json();\n    const responseFile'), source.indexOf('    if (denial) {') + '    if (denial) {'.length), rpcMarker);
    if (sha(existing) !== sha(previousSource)) throw new Error('Owned unexecuted driver source conflict');
    const journal = `${candidate}/output/godel-benchmark-driver-20261003/bindings-f52df692/dispatch/FVI-CORE455-20261004-A/FVI-CORE455-20261004-A-journal.jsonl`;
    try { await readFile(journal); throw new Error('Driver already dispatched; preserve source baseline'); } catch (check) { if (check.code !== 'ENOENT') throw check; }
    await writeFile(`${root}/FVI-CORE455-DRIVER-PRE-RESPONSE-OBSERVATION-${Date.now()}.mjs`, existing, { flag:'wx',mode:0o600 });
    await writeFile(driverFile, source);
  }
}
const driver = await import(pathToFileURL(driverFile).href);
const prior = JSON.parse(await readFile(`${root}/FVI-GODEL-BENCHMARK01-04-PARENT-ACK-PROD7180321A-LEDGER452-20261004-v5-NORMAL-REFRESH.json`, 'utf8'));
const config = { ...prior, ...binding, run_tag: 'FVI-CORE455-20261004-A', parent_owned_qa_ack: true,
  authorization_reference: 'Joseph 4 October first-group complete hosted QA authorization', isolated_owned_qa_actors: true,
  paired_dev_deployment_id: 'ce449c37-d9cd-4a7a-8d5f-032c881f4e95', paired_dev_ledger_count: 431 };
delete config.private_transport;
delete config.current_schema_capture;
const sessions = {};
for (const kind of ['maker','checker']) {
  const actor = refreshed.actors.find(item => item.label === `platform-${kind}`);
  if (actor?.user_id !== config.actors[kind].user_id || !actor.current_active_tenant_admin || actor.aal !== 'aal2' || actor.expires_at < Date.now()/1000+300) throw new Error('Actual fresh independent QA authority required');
  const saved = JSON.parse(await readFile(actor.session_file, 'utf8'));
  if (saved.user_id !== actor.user_id || saved.tenant_id !== config.tenant_id) throw new Error('Owned QA session mismatch');
  sessions[kind] = actor.session_file;
}
driver.validateBindings(config);
const { loadManagementMetadata, validateManagementMetadata } = await import(pathToFileURL(`${candidate}/scripts/qa/benchmark-management-metadata-20261004.mjs`).href);
const metadata = loadManagementMetadata(config);
if (metadata.rpc_abi.coverage !== 'COMPLETE') throw new Error('Current typed ten-RPC ABI required');
const metadataBytes = await readFile(config.metadata_source.path);
let rejectedWrongHash = false, rejectedStaleCapture = false;
try { validateManagementMetadata(metadataBytes, { ...config.metadata_source, sha256: '0'.repeat(64) }, config); } catch { rejectedWrongHash = true; }
try { validateManagementMetadata(metadataBytes, config.metadata_source, config, Date.now()+1900000); } catch { rejectedStaleCapture = true; }
if (!rejectedWrongHash || !rejectedStaleCapture) throw new Error('Metadata negative gates unproven');
const out = `${candidate}/output/godel-benchmark-driver-20261003/bindings-f52df692/dispatch/${config.run_tag}`;
await mkdir(out, { recursive: true });
const configFile = `${out}/parent-owned-nonsecret-bindings.json`;
try { await writeFile(configFile, JSON.stringify(config, null, 2), { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST' || driver.stable(JSON.parse(await readFile(configFile,'utf8'))) !== driver.stable(config)) throw error; }
const ackFile = `${root}/FVI-CORE-GROUP1-RECON-F52-ACK-${Date.now()}.json`;
await writeFile(ackFile, JSON.stringify({ at: new Date().toISOString(), config_file: configFile, driver_file: driverFile, driver_sha256: sha(source), original_driver_sha256: sha(original), config_sha256: sha(driver.stable(config)), metadata, sessions,
  new_independent_owned_qa_case: true, preserved_old_unknown_intent: true, execute_scope: ['01'], execution_started: false, rejectedWrongHash, rejectedStaleCapture, full_group_closed: false }, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ackFile, configFile, driverFile, typedRpcs: 10, negativeMetadataGates: 2, businessWrites: 0, oldUnknownIntentPreserved: true }));
