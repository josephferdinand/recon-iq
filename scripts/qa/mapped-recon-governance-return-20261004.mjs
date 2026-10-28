import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.cwd(),out=path.join(root,'output/mapped-recon-governance-20261004');
const read=p=>fs.readFileSync(p,'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const qualification=JSON.parse(read(path.join(out,'qualification.json')));
const compiled=JSON.parse(read(path.join(out,'native-compiled-postimages.json')));
const source=read(path.join(out,'unqualified-implementation.sql'));
const defs=[...source.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ((?:public|private)\.[a-z_]+)\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$;/g)];
for(const m of defs){const row=compiled.find(p=>p.schema+'.'+p.name===m[1]);if(!row||row.source_sha256!==sha(m[2]))throw new Error('Final compiled body mismatch '+m[1]);}
const receipts=['native-receipt.json','native-concurrency-receipt.json','native-bounded-locks-receipt.json'].map(name=>({name,...JSON.parse(read(path.join(out,name)))}));
if(receipts.some(x=>!x.stopped||!x.status.includes('PASSED')))throw new Error('Native outcome/stop not confirmed');
const uniqueCases=[...new Set([...read(path.join(out,'native-run.log')).matchAll(/NOTICE:\s+PASS: ([^\r\n]+)/g)].map(m=>m[1]))];
const concurrency=receipts.filter(x=>x.name!=='native-receipt.json').flatMap(x=>x.cases.map(c=>c.name));
if(uniqueCases.length!==62||concurrency.length!==7)throw new Error('Native coverage count changed: '+uniqueCases.length+'+'+concurrency.length);
const privateCapture='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-RECON-PROMOTION-PROD-CATALOG-2026-10-04T02-05-18-589Z.json';
const bytes=fs.readFileSync(privateCapture);
if(sha(bytes)!=='0d6ba52892f984c32827bf0389d3d5870bdc3304fef1af0041bb0011f172d72f')throw new Error('Actual four-function capture changed');
const originals=JSON.parse(bytes.toString()).results[0].rows[0].functions;
const preimages=[];
for(const file of fs.readdirSync(path.join(out,'source-preimages'))){
 const body=read(path.join(out,'source-preimages',file));const original=originals.find(f=>f.name.endsWith(file.replace(/\.sql$/,'')));
 if(!original||body!==original.source)throw new Error('Raw source preimage differs '+file);
 preimages.push({path:'output/mapped-recon-governance-20261004/source-preimages/'+file,sha256:sha(body)});
}
const files=[];
for(const dir of ['scripts/qa','tests/sql'])for(const name of fs.readdirSync(path.join(root,dir)).filter(n=>n.startsWith('mapped-recon-governance-'))){const p=dir+'/'+name;files.push({path:p,sha256:sha(fs.readFileSync(path.join(root,p))),bytes:fs.statSync(path.join(root,p)).size});}
for(const name of fs.readdirSync(out).filter(n=>/\.(sql|json|log)$/.test(n))){if(name==='manifest.json')continue;const p='output/mapped-recon-governance-20261004/'+name;files.push({path:p,sha256:sha(fs.readFileSync(path.join(root,p))),bytes:fs.statSync(path.join(root,p)).size});}
const stats=fs.statfsSync(out);
const manifest={status:'SOURCE_NATIVE_PROPOSAL_CURRENT_CATALOG_PENDING',ready:false,createdAt:new Date().toISOString(),root,
 candidateVersion:'20261004080000',sourceVersionCollisions:fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.startsWith('20261004080000')),
 qualification,native:{engine:receipts[0].engine,semanticCases:uniqueCases,concurrencyCases:concurrency,total:69,compiledBodiesMatched:defs.length,currentSourceSha256:sha(source),stopped:true,realMFA:false,hostedProof:false},
 preimages,files,freeDiskGiB:Number((stats.bavail*stats.bsize/1024**3).toFixed(2)),
 remaining:['Parent paired fresh consumed catalog incl owners/ACL/args/columns/native guards/current assurance and version collision','Adapt only source-confirmed catalog drift and qualify exact both-target guarded proposal','Parent PG17.6 guarded rollback/apply and ACK','Owned ordinary-actor real MFA hosted initial promotion/edit/copy/promotion/rerun proof after ACK']};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const lines=[
 '# Heisenberg — mapped reconciliation governance source/native return, 4 October 2026',
 '',
 '**NOT READY FOR APPLY.** Source/native proposal prepared; exact paired current-catalog qualification is outstanding. No hosted SQL/app upload/build/Docker action or ordinary business replay was performed. This return does not close production acceptance.',
 '',
 'Current base remains parent-reported PROD452 / DEV430 / latest20261004033000. The actual PROD four-function capture SHA was reverified and all four raw prosrc preimages match byte-for-byte. Its tiny envelope does not qualify current owner/security-definer/native guard/assurance or the DEV catalog; those are not manufactured from historical source.',
 '',
 'The proposal repairs initial mapped draft promotion and the complete independent edit approval → exact mapped staging copy → scoped staging edit → promotion → corrected parent rerun path. Makers use current edit authority; independent current tenant-admin checkers use current approve authority; requester membership and permission are rechecked at decision. Tenant MFA policy is enforced from the source-known setting, pending actual current-assurance qualification. No JWT issuance/impersonation, caller-selected actor, generic privileged proxy or unmapped eligibility workaround is introduced.',
 '',
 'New request fields freeze both config and current owner/grant/association/membership snapshots and fingerprints. Private transaction-bound receipts guard lifecycle transitions. Exact copied grant tuples are checked atomically and through a deferred native guard. Approved versions retain their immutable config and mapping snapshots, request/checker/audit binding and old historical records. Stale/replayed/self/current-revocation decisions use PT409 business codes. Existing legacy/retirement/service run branches are retained by narrow native-trigger dispatch rather than copying generic helper implementations.',
 '',
 'Native proof: **69 distinct cases PASS** (34 retained primary + 15 new group/audit cases + 6 grant-association cases + 7 version-evidence cases + 7 concurrency cases). The 62 semantic cases include rollback-only assertions; notices and receipts retain their evidence. Seven real concurrent native probes show relevant grant/assignment/member operations serialized and unrelated tenant associations unblocked. All18 proposed function prosrc bodies match actual compiled native postimages. Local PG17.11 fixtures are synthetic and stopped. Their assurance selector is a test input, not a real MFA session, and they do not prove hosted PG17.6/current-guard compatibility.',
 '',
 'Failed attempts remain in native-run.log and dated receipts: inherited Windows pg_ctl pipe timeout before SQL, corrected baseline harness expectation (actual legacy23514), and native run-trigger alias ambiguity repaired before the final passing run. Completed operations/tests were retained; later runs replaced only changed owned native functions and exercised new cases. No paid inference or unchanged API60+12 tests were rerun.',
 '',
 'Source/native single proposal: `output/mapped-recon-governance-20261004/unqualified-implementation.sql`',
 'Final proposal SHA256: `'+sha(source)+'`',
 '',
 'Parent exact READ ONLY query: `scripts/qa/mapped-recon-governance-metadata-request-20261004.sql`',
 'Query SHA256: `'+qualification.requestSha256+'`',
 'Run once against both actual current targets, returning `catalog` envelopes to the private root; no business rows, setting values, vault ciphertext or token verifiers are selected. Candidate version20261004080000 has no source-file collision; actual ledger collision qualification remains pending. If parent advances the ledger, provide actual new paired identity/ACK and exact fresh consumed catalog; never waive source guards or merely relabel452/430.',
 '',
 'After qualified paired metadata, `node scripts/qa/mapped-recon-governance-assemble-20261004.mjs <PROD-capture> <DEV-capture>` emits the single exact-catalog guarded forward packet. It compares the complete consumed catalog (raw source/owner/ACL/identity/args/result/config/constraints/policies/triggers) before adding fields or replacing bodies. It fails on stale identity, missing consumed helpers or version collision. The assembler deliberately emits NO guarded apply packet when catalogs are absent. Current column/assurance/native-trigger differences still require source-specific review and focused native qualification before READY.',
 '',
 'Parent-only remainder: exact target metadata/native qualification → guarded actualPG17.6 rollback/apply → ACK → owned real MFA initial promotion, edit staging, self-denial, independent promotion, run/results/history readback. This lane has not invoked a hosted business action. Frozen8 opaque API/GTM runtime files, Godel/Turing journals, global types/routes, owner credentials/roles/history, marketing, eight deletions and platform/Suggest limits were not edited by this work. All Axiom/Veritas Docker resources remain untouched.',
 '',
 'File list (hashes/bytes, all receipts and raw preimages in manifest.json; native data directory deliberately excluded from patch artifacts):',
 '',...files.filter(x=>x.path.startsWith('scripts/')||x.path.startsWith('tests/')).map(x=>'- `'+x.path+'`'),...preimages.map(x=>'- `'+x.path+'`'),
 '- `output/mapped-recon-governance-20261004/unqualified-implementation.sql`',
 '- `output/mapped-recon-governance-20261004/qualification.json`',
 '- `output/mapped-recon-governance-20261004/native-compiled-postimages.json`',
 '- `output/mapped-recon-governance-20261004/native-receipt.json` and archived attempt receipts',
 '- `output/mapped-recon-governance-20261004/native-concurrency-receipt.json`',
 '- `output/mapped-recon-governance-20261004/native-bounded-locks-receipt.json`',
 '- `output/mapped-recon-governance-20261004/native-postimages-receipt.json`',
 '- `output/mapped-recon-governance-20261004/manifest.json`',
 '',
 'Current free disk measured by this return: '+manifest.freeDiskGiB+'GiB. Only the own small stopped non-Docker native fixture was created/used; no shared maintenance resources were started, restarted or cleaned.',
 ];
fs.writeFileSync(path.join(out,'RETURN.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({status:manifest.status,ready:false,nativeCases:69,compiledBodiesMatched:defs.length,sourceSha256:sha(source),querySha256:qualification.requestSha256,files:files.length,freeDiskGiB:manifest.freeDiskGiB,rawPreimages:preimages.length}));
