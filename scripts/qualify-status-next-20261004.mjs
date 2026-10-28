import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const environment = process.argv[2];
const targets = { PROD: { ref: 'YOUR_PROJECT_REF', ledger: 455, latest: '20261004082000' }, DEV: { ref: 'YOUR_PROJECT_REF', ledger: 431, latest: '20261004080000' } };
const target = targets[environment];
if (!target) throw new Error('Explicit PROD or DEV target required');
const root = 'docs/evidence/status-next-20261004';
const mutations = await readFile(`${root}/reviewed-mutations.sql`, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
if (sha(mutations) !== '15e3ad7e1624f9863f7c805345280ba8dd9b6387e1c1e7bf2458a99facf06f79') throw new Error('Reviewed mutation source changed');
let sql = await readFile(`${root}/strict-${environment}-${target.ledger}-rollback.sql`, 'utf8');
const frozenSql = sql;
if (!/\bBEGIN;/.test(sql) || !/ROLLBACK;\s*$/.test(sql) || /\bCOMMIT\s*;/i.test(sql)) throw new Error('Only reviewed rollback packet accepted');
sql = sql.replace('BEGIN;', "BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';LOCK TABLE public.status_components,public.status_component_history,public.status_incidents IN SHARE MODE;");
sql = sql.replace(/ROLLBACK;\s*$/, 'SELECT true AS status_next_checks_passed;ROLLBACK;\n');
const prefix = `./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-STATUS-NEXT-${environment}-QUALIFICATION-${Date.now()}`;
const vault = await readFile('./.private/CREDENTIALS.md', 'utf8');
const start = vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->');
const end = vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if (start < 0 || end <= start) throw new Error('FVI credential boundary unavailable');
const token = vault.slice(start, end).split(/\r?\n/).find(line => /^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(line))?.split('|')[2]?.trim().replace(/^`|`$/g, '');
if (!/^sbp_/.test(token ?? '')) throw new Error('FVI management authority unavailable');
async function query(query, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target.ref}/database/query`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, read_only: readOnly }), signal: AbortSignal.timeout(85000) });
  const raw = await response.text();
  if (!response.ok) {
    await writeFile(`${prefix}-ERROR.json`, JSON.stringify({ at: new Date().toISOString(), http: response.status, raw }, null, 2), { flag: 'wx' });
    throw new Error(`Status rollback HTTP${response.status}; diagnosis saved privately`);
  }
  return JSON.parse(raw);
}
const identity = "SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,to_regclass('public.status_environment_registry')::text AS new_registry";
const before = await query(identity, true);
if (before[0]?.engine !== '170006' || before[0]?.ledger !== target.ledger || before[0]?.latest !== target.latest || before[0]?.new_registry !== null) throw new Error('Actual target changed; inspect before retry');
const captureStart = frozenSql.indexOf(' SELECT to_jsonb(q) INTO current_capture FROM (');
const captureEnd = frozenSql.indexOf(') q;', captureStart) + ') q;'.length;
if (captureStart < 0 || captureEnd <= captureStart) throw new Error('Frozen catalog capture boundary absent');
const captureSql = frozenSql.slice(captureStart, captureEnd).replace('INTO current_capture', 'AS current_capture');
const currentCapture = (await query(captureSql, true))[0]?.current_capture;
const expectedCatalog = frozenSql.match(/catalog_md5'<>'([a-f0-9]{32})'/)?.[1];
if (!expectedCatalog || currentCapture?.catalog_md5 !== expectedCatalog || currentCapture?.ledger !== target.ledger || currentCapture?.latest !== target.latest || currentCapture?.engine !== 170006) throw new Error('Actual catalog/ledger differs from reviewed packet');
// Refresh only mutable legacy observation hashes; catalog/source guards stay exact.
let replacements = 0;
sql = sql.replace(/IS DISTINCT FROM '([^']+)'::jsonb/g, (whole, literal) => {
  const old = JSON.parse(literal);
  const keys = Object.keys(old);
  if (keys.includes('history') && keys.includes('components') && keys.includes('incidents')) {
    replacements++;
    return `IS DISTINCT FROM '${JSON.stringify(currentCapture.preserved_data)}'::jsonb`;
  }
  return whole;
});
for (const [name, field] of [['status_components','components'],['status_component_history','history'],['status_incidents','incidents']]) {
  const marker = `FROM public.${name} x) IS DISTINCT FROM '`;
  const start = sql.indexOf(marker), end = sql.indexOf("'::jsonb", start + marker.length);
  if (start < 0 || end < start) throw new Error('Legacy preservation boundary absent');
  sql = sql.slice(0, start + marker.length) + JSON.stringify(currentCapture.preserved_data[field]) + sql.slice(end);
  replacements++;
}
if (replacements !== 4) throw new Error('Unexpected observation guard refresh scope');
await writeFile(`${prefix}-CURRENT-CAPTURE.json`, JSON.stringify(currentCapture, null, 2), { flag: 'wx' });
await writeFile(`${prefix}-ROLLBACK.sql`, sql, { flag: 'wx' });
const execution = await query(sql, false);
const after = await query(identity, true);
const rollbackVerified = execution.some(row => row.status_next_checks_passed === true) && JSON.stringify(before) === JSON.stringify(after);
await writeFile(`${prefix}-RECEIPT.json`, JSON.stringify({ at: new Date().toISOString(), environment, projectRef: target.ref, mutationSha256: sha(mutations), frozenPacketSha256: sha(frozenSql), packetSha256: sha(sql), currentCapture, before, execution, after, rollbackVerified, applied: false, hostedWorkflowAcceptance: false }, null, 2), { flag: 'wx' });
if (!rollbackVerified) throw new Error('Exact rollback postconditions unconfirmed');
console.log(JSON.stringify({ environment, rollbackVerified, ledger: after[0].ledger, receipt: `${prefix}-RECEIPT.json` }));
