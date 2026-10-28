// Final parallel qualification return only; parent retains packet assembly.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const read=p=>fs.readFileSync(p,'utf8');const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const report=JSON.parse(read(path.join(out,'catalog-contract-qualification.json')));
const native=JSON.parse(read(path.join(out,'catalog-differences-native-receipt.json')));
if(native.status!=='ACTUAL_CATALOG_DIFFERENCE_PROBES_PASS'||!native.stopped||native.accepted69Repeated||native.assembled||native.cases.length!==27)throw new Error('Changed-contract proof incomplete');
const delta=read(path.join(out,'catalog-contract-corrections.inc.sql'));
if(sha(delta)!==report.correctionSha256)throw new Error('Correction changed after qualification');
const verified=[];
for(const b of report.base){
 const bytes=fs.readFileSync(b.file);if(sha(bytes)!==b.sha256)throw new Error('Capture bytes changed');
 const c=JSON.parse(bytes.toString()).catalog;
 for(const h of c.helpers)if(sha(h.source)!==h.source_sha256)throw new Error('Captured helper digest differs '+b.environment+'/'+h.name);
 verified.push({environment:b.environment,helperDigestsVerified:c.helpers.length,relationCount:c.relations.length});
}
const assembled=path.join(out,'20261004080000-mapped-recon-governance.forward.sql');
const parentPacket=fs.existsSync(assembled)?{path:assembled,sha256:sha(fs.readFileSync(assembled))}:null;
const files=['catalog-contract-corrections.inc.sql','parent-assembler-crlf-correction.txt','catalog-contract-qualification.json','catalog-differences-native.sql','catalog-differences-native.log','catalog-differences-native-receipt.json','attempt1-catalog-differences-native.sql','attempt1-catalog-differences-native.log','attempt1-catalog-differences-native-receipt.json'].map(name=>({path:'output/mapped-recon-governance-20261004/'+name,sha256:sha(fs.readFileSync(path.join(out,name)))}));
report.status='ACTUAL_CONSUMED_CONTRACT_QUALIFICATION_READY_WITH_NATIVE_TESTED_PARENT_DELTAS';report.nativeProbePending=false;report.native={cases:27,status:native.status,receiptSha256:sha(read(path.join(out,'catalog-differences-native-receipt.json'))),stopped:true,accepted69Repeated:false,realMFA:false};report.verifiedCaptures=verified;report.parentPacketObserved=parentPacket;
fs.writeFileSync(path.join(out,'catalog-contract-qualification.json'),JSON.stringify(report,null,2)+'\n');
files.find(x=>x.path.endsWith('catalog-contract-qualification.json')).sha256=sha(read(path.join(out,'catalog-contract-qualification.json')));
fs.writeFileSync(path.join(out,'catalog-qualification-manifest.json'),JSON.stringify({status:report.status,assembled:false,parentApplyPerformed:false,accepted69Unchanged:true,base:report.base,sourceCorrectionSha256:sha(delta),nativeCases:27,files,parentPacketObserved:parentPacket},null,2)+'\n');
const markdown=[
 '# Heisenberg — actual paired consumed-catalog qualification READY',
 '',
 'Qualified both parent captures by exact file SHA and authoritative `.catalog` / parsed `rawResponseText` equivalence: PROD452 / DEV430, engine170006, latest20261004033000, actual versioncollisionNULL,43helpers/25relations each. All43 raw helper prosrc digests verified on EACH target. No business rows, setting values, token verifiers, vault contents, credentials or identities were obtained.',
 '',
 '**The parallel qualification and corrective delta are READY; the original assembled packet still requires parent integration of the corrections before actual rollback/apply.** No duplicate assembly, global build, hosted SQL or app deployment was performed.',
 '',
 'Required actual-catalog deltas:',
 '',
 '1. Current `public.tg_guard_recon_run_governance` already calls `private.recon_run_bound_approved_version`. This native helper validates approved config/hash/request/checker linkage and denies an approving checker as run actor. The proposed early-return helper now additionally calls that unchanged native binder. Existing approved-revision guard/snapshot/audit/immutable triggers remain in force. Do not replace or broaden the binder.',
 '2. Restore the FOUR public RPCs’ captured exact `search_path=public, private, extensions, pg_temp` after their replacements. Their current ownerpostgres, exact ACLpostgres/authenticated/service_role, argument names/types, results and SECURITY DEFINER contracts are preserved. No OWNER or GRANT change is proposed for parent application. Private new helper configuration remains narrow.',
 '3. Parent assembler must derive `needle` independently after EACH of its three `pg_get_functiondef` reads using a CR/LF-safe BEGIN match, then insert using that matched newline length. Gov and run bodies are actualCRLF on both targets. Owner helper is PROD LF / DEV CRLF. Raw preimages must remain byte-exact and environment-specific; EOL normalization was used only for semantic comparison, never for SQL guards.',
 '',
 'Native-tested SQL correction include (incorporate after the proposed definitions and before postcondition checks):',
 '`output/mapped-recon-governance-20261004/catalog-contract-corrections.inc.sql`',
 'SHA256 `'+sha(delta)+'`',
 '',
 'Parent assembler exact correction guidance: `output/mapped-recon-governance-20261004/parent-assembler-crlf-correction.txt`. This file describes an edit for the parent-owned assembler; child did NOT edit or run it. Parent adapter uses the top-level `.catalog` or its already-prepared assembler envelope; raw response remains authoritative.',
 '',
 'Current assurance qualification: provider `auth.uid()` / `auth.role()` / `auth.jwt()` read signed request context; proposal never sets those claims. Actual `tenant_security_settings.mfa_required` is booleanNOTNULL/defaultfalse; runtime reads the current row and requires AAL2 when enabled. Actual policy VALUES were intentionally not captured. No generic MFA helper appears in this consumed catalog; `public.csa_assurance_actor` is specific to the Assurance lab and MUST NOT be substituted for generic governance authority. Real MFA and hosted ordinary-actor workflow remain parent post-ACK proof, not these synthetic selector tests.',
 '',
 'Authority qualification: same current ResourceAccess evaluator governs current edit/approve/run/read; active requester and independent active same-tenant admin checker are rechecked. Current evaluator includes retired read compatibility and bounded platform-support READ grants; child does not replace it or turn those grants into write/approve permission. All referenced table columns and current helper identities are present. Current grant user/group principals and active ancestor-assignment logic match the proposal. Generated/identity/ACL metadata is retained in parent guards.',
 '',
 '**27 distinct changed-contract native probes PASS**, with the accepted69 cases preserved and never replayed:',
 '',...native.cases.map(c=>'- '+c),
 '',
 'The probes installed actual captured function definitions with exact CRLF in the retained own small PG17.11 fixture. Native dispatch source suffixes remained byte-exact for both environments. Four RPC owner/ACL/configuration checks match actual capture contracts. The actual identifier/retirement/resource-attribution/audit-chain/approved-revision guards operated together through a new mapped stage → independent promotion → bound rerun.',
 '',
 'Important creator contract: stage `created_by` remains the persisted legitimate maker; unchanged native `created_by_actor_id` identifies the actual independent checker who performed the insert. Current updating checker attribution and native audit-chain tenant/actor hashes are preserved. No JWT impersonation or attribution workaround was introduced.',
 '',
 'One changed-probe generator attempt had an invalid dollar delimiter in its NEW correction include due to JavaScript replacement-string escaping. It failed before the correction executed. This was repaired with a replacement callback; native-tested current include is the SHA above. Twelve completed EOL probes were retained, and execution resumed only from the failed correction step. Original attempted SQL/log/receipt remain as `attempt1-catalog-differences-native.*`. No failed attempt is hidden and no accepted69 suite was restarted.',
 '',
 'Native fixture is STOPPED; no Docker jobs/restarts/cleanup. Shared maintenance, owner records, global routes/types/compiler/builds, frozen8 API/GTM files and Curie integration remain untouched by this parallel lane.',
 '',
 'Current parent packet observed (read-only): '+(parentPacket?'`'+parentPacket.path+'`, SHA`'+parentPacket.sha256+'`':'not located at the known canonical output path')+'. No child assembly/replacement occurred. Parent-reported original packetSHA3d13f58671c135099af2e9964349650f6377489a16891ea82ef0395b8124f8d7 / implementationf4ba8e5 remain historical pre-correction evidence.',
 '',
 'Parent next: integrate the narrow correction include and per-function EOL-safe dispatch, regenerate/review its own immutable guarded packet, verify exact owner/ACL/config postconditions, then actualPG17.6 rollback/apply. Fresh current ACK precedes real owned MFA workflow/run/results/history proof. This return is not a hosted completion or an apply receipt.',
 '',
 'Evidence/file list:',
 '',...files.map(f=>'- `'+f.path+'` SHA`'+f.sha256+'`'),
 '- `output/mapped-recon-governance-20261004/current-consumed-preimages/` (separate PROD and DEV exact definitions for15 consumed functions)',
 '- `output/mapped-recon-governance-20261004/catalog-qualification-manifest.json`',
 '- `scripts/qa/mapped-recon-governance-catalog-qualification-20261004.mjs`',
 '- `scripts/qa/mapped-recon-governance-catalog-native-probes-20261004.mjs`',
 '- `scripts/qa/mapped-recon-governance-catalog-return-20261004.mjs`',
 '- `tests/sql/mapped-recon-governance-catalog-differences-20261004.sql`',
 ];
fs.writeFileSync(path.join(out,'CATALOG-QUALIFICATION-RETURN.md'),markdown.join('\n')+'\n');
console.log(JSON.stringify({status:report.status,accepted69Repeated:false,newNativeCases:27,rawHelperDigestsVerified:86,captures:2,correctionSha256:sha(delta),parentPacketObserved:parentPacket,stopped:true,assembled:false}));
