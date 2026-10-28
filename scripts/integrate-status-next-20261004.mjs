import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
const destination = resolve('./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930');
const candidate = './LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const sha = value => createHash('sha256').update(value).digest('hex');
const groups = [
  { base: candidate, manifest: `${candidate}/newoutput/status-ui-20261004-NEXT/manifest.json`, entries: 'source_entries' },
  { base: 'docs/evidence', manifest: 'docs/evidence/status-next-20261004/MANIFEST.json', entries: 'source_files' },
];
const prepared = [];
for (const group of groups) {
  const manifest = JSON.parse(await readFile(group.manifest, 'utf8'));
  for (const entry of manifest[group.entries]) {
    const relative = entry.path ?? entry.file;
    const target = resolve(destination, relative);
    if (!target.startsWith(destination + '\\')) throw new Error('Integration path escaped bounded packet');
    const bytes = await readFile(resolve(group.base, entry.postimage));
    if (sha(bytes) !== entry.sha256) throw new Error('Frozen status postimage drift: ' + relative);
    let before = null;
    try { before = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const beforeSha = before === null ? null : sha(before);
    if (beforeSha !== entry.sha256 && beforeSha !== (entry.preimage_sha256 ?? null)) throw new Error('Status preimage conflict: ' + relative);
    prepared.push({ relative, target, bytes, before, beforeSha, afterSha: entry.sha256 });
  }
}
const audit = resolve(destination, `audit/status-next-intake-${Date.now()}`);
await mkdir(audit, { recursive: true });
for (const entry of prepared) {
  if (entry.before !== null) {
    const backup = resolve(audit, 'preimages', entry.relative);
    await mkdir(dirname(backup), { recursive: true });
    await writeFile(backup, entry.before, { flag: 'wx' });
  }
  if (entry.beforeSha !== entry.afterSha) {
    await mkdir(dirname(entry.target), { recursive: true });
    await writeFile(entry.target, entry.bytes);
  }
  if (sha(await readFile(entry.target)) !== entry.afterSha) throw new Error('Status postimage readback differs');
}
const receipt = { at: new Date().toISOString(), destination, files: prepared.map(({ relative, beforeSha, afterSha }) => ({ relative, beforeSha, afterSha })), sourceIntegrated: true, deployed: false };
await writeFile(resolve(audit, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ sourceIntegrated: true, count: prepared.length, receipt: resolve(audit, 'receipt.json') }));
