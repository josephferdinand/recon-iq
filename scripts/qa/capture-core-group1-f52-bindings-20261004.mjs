import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { manifestEntries, clientBinding } from 'file:///./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/scripts/qa/resolve-benchmark-bindings-5fbb-20261003.mjs';
const require = createRequire('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/package.json');
const ts = require('typescript');
const artifact = './LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930/dist';
const privateRoot = './LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const host = 'https://app.reconiq.example', ref = 'YOUR_PROJECT_REF';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const ssr = path.join(artifact, '_worker.js/_ssr');
const manifests = [];
for (const name of (await readdir(ssr)).filter(name => /^server-[\w-]+\.mjs$/.test(name))) {
  const file = path.join(ssr, name), bytes = await readFile(file);
  try { manifests.push({ file, bytes, entries: manifestEntries(bytes.toString(), file) }); }
  catch (error) { if (!error.message.startsWith('exact_manifest_export_required')) throw error; }
}
if (manifests.length !== 1) fail('One actual six-operation server manifest required');
const manifest = manifests[0], assets = [];
for (const name of (await readdir(path.join(artifact, 'assets'))).filter(name => name.endsWith('.js'))) {
  assets.push({ assetPath: '/assets/' + name, bytes: await readFile(path.join(artifact, 'assets', name)) });
}
const operations = {};
for (const entry of manifest.entries) {
  const implementation = path.resolve(path.dirname(manifest.file), entry.importer);
  const bytes = await readFile(implementation);
  const tree = ts.createSourceFile(implementation, bytes.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let exported = false;
  function walk(node) { if (ts.isExportSpecifier(node) && node.name.text === entry.server_export) exported = true; ts.forEachChild(node, walk); }
  walk(tree);
  if (!exported) fail('Actual server handler export missing:' + entry.operation);
  const matches = assets.filter(asset => asset.bytes.includes(entry.function_id));
  if (matches.length !== 1) fail('Actual client operation binding is ambiguous:' + entry.operation);
  const asset = matches[0];
  operations[entry.operation] = { ...clientBinding(asset.bytes.toString(), entry.function_id, asset.assetPath), function_id: entry.function_id,
    asset_path: asset.assetPath, asset_sha256: sha(asset.bytes), artifact_verified_export: entry.operation,
    server_export: entry.server_export, server_module: path.relative(artifact, implementation), server_module_sha256: sha(bytes), server_manifest_sha256: sha(manifest.bytes) };
}
const served = [];
for (const assetPath of [...new Set(Object.values(operations).map(operation => operation.asset_path))]) {
  const response = await fetch(host + assetPath, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok || sha(bytes) !== sha(assets.find(asset => asset.assetPath === assetPath).bytes)) fail('Current hosted asset differs:' + assetPath);
  served.push({ asset_path: assetPath, http: response.status, sha256: sha(bytes) });
}
const vault = await readFile('./.private/CREDENTIALS.md', 'utf8');
const start = vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'), end = vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if (start < 0 || end <= start) fail('FVI vault boundary unavailable');
const token = vault.slice(start, end).split(/\r?\n/).find(line => /^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(line))?.split('|')[2]?.trim().replace(/^`|`$/g, '');
if (!/^sbp_/.test(token ?? '')) fail('Metadata authority unavailable');
async function identity() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: "SELECT current_setting('server_version_num')::int AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest", read_only: true }), signal: AbortSignal.timeout(25000) });
  if (!response.ok) fail('Readonly current schema identity unconfirmed');
  return response.json();
}
const before = await identity();
if (before[0]?.engine !== 170006 || before[0]?.ledger !== 455 || before[0]?.latest !== '20261004082000') fail('Current PROD schema differs');
if (process.argv.includes('--catalog')) {
  const sqlFile = './LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/scripts/qa/benchmark-current-abi-metadata-readonly-20261004.sql';
  const sql = await readFile(sqlFile, 'utf8');
  const captureResponse = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: sql, read_only: true }), signal: AbortSignal.timeout(25000) });
  if (!captureResponse.ok) fail('Current read-only ABI catalog unconfirmed');
  const rows = await captureResponse.json(), after = await identity();
  if (JSON.stringify(before) !== JSON.stringify(after) || rows[0]?.benchmark_current_schema?.functions?.length !== 10) fail('Exact ten-RPC catalog drift');
  const at = new Date().toISOString(), tag = Date.now(), file = `${privateRoot}/FVI-CORE-GROUP1-F52-CATALOG-${tag}.json`;
  const envelope = { at, environment: 'PROD', ref, deployment_id: 'f52df692-7c26-40b4-bce0-989526f875b1', read_only: true, noBusinessRowsCaptured: true, querySha256: sha(sql), results: [{ rows }], identityBefore: before, identityAfter: after };
  const bytes = JSON.stringify(envelope, null, 2);
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  const bindingFile = `${privateRoot}/FVI-CORE-GROUP1-F52-BINDINGS-${tag}.json`;
  await writeFile(bindingFile, JSON.stringify({ at, deployment_id: envelope.deployment_id, ledger_count: 455, latest_migration: '20261004082000', artifact, operations, served,
    metadata_source: { path: file, sha256: sha(bytes), source: 'official_readonly_management_catalog', ref, schema: 'public', deployment_id: envelope.deployment_id, ledger_count: 455, latest: '20261004082000', result_key: 'benchmark_current_schema', max_age_ms: 1800000 }, parent_owned_qa_ack: false, hosted_business_writes: 0 }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ bindingFile, metadataFile: file, sixOperationsVerified: Object.keys(operations).length === 6, currentHostedAssets: served.length, schema: 455, businessWrites: 0, source: 'actual read-only ten-RPC typed catalog' }));
  process.exit(0);
}
const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/openapi?schema=public`;
const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
if (!response.ok) fail('Official metadata capture unconfirmed');
const raw = await response.text();
let document;
try { document = JSON.parse(raw); }
catch {
  const file = `${privateRoot}/FVI-CORE-GROUP1-F52-MALFORMED-OPENAPI-${Date.now()}.txt`;
  await writeFile(file, raw, { flag: 'wx', mode: 0o600 });
  fail('Official OpenAPI body was malformed; saved privately, use exact typed catalog capture');
}
const after = await identity();
if (!document.paths || JSON.stringify(before) !== JSON.stringify(after)) fail('Metadata identity drift');
const at = new Date().toISOString(), tag = Date.now(), file = `${privateRoot}/FVI-CORE-GROUP1-F52-METADATA-${tag}.json`;
const envelope = { at, environment: 'PROD', ref, schema: 'public', deployment_id: 'f52df692-7c26-40b4-bce0-989526f875b1', ledger: 455, latest: '20261004082000', source: 'official read-only Management API OpenAPI; not business authorization proof', endpoint, readOnly: true, documentSha256: sha(raw), documentRawText: raw, document, identityBefore: before, identityAfter: after, businessReadsOrWrites: 0, privilegedCredentialsIncluded: false };
const bytes = JSON.stringify(envelope, null, 2);
await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
const bindingFile = `${privateRoot}/FVI-CORE-GROUP1-F52-BINDINGS-${tag}.json`;
await writeFile(bindingFile, JSON.stringify({ at, deployment_id: envelope.deployment_id, ledger_count: 455, latest_migration: envelope.latest, artifact, operations, served,
  current_schema_capture: { path: file, sha256: sha(bytes), source: 'official_readonly_management_openapi', max_age_ms: 1800000 }, parent_owned_qa_ack: false, hosted_business_writes: 0 }, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ bindingFile, metadataFile: file, sixOperationsVerified: Object.keys(operations).length === 6, currentHostedAssets: served.length, schema: 455, businessWrites: 0 }));
