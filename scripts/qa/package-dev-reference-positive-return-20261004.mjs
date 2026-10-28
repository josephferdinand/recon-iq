// Filesystem-only qualification. Never imports the live setup/auth/revocation drivers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const stage = path.join(root, 'scripts/qa/output/reference-metadata-contract-20261003');
const setupDir = path.join(stage, 'dev-positive-setup-2026-10-03T23-14-30-557Z');
const liveDir = path.join(stage, 'dev-positive-live-2026-10-03T23-20-37-683Z');
const oldDir = path.join(stage, 'LIVE_RETURN_2026-10-03T22-24-52-407Z');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const setup = await read(path.join(setupDir, 'RESULT.json'));
const live = await read(path.join(liveDir, 'RESULT.json'));
const old = await read(path.join(oldDir, 'QUALIFIED_LIVE_RESULT.json'));
const requireProof = (yes, label) => { if (!yes) throw Error(label); };
requireProof(setup.status === 'DEV_NEW_SYNTHETIC_REFERENCE_INDEPENDENT_APPROVAL_READY_UI' && !setup.error && setup.checks.every(c => c.pass), 'Setup incomplete');
requireProof(live.status === 'ACTUAL_DEV_POSITIVE_ORDINARY_REFERENCE_GRANT_REVOKE_RECOVER_PASS' && !live.error && !live.restorationError && live.checks.length === 29 && live.checks.every(c => c.pass), 'Live proof incomplete');
requireProof(live.businessMutations.length === 2 && live.businessMutations.every(m => m.http === 200 && m.actor === live.actors.checker), 'Exact owned revoke/restore receipts missing');
requireProof(live.actors.allRealAAL2 && live.actors.maker !== live.actors.checker && live.actors.viewer !== live.actors.checker && live.fixture.table === setup.table && live.fixture.version === setup.version, 'Actor/fixture mismatch');
requireProof(old.PROD.ordinarySQLChecks === 37 && old.PROD.qualifiedBrowserWorkflowChecks === 32 && old.PROD.checks.every(c => c.pass), 'Frozen PROD proof mismatch');
const legacyManifest = await read(path.join(oldDir, 'EVIDENCE_HASHES.json'));
for (const item of legacyManifest) {
  const bytes = await fs.readFile(path.resolve(oldDir, item.file));
  requireProof(sha(bytes) === item.sha256 && bytes.length === item.bytes, 'Prior frozen evidence drift: ' + item.file);
}
const at = new Date().toISOString();
const out = path.join(stage, 'DEV_POSITIVE_RETURN_' + at.replace(/[:.]/g, '-'));
await fs.mkdir(out); // New immutable packet; never overwrite an earlier return.
const relative = file => path.relative(out, file).replaceAll('\\', '/');
const result = {
  at, agent: 'Volta — DEV Reference positive ordinary-view acceptance',
  status: 'BOUNDED_DEV_REFERENCE_POSITIVE_GRANT_REVOKE_RECOVERY_ACCEPTANCE_COMPLETE',
  capturedLiveAt: live.at, recoveredCompletedHandleWithoutWorkflowReplay: true,
  parentReleaseReceipt: relative(path.join(root, 'docs/evidence/FVI_HOME_REFERENCE_REPORTS_RELEASE_2026-10-04_RECEIPT.json')),
  deployments: old.deployments,
  DEV: { setupEntries: setup.checks.length, distinctSetupChecks: new Set(setup.checks.map(c => c.label)).size,
    liveChecks: live.checks.length, failedChecks: 0, realProviderAAL2: true,
    actors: live.actors, fixture: { ...live.fixture, publicId: 'FVI-REF-D74F45272E358C428FE7', registry: setup.saveReceipt.registry_id },
    createAudit: Number(setup.saveReceipt.audit_id), membershipApprovalAudit: 30657,
    referenceVersionIndependentApproval: setup.checks.find(c => c.label === 'actual published NEW version has distinct real maker/checker').detail,
    effectiveRights: setup.checks.find(c => c.label === 'actual proposed group effect is ONLY exact new Reference view').detail.rights,
    globalGroupRoles: [], writerAndAdminActionsDenied: ['ingest', 'edit', 'approve', 'manage'],
    ownedGrantCycle: live.businessMutations,
    finalState: 'Exact NEW fixture BU and view group restored; current ordinary viewer can read the published synthetic row.',
    oldRecordPreservation: live.checks.filter(c => c.label.startsWith('every old DEV ')).map(c => ({ check: c.label, ...c.detail, pass: c.pass })),
    setupEvidence: relative(path.join(setupDir, 'RESULT.json')), liveEvidence: relative(path.join(liveDir, 'RESULT.json')),
    priorDenialAndEscapeEvidence: relative(path.join(stage, 'dev-empty-2026-10-03T22-15-42-424Z/RESULT.json')) },
  PROD: { frozenSQLChecks: 37, frozenUIChecks: 32, unchangedPriorEvidenceFilesVerified: legacyManifest.length,
    priorReturn: relative(path.join(oldDir, 'QUALIFIED_LIVE_RESULT.json')), repeatedSave: 0, repeatedDataPrepRun: 0,
    originalEntity: old.PROD.knownEntity, originalCreateAudit: 29548,
    preservationEvidenceTier: 'Retained prior qualified evidence; this DEV-only acceptance did not repeat PROD workflows.' },
  diagnostics: ['Preserved first setup HTTP400/PGRST204 assigned_by mismatch; QA driver corrected to actual created_by. Saved entities/keys recovered without duplicate creation.',
    'Two setup checks have repeated journal entries after recovery; 16 recorded entries represent 14 distinct setup checks.',
    'Execution handle became stale after live completion. Saved PASS, restoration receipts and browser captures recovered; no additional revoke/restore cycle.'],
  boundaries: { appRuntimeSourceChanged: false, compilerBuildSQLApplyDeploy: false, ownerCredentialRoleReset: false,
    credentialsPrinted: false, dockerActions: false, cleanupOrHistoryDeletion: false,
    priorReturnsOverwritten: false, allItems1to12OrOwnerAcceptanceClaimed: false, parentGoal: 'ACTIVE_INCOMPLETE',
    communication: 'ClaudeLink read_inbox/send tools unavailable; no inbox or message delivery success claimed.' }
};
await fs.writeFile(path.join(out, 'QUALIFIED_DEV_POSITIVE_RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
const markdown = `Volta — DEV Reference positive ordinary-view acceptance, 4 October 2026\n\nThe unfinished DEV positive view gate is COMPLETE on the actual deployed DEV app ce449c37-d9cd-4a7a-8d5f-032c881f4e95, schema429/latest20261003180000. Live evidence captured ${live.at}; this packet packages that completed result without repeating the workflow. Parent paired deployment receipt remains authoritative. This is bounded Reference acceptance, not all items1–12 completion or owner acceptance.\n\nEvidence: 29 live checks passed; 16 setup journal entries contain 14 distinct passed checks. Existing DEV denial and nested-picker Escape/focus/input-preservation checks remain passed and were not repeated. PROD37 SQL +32 qualified UI checks remain frozen; every ${legacyManifest.length} file in the earlier live manifest hash-verified unchanged. Original 35 source/27 hosted checks remain retained.\n\nNew fixture: table ${setup.table}, public ID FVI-REF-D74F45272E358C428FE7, registry ${setup.saveReceipt.registry_id}; BU ${setup.bu}, group ${setup.group}, workspace ${setup.workspace}. One atomic DEV Save produced create audit30652 and one synthetic published row in version ${setup.version}. This is explicitly synthetic QA data. Original PROD entity/audit29548 and DataPrep outputs/runs were not repeated or mutated.\n\nReal provider MFA/AAL2 and current roles validated: maker ${live.actors.maker} and independent checker ${live.actors.checker} are tenant admins; saved NEW viewer ${live.actors.viewer} remains tenant_viewer. Maker self-approval returned403/42501. Checker independently published the Reference version and approved viewer membership request ${setup.membership} (audit30657). Group roles are empty; the proposed/effective resource right is ONLY data_resource:${setup.saveReceipt.registry_id}:view. BU membership is bu_viewer without descendant inheritance; workspace role is viewer. No blanket reference.read/admin/global grants were assigned.\n\nActual ordinary browser Home → Ingestion → Reference → View rendered the exact public ID, current BU/group metadata and published synthetic row. Create stayed disabled; staging/submission/approval/rejection/rollback controls were absent. API ingest/edit/approve/manage and admin scope selection stayed denied. Current purpose metadata is a view contract, not permission to create BU/groups or use admin screens.\n\nChecker removed only the NEW owned fixture's view group (HTTP200). Root, purpose metadata and published rows immediately denied the viewer; a fresh actual browser list exposed no fixture. Checker restored the exact original NEW BU/group set (HTTP200), then ordinary browser navigation and the published row recovered. Final fixture scope is restored. Full old-record projections across eight DEV tables passed preservation checks (tenant memberships, BUs, groups, BU/group assignments, BU/user assignments, workspaces, workspace members and Reference roots). One exact create audit30652 confirmed no duplicate fixture.\n\nThe initial QA setup failure HTTP400/PGRST204 used assigned_by rather than actual created_by; only the driver changed. The failed result is retained. Completed entity IDs and request keys were recovered rather than recreated. Later live execution handle loss was resolved from saved terminal/result/captures; the successful grant cycle was not replayed.\n\nPublic receipts and actual PNG/ARIA captures are linked by relative paths in QUALIFIED_DEV_POSITIVE_RESULT.json and EVIDENCE_HASHES.json. Private sessions/MFA credentials and raw private API receipts remain in the existing protected QA lane; none are copied into this packet. Original historical returns retain their earlier DEV OPEN wording and are superseded only for this positive gate by this new packet.\n\nNo application runtime patch was needed during this DEV acceptance. No global compiler/build, SQL apply, upload/deployment, credential rotation/reset, owner-role change, cleanup or Docker action was performed. Parent goal remains ACTIVE/incomplete for other work. ClaudeLink tools are unavailable, so no inbox/send success is claimed.\n`;
await fs.writeFile(path.join(out, 'DEV_POSITIVE_RETURN_2026-10-04.md'), markdown, { flag: 'wx' });
const files = [path.join(out, 'QUALIFIED_DEV_POSITIVE_RESULT.json'), path.join(out, 'DEV_POSITIVE_RETURN_2026-10-04.md'),
  path.join(setupDir, 'RESULT.json'), path.join(stage, 'dev-positive-setup-2026-10-03T23-11-51-750Z/RESULT.json'),
  path.join(oldDir, 'QUALIFIED_LIVE_RESULT.json'), path.join(oldDir, 'EVIDENCE_HASHES.json'),
  path.join(stage, 'dev-empty-2026-10-03T22-15-42-424Z/RESULT.json'),
  path.join(root, 'docs/evidence/FVI_HOME_REFERENCE_REPORTS_RELEASE_2026-10-04_RECEIPT.json'),
  ...['dev-reference-positive-context-20261004.mjs', 'dev-reference-positive-setup-20261004.mjs',
    'dev-reference-positive-live-20261004.mjs', 'package-dev-reference-positive-return-20261004.mjs'].map(f => path.join(root, 'scripts/qa', f))];
for (const file of await fs.readdir(liveDir)) files.push(path.join(liveDir, file));
const hashes = [];
for (const file of files) {
  const bytes = await fs.readFile(file);
  // Scan generated public evidence, not QA source references to private field names.
  if (!file.endsWith('.mjs') && !file.endsWith('.png')) {
    const text = bytes.toString('utf8');
    requireProof(!/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]+|\"(?:access_token|refresh_token|password|totp_secret)\"\s*:/.test(text), 'Possible secret in public evidence: ' + relative(file));
  }
  hashes.push({ file: relative(file), bytes: bytes.length, sha256: sha(bytes) });
}
await fs.writeFile(path.join(out, 'EVIDENCE_HASHES.json'), JSON.stringify(hashes, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, out, liveChecks: 29, distinctSetupChecks: result.DEV.distinctSetupChecks,
  frozenFilesVerified: legacyManifest.length, hashedFiles: hashes.length, networkCalls: 0, businessOperationsReplayed: 0 }));
