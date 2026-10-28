import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = './LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const refreshFile = process.argv[2];
if (!refreshFile || path.dirname(path.resolve(refreshFile)) !== path.resolve(root)) throw new Error('Private refresh receipt required');
const refreshed = JSON.parse(await readFile(refreshFile, 'utf8'));
const proposal = JSON.parse(await readFile('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/output/godel-benchmark-driver-20261003/bindings-7180321a/promotion-submit-readback-proposal-20261004.json', 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const journalBytes = await readFile(proposal.journal_file);
if (sha(journalBytes) !== proposal.journal_sha256) throw new Error('Saved unknown intent journal changed');
const config = JSON.parse(await readFile(`${root}/FVI-QA-TRANSPORT-PROD-20261001.json`, 'utf8'));
const results = [];
for (const kind of ['maker','checker']) {
  const actor = refreshed.actors.find(item => item.label === `platform-${kind}`);
  if (!actor?.provider_subject_verified || actor.aal !== 'aal2' || !actor.current_active_tenant_admin || actor.expires_at < Date.now()/1000+300) throw new Error('Fresh ordinary QA authority required');
  const saved = JSON.parse(await readFile(actor.session_file, 'utf8'));
  if (saved.user_id !== actor.user_id || saved.tenant_id !== proposal.unresolved.tenant_id) throw new Error('Private actor binding changed');
  for (const item of proposal.queries) {
    const url = new URL(item.url);
    if (item.method !== 'GET' || url.origin !== config.apiUrl || url.searchParams.get('tenant_id') !== `eq.${proposal.unresolved.tenant_id}`) throw new Error('Readback target escaped owned scope');
    const response = await fetch(url, { headers: { apikey: config.anonKey, authorization: `Bearer ${saved.session.access_token}`, 'Accept-Profile': 'public' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000) });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body) || body.length >= item.max_rows) throw new Error(`Ordinary bounded readback unconfirmed:${kind}:${item.table}:${response.status}`);
    results.push({ actor: kind, table: item.table, http: response.status, rows: body });
  }
}
const emptyRequestsBoth = results.filter(item => item.table === 'recon_definition_governance_requests').every(item => item.rows.length === 0);
const receipt = `${root}/FVI-CORE-GROUP1-PENDING-PROMOTION-READBACK-${Date.now()}.json`;
await writeFile(receipt, JSON.stringify({ at: new Date().toISOString(), ordinaryCaller: true, businessWrites: 0, journalModified: false, journalSha256: sha(journalBytes), pending: proposal.unresolved, results, emptyRequestsBoth, disposition: 'Actual readback only; absence cannot establish rejection or authorize replay' }, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ receipt, businessWrites: 0, reads: results.length, counts: results.map(item => ({ actor: item.actor, table: item.table, rows: item.rows.length })), unknownIntentPreserved: true }));
