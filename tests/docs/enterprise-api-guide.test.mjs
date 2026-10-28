import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, CANDIDATE, GUIDE, json, ref, operations, routeInventory, tokenScopes, sourceFunction, observe, hash } from '../../docs/enterprise-api-guide/build-reference.mjs';
const require = createRequire(path.join(ROOT, 'package.json')), Ajv = require('ajv');
const registry = json(path.join(GUIDE, 'coverage-registry.json'));
const specs = Object.fromEntries(['canonical', 'candidate'].map(k => [k, json(path.join(GUIDE, `openapi-${k}-source.json`))]));
const rootFor = label => label === 'canonical' ? ROOT : CANDIDATE;
const walk = dir => fs.readdirSync(dir).flatMap(n => { const p = path.join(dir, n); return fs.statSync(p).isDirectory() ? walk(p) : [p]; });
function validator(spec, schema) { return new Ajv({ allErrors: true, schemaId: 'auto', strictKeywords: false, logger: false }).compile({ components: spec.components, ...schema }); }

for (const label of ['canonical', 'candidate']) {
  test(`${label}: every API route/HTTP method has supported contract or explicit supplemental disposition`, () => {
    const inventory = routeInventory(rootFor(label)), saved = registry.roots[label]; assert.deepEqual(inventory, saved.inventory);
    assert.equal(operations(specs[label]).length, label === 'canonical' ? 70 : 71);
    for (const r of inventory) for (const h of r.handlers.filter(h => h.method !== 'OPTIONS')) assert.ok(saved.operations.some(e => e.method === h.method && (e.path === r.path || r.path.endsWith('/$') && e.path.startsWith(r.path.slice(0, -1)))) || saved.source_only_outside_client_contract.some(e => e.path === r.path && e.handlers[0].method === h.method), h.method + ' ' + r.path);
  });
  test(`${label}: exact route/handler hashes, methods, path parameters and supported finite scopes`, () => {
    const spec = specs[label], scopes = tokenScopes(rootFor(label)).map(s => s.id), ids = new Set();
    for (const e of operations(spec)) {
      assert.ok(!ids.has(e.op.operationId)); ids.add(e.op.operationId);
      assert.equal(hash(fs.readFileSync(path.join(rootFor(label), e.op['x-source-file']))), e.op['x-source-sha256']);
      const saved = registry.roots[label].operations.find(r => r.operation_id === e.op.operationId);
      assert.equal(hash(fs.readFileSync(path.join(rootFor(label), saved.route_file))), saved.route_sha256);
      for (const p of [...e.path.matchAll(/\{([^}]+)\}/g)].map(m => m[1])) assert.ok(e.parameters.map(p => ref(spec,p)).some(x => x.name === p && x.in === 'path' && x.required), p);
      if (e.op['x-required-scope']) for(const scope of Array.isArray(e.op['x-required-scope'])?e.op['x-required-scope']:[e.op['x-required-scope']])assert.ok(scopes.includes(scope));
      assert.ok(e.op['x-availability'].includes('NOT qualified'));
    }
  });
  test(`${label}: all local OpenAPI references and response descriptions resolve; no fictitious UAT server`, () => {
    const spec = specs[label]; const visit = v => { if (!v || typeof v !== 'object') return; if (v.$ref) assert.ok(ref(spec,v)); Object.values(v).forEach(visit); }; visit(spec);
    assert.deepEqual(spec.servers.map(s=>s.url), ['https://app.reconiq.example', 'https://dev.app.reconiq.example']); assert.equal(spec['x-uat'].url, null);
    for (const e of operations(spec)) for(const r of Object.values(e.op.responses)) { assert.equal(typeof r.description, 'string'); assert.ok(r.description.length); assert.equal(Object.hasOwn(r,'dependency/audit failure or malformed response'),false); }
  });
  test(`${label}: request/query/response component schemas compile with installed JSON Schema validator`, () => {
    const spec = specs[label]; let count = 0;
    for (const e of operations(spec)) {
      for (const c of Object.values(e.op.requestBody?.content ?? {})) if(c.schema) { validator(spec,c.schema); count++; }
      for (const response of Object.values(e.op.responses)) for(const c of Object.values(response.content ?? {})) if(c.schema) { validator(spec,c.schema); count++; }
      validator(spec,e.op['x-query-schema']);
    }
    assert.ok(count > 0);
  });
}
for (const example of json(path.join(GUIDE, 'contract-examples.json'))) test(`schema example: ${example.id}`, () => {
  for (const label of example.source_contracts ?? ['canonical','candidate']) {
    const spec = specs[label], entry = operations(spec).find(e=>e.path === example.path && e.method === example.method.toLowerCase()); assert.ok(entry);
    const schema = example.schema_ref ? { $ref: example.schema_ref } : example.query ? entry.op['x-query-schema'] : example.status ? entry.op.responses[example.status]?.content?.[example.media_type??'application/json']?.schema : entry.op.requestBody?.content?.[example.media_type??'application/json']?.schema;
    assert.ok(schema,example.id); const validate = validator(spec,schema); const actual = Boolean(validate(example.value)); assert.equal(actual,example.valid,`${label}/${example.id}: ${JSON.stringify(validate.errors)}`);
  }
});
test('all supported operations have one secretless HTTP example and valid request schema shape', () => {
  const examples=json(path.join(GUIDE,'http-examples.json')), spec=specs.candidate; assert.equal(examples.length,71);
  for(const e of operations(spec)) {
    const x=examples.find(x=>x.operation_id===e.op.operationId);assert.ok(x);assert.equal(x.method,e.method.toUpperCase());assert.equal(x.path_template,e.path);
    for(const v of Object.values(x.headers)) if(String(v).startsWith('Bearer'))assert.match(v,/^Bearer <[A-Z_]+>$/);
    if(x.body!==undefined) {const v=validator(spec,e.op.requestBody.content[x.media_type].schema);assert.ok(v(x.body),`${e.op.operationId}: ${JSON.stringify(v.errors)}`);}
  }
});
test('new finite allowlist is exactly22 current scopes with no wildcard or historical rewrite claim', () => {
  const saved=json(path.join(GUIDE,'finite-token-scopes.json'));assert.equal(saved.scopes.length,22);assert.equal(new Set(saved.scopes.map(s=>s.id)).size,22);assert.equal(saved.wildcard_newly_issuable,false);
  assert.deepEqual(saved.scopes,tokenScopes(ROOT));assert.deepEqual(saved.scopes,tokenScopes(CANDIDATE));
});
test('literal endpoint requiredScope checks match the documented finite permissions in both roots', () => {
  for(const label of ['canonical','candidate']) for(const e of operations(specs[label]).filter(e=>e.path.startsWith('/api/v1/'))) {
    const body=sourceFunction(rootFor(label),e.op['x-source-file'],e.op['x-source-handler']).text;
    const scopes=[...new Set([...body.matchAll(/requiredScope:\s*["']([^"']+)["']/g)].map(m=>m[1]))];
    if(scopes.length===1)assert.equal(e.op['x-required-scope'],scopes[0],e.op.operationId);
  }
});
test('current actual document receipts prove66 operations and exact source byte parity, not authenticated acceptance', () => {
  const observations=json(path.join(GUIDE,'observations/served-documents-2026-10-04.json'));
  for(const o of observations){assert.equal(o.http,200);assert.equal(o.version,'1.0.0');assert.equal(o.operations.length,66);assert.equal(o.business_requests,0);assert.equal(o.authenticated_acceptance,false);assert.equal(o.body_sha256,hash(fs.readFileSync(path.join(GUIDE,`observations/${o.environment.toLowerCase()}-served.openapi.yaml`))));assert.equal(o.body_sha256,hash(fs.readFileSync(path.join(ROOT,'docs/openapi/fvi-openapi.yaml'))));}
});
test('completed public document observation cannot be replayed or overwritten', async () => {
  const before=hash(fs.readFileSync(path.join(GUIDE,'observations/served-documents-2026-10-04.json'))),saved=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('network_forbidden_in_doc_check');};
  try{await assert.rejects(observe(),/completed_document_observation_exists/);assert.equal(calls,0);assert.equal(hash(fs.readFileSync(path.join(GUIDE,'observations/served-documents-2026-10-04.json'))),before);}finally{globalThis.fetch=saved;}
});
test('actual paired application/schema identities and DEV binding receipt stay isolated; UAT absent', () => {
  const e=json(path.join(GUIDE,'environment-bindings.json'));assert.equal(e.PROD.ledger,452);assert.equal(e.DEV.ledger,430);assert.equal(e.PROD.latest,'20261004033000');assert.equal(e.DEV.latest,e.PROD.latest);
  assert.equal(e.PROD.deployment_id,'7180321a-e9c5-4014-bd9b-a3f1c52e392b');assert.equal(e.DEV.deployment_id,'ce449c37-d9cd-4a7a-8d5f-032c881f4e95');assert.equal(e.UAT.app_origin,null);assert.equal(e.UAT.supabase_origin,null);
  for(const f of e.receipt_sources)assert.equal(hash(fs.readFileSync(path.join(ROOT,f.file))),f.sha256);
});
test('candidate/canonical break pagination and candidate-only matches are explicit source differences', () => {
  const p='/api/v1/{tenantSlug}/recons/{reconId}/breaks/';assert.equal(specs.canonical.paths[p].get['x-pagination-contract'].kind,'timestamp_cursor');assert.equal(specs.candidate.paths[p].get['x-pagination-contract'].kind,'tuple_cursor');
  assert.equal(specs.canonical.paths['/api/v1/{tenantSlug}/recons/{reconId}/matches/'],undefined);assert.ok(specs.candidate.paths['/api/v1/{tenantSlug}/recons/{reconId}/matches/']);
});
test('supplemental worker/provider/public-intake operations have exact source/auth/query/error traces and no privileged examples', () => {
  const supplemental=json(path.join(GUIDE,'supplemental-contracts.json'));
  for(const label of ['canonical','candidate']) {
    const wanted=registry.roots[label].source_only_outside_client_contract,actual=supplemental.operations.filter(e=>e.root===label);assert.equal(actual.length,wanted.length);
    for(const e of actual){assert.equal(hash(fs.readFileSync(path.join(rootFor(label),e.source_file))),e.sha256);assert.equal(e.runtime_auth_and_provider_acceptance,false);assert.equal(typeof e.idempotency_header_handled_in_source,'boolean');assert.ok(Array.isArray(e.literal_query_names));}
  }
});
test('source-required environment manifest/watcher types and purpose AI bounds reject older weak examples', () => {
  const spec=specs.candidate;
  const env=validator(spec,{$ref:'#/components/schemas/EnvironmentChangeCreate'});assert.equal(env({direction:'dev_to_prod',source_tenant_id:'10000000-0000-4000-8000-000000000001',target_tenant_id:'10000000-0000-4000-8000-000000000002',title:'Example',reason:'Example valid reason'}),false);
  const watcher=validator(spec,{$ref:'#/components/schemas/WatcherInput'});assert.equal(watcher({data_source_id:'10000000-0000-4000-8000-000000000001',name:'Example watcher',watch_type:'invented'}),false);
  assert.equal(spec.components.schemas.WatcherInput.properties.watch_type.enum.length,11);assert.equal(spec.components.schemas.OpaqueInferenceRequest.properties.max_tokens.maximum,4096);
});
test('Data Prep PATCH docs match source stripping before non-empty refinement', () => {
  for(const label of ['canonical','candidate']) {
    const text=fs.readFileSync(path.join(rootFor(label),'src/lib/public-data-prep-api.server.ts'),'utf8');
    assert.match(text,/createBody\.partial\(\)\.refine\(\(value\) => Object\.keys\(value\)\.length > 0/);
    const schema=specs[label].components.schemas.DataPrepPipelinePatch,v=validator(specs[label],schema);
    assert.equal(v({}),false);assert.equal(v({unsupported_field:'not an update'}),false);
    assert.equal(v({name:'Reviewed QA name',unsupported_field:'ignored'}),true);
    assert.deepEqual(schema.anyOf.map(s=>s.required[0]).sort(),Object.keys(schema.properties).sort());
  }
});
test('every local Markdown link resolves within the guide or verified source; no procedures/screenshots/nav edits', () => {
  const all=walk(GUIDE).filter(f=>f.endsWith('.md')&&!f.split(path.sep).includes('preimages'));
  for(const file of all)for(const m of fs.readFileSync(file,'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){const target=m[1];if(/^https?:|^#/.test(target))continue;assert.ok(fs.existsSync(path.resolve(path.dirname(file),target.split('#')[0])),`${path.basename(file)} -> ${target}`);}
  assert.match(fs.readFileSync(path.join(GUIDE,'OWNERSHIP.md'),'utf8'),/Leibniz/);
});
test('guide examples/artifacts do not contain bearer secrets/JWTs/provider-key values or invented UAT endpoints', () => {
  for(const file of walk(GUIDE).filter(f=>/\.(md|json)$/.test(f)&&!f.includes(path.sep+'packet'+path.sep)&&!f.split(path.sep).includes('preimages'))) {
    const text=fs.readFileSync(file,'utf8');assert.doesNotMatch(text,/Bearer\s+eyJ[A-Za-z0-9_-]+\.|sb_secret_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{20,}|https:\/\/uat\.app\.falconveritas\.com/);
  }
});
