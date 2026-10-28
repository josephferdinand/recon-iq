from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,subprocess,tomllib,re

root=Path(r'./LOCAL_USER\OneDrive - 8gsp1y\Documents\ChatGPT\ReconIQ')
candidate=Path(r'./LOCAL_USER\AppData\Local\Temp\fvi-batch4-candidate-20260928')
packet=Path(r'./LOCAL_USER\AppData\Local\Temp\fvi-codex-docs-release-20260930')
audit=Path(r'./LOCAL_USER\AppData\Local\Temp\fvi-codex-audit-20260930-4746723')
private=Path(r'./LOCAL_USER\AppData\Local\FVI-QA-Private-20260925')
now=datetime.now(timezone.utc);stamp=now.isoformat();sha=lambda b:hashlib.sha256(b).hexdigest()
def git(p):
 def run(*a):return subprocess.check_output(['git','-C',str(p),*a],text=True).rstrip('\r\n')
 rows=run('status','--porcelain').splitlines()
 return dict(head=run('rev-parse','HEAD'),branch=run('branch','--show-current'),dirty=len(rows),staged=sum(x[0] not in ' ?' for x in rows),tracked_deletions=sum('D' in x[:2] for x in rows),remote_freshly_fetched=False)
states={'canonical':git(root),'candidate':git(candidate),'bounded_packet_has_git':(packet/'.git').exists()}
identity=json.loads((audit/'schema-shutdown-20261003.json').read_text())
hosted=json.loads((audit/'shutdown-canonical-readback-20261003.json').read_text())
automation=tomllib.loads(Path(r'./LOCAL_USER\.codex\automations\fvi-investor-releases\automation.toml').read_text())
assert automation['status']=='PAUSED'
proofs={};artifact_paths=[]
for env,count in [('PROD',437),('DEV',415)]:
 base=private/f'FVI-COMBINED-{env}-WORKFLOW-20261002'
 prep=json.loads(Path(str(base)+'-PREPARED.json').read_text());dry=json.loads(Path(str(base)+'-DRY-RUN-RECEIPT.json').read_text())
 assert dry['rollbackVerified'] and dry['packetSha256']==prep['dryRunSha256']
 assert not Path(str(base)+'-APPLY-RECEIPT.json').exists()
 assert next(x for x in identity['result'] if x['environment']==env)['ledger'][0]['ledger_count']==count
 for suffix,key in [('-DRY-RUN.sql','dryRunSha256'),('-APPLY.sql','applySha256')]:
  p=Path(str(base)+suffix);assert sha(p.read_bytes())==prep[key];artifact_paths.append(p)
 artifact_paths.extend([Path(str(base)+'-PREPARED.json'),Path(str(base)+'-DRY-RUN-RECEIPT.json')])
 proofs[env]={'dry_run_at':dry['at'],'packet_sha256':dry['packetSha256'],'initial_ledger':count,'planned_ledger':prep['expectedLedger'],'applied':False}
artifact_paths.extend([audit/'combined-workflows-protected-prod-build-20261002.log',audit/'combined-workflows-typecheck-repair-20261002.log'])
assert '"ok":true' in artifact_paths[-2].read_text(encoding='utf-8-sig')
migrations=[]
for p in sorted((packet/'supabase/migrations').glob('20261002*.sql')):
 if p.name[:14] in ['20261002103000','20261002110000','20261002113000','20261002113100','20261002113200','20261002113300','20261002115000','20261002121000','20261002133000','20261002133100']:
  migrations.append({'path':str(p),'sha256':sha(p.read_bytes())})
manual=candidate/'supabase/migrations/20261002120000_tasks_manual_match_eod_atomic.sql'
assert manual.exists();migrations.append({'path':str(manual),'sha256':sha(manual.read_bytes())})
assert len(migrations)==11
dist_files=sorted(p for p in (packet/'dist').rglob('*') if p.is_file())
dist=[{'path':p.relative_to(packet/'dist').as_posix(),'sha256':sha(p.read_bytes())} for p in dist_files]
snapshot={'at_utc':stamp,'date_ist':'2026-10-03','git':states,'database':identity,'canonical_readback':hosted,'combined_sql':proofs,'migration_sources':migrations,'dist_file_count':len(dist),'dist_inventory_sha256':sha(json.dumps(dist,sort_keys=True).encode()),'automation_status':automation['status'],'goal':'ACTIVE; unfinished, owner shutdown hold','actual_usage_last_read':'48% used / 52% remaining; no stop threshold reached'}
(audit/'shutdown-dist-inventory-20261003.json').write_text(json.dumps(dist,indent=2),encoding='utf-8')
authority=f'''## 3 October 2026 IST — owner shutdown/restart checkpoint ({stamp})

Owner requested process hygiene NOW following another crash, before proper shutdown and restart. HOLD new product work, SQL applies, uploads and hosted mutations until owner resumes after reboot. Existing persistent goal remains ACTIVE and incomplete; existing fvi-investor-releases heartbeat is PAUSED through app tool and actual TOML readback. This is owner-directed shutdown coordination, not completion or a quota stop (latest actual core48%used/52%remaining). Supersedes earlier ACTIVE heartbeat and source-only integration status paragraphs; preserve historical text.

Fresh readonly database identities: PROD437 / DEV415, latest20261002104000 both, captured23:47:21UTC October2. No combined SQL was committed. Both actual PG17 combined transaction DRY RUNS passed with ROLLBACK and unchanged ledger; private exact prepared/dry-run/apply packets and receipts are saved. Planned ledger after eventual reviewed apply: PROD448 / DEV426/latest133100. Required repaired compiler, protected PROD build and118 distinct focused checks passed before shutdown. These are source/build/rollback proof, NOT deployment or full workflow acceptance.

Latest PROD deployment cef2c7e7-bed2-4f51-998a-9e978be6a489 independently reread through Cloudflare deployment list during shutdown; DEV48e15093-4541-4cba-b8db-22eb5d6ca52b remains prior verified deployment ID. Fresh BOTH canonical auth200/nonce1 and exact styles-D0dtzSlX.css SHA107087cb405926eb5c7ec40da955cdfada9574795590595fd3a194ed5c5927f5 captured23:48:55UTC. No new combined upload. Approved marketing and Worker IDs are retained prior evidence, not freshly reread in this shutdown check. Existing sidebar-selection/gold-action release is live; combined governance/Home/Exceptions/Reference/ManualEOD/Ticket/Audit/high-contrast source is integrated/build-ready but NOT LIVE.

Authoritative restart return: docs/handover/returns/2026-10-03-codex-shutdown-restart-RETURN.md; feature snapshot docs/evidence/FVI_SHUTDOWN_RESTART_CHECKPOINT_2026-10-03.md and manifest of that name with _MANIFEST.json. Read HANDOVER_README, newest CODEX/AGENTS/PROJECT/current state, continuity contract, detailed return, docs52/70, then exact qualified lane returns. Do not rerun old hygiene script with stale hard-coded source/deployment claims.

'''
agents='''| Agent — work | Shutdown checkpoint / restart handling |
|---|---|
| Primary — combined SQL/build/PROD+DEV release | No parent mutation/upload running; read-only checks terminal. Both rollback proofs ready. Revalidate resource/prepared/dist hashes before apply; do not repeat unchanged tests. |
| Hilbert — Reports custom scheduler/regulatory/Unicode | Original handle not_found after crash. Qualified9-runtime-file return in candidate/output/hilbert-full-report-kernel-20261002-v1 remains;10focused+30native assertions. Regulatory positive materialization still unqualified. Recover from exact manifest, not assume running. |
| Epicurus — connector workflows | Retry routing timeout; last actual handle running then close returned running and notification shutdown. Existing finite-grant5case return preserved; actual grant/claim/finalize/publish not proven. |
| Leibniz — full procedures/screenshots | Original handle not_found.26guides/40reviewedimages/147route matrix/104file manifest retained; checker/denied-role/3loading paths open. |
| Zeno — real hosted governance QA | Original handle not_found. Saved driver/local readiness; prior MFA sessions expired by shutdown; refresh owned QA normally. No new governance writes acknowledged. |
| Boyle — package promotion | Previous manual/EOD packet frozen/integrated; new promotion assignment submitted but handle now not_found, no new implementation result claimed. Recover original context/existing promotion source. |
| Carson — Home/team/BU/group QA | Color proof frozen; new QA assignment submitted but handle now not_found. No new hosted results claimed. |
| Pascal — API documentation/coverage | NewLuna01a0fda3-f0d4-7b33-98cb-8d9e85b2a9be routing timeout, retry; last actual handle running then closed and shutdown notification. No completed API patch claimed. |
| Kierkegaard / Harvey / Confucius / Hubble / Copernicus / Volta — integrated ready lane returns | Membership/access review/UI/Exceptions/Reference/Ticket returns retained and frozen. Do not call returned agents busy or rewrite integrated qualified source. |

Extra spawn rejected actual thread limit. On restart close completed unused slots/reuse saved agents, retry runtime failures, and assign disjoint full tasks. Old six/eight/fourteen observed limits do not prove unlimited capacity. Parent alone owns integration/shared types/compiler/build/apply/deploy. ClaudeLinkread_inbox is unavailable; no inbox-success claim. No cross-project private data inspected or sent.
'''
remaining='''Items1–12 remain tracked in docs52: Recovery/DataPrep keyed replay and exact reconciliation history have deployed bounded proof, but full benchmark/ordinary-role acceptance remains; Access/Directory/Copilot have scoped hosted proof, not whole acceptance; Scheduler retains manual/scheduledNostro proof; connectors real protocols/claim/publish remain; PDF extraction/Unicode breadth remains; Templates full scoped maker/checker proof retained with collateral gaps; assurance ten benchmark executions remain0/10; DEV structural/code replication exists but full authenticated/config parity remains.

Additional backlog: tenant-owned BU/groups/resource mappings and Home/MyTeam; full Exceptions inbox/auto-assignment/break/proposal/matched/NRL; Insights/recorded lineage/productivity/audit; reportCSV/XLSX/PDF/ZIP/custom schedules/regulatory; manual approvals/EOD; Tickets assigned worker/case/SLA/RAG/Navigator; API purpose-scoped coverage for actual PROD/DEV and verified future UAT; every procedure/current screenshot; dynamic promotion dependency selection/source approval/destination acceptance; approved governanceV4 full workflow release; future guarded AgenticAI and nativeTypeScript Authentik-derived authentication/SSO/SCIM/unlock/admin approvals. No ask deleted or falsely closed. Native auth/SSO/SCIM and Alpic implementation holds remain, current Suggest ceiling/retention protections remain. PostgreSQL upgrade cancelled; no paid-plan change.
'''
next_steps='''1. After owner restarts/resumes: read this checkpoint and revalidate Git/status, actual usage, databases and canonical deployment/config identities. Resume same goal and same paused heartbeat through app tool, no duplicate automation.
2. Verify saved11migration hashes, exact prepared SQL/dry-run receipts, protected build/dist hashes. PROD437/DEV415 must still match preimages. If unchanged, do not redo118focused checks or unchanged broad suites. Revalidate drift only.
3. Apply reviewed combined SQL through scripts/run-combined-workflow-sql-20261002.mjs with explicit PROD/DEV and apply mode under original deployment authorization, verify exact planned ledgers. No current apply receipt exists. If an uncertain future attempt occurs, inspect ledger/external state before retry.
4. Revalidate protected PROD build config and upload existing combined artifact to fvi-app, capture deployment receipt; prepare real QA MFA sessions and relevant named workflow/checker/access/audit readback. Preserve PROD artifact before isolatedDEV build/upload to fvi-app-staging and hosted readback.
5. Update release receipts/continuity once for material release; resume reports, transports, documentation, promotion preparation and benchmarks in parallel. Full goal stays incomplete until all requirements actually verified.

Do not repeat: wholeHermes deploy; normalized/waived source guards; missing-handle duplicate uploads; broad unchanged tests; shared mutable QA refresh states; no-op full recompiles; blind agent ACTIVE claims; Docker reset/prune/WSL shutdown; secret/owner-role/session rotation. Ticket CRLF/LF ledger defect was fixed by exact immutable source literal SHAe2aa136fcddde15f1fab2466d03ce82c74b45696d9db04a2679b5f0d1ca1046a, then both rollback proofs passed. Wrapper search_path public,extensions preserved builtinOID3432 and actual captured guard expressions; no defaults/functionACL relaxed. Gate shell dependent commands on LASTEXITCODE.
'''
detail='# FVI shutdown / restart handover — 3 October 2026 IST\n\n'+authority+'## Exact state\n\n```json\n'+json.dumps(snapshot,indent=2)+'\n```\n\n## Agent lanes\n\n'+agents+'\n## Remaining full scope\n\n'+remaining+'\n## Restart commands and gates\n\n'+next_steps
detail+='\n## Data/access/rollback and limitations\n\nNo business data, identities, credentials, sessions, historical fixtures or schema ledger were changed by this checkpoint. No commit/push/reset/checkout/cleanup. Existing dirty work/eightcanonicaldeletions retained. Vault/private QA locations remain local; secret values, browser sessions and resetlinks are excluded. Exact prior failed SQL diagnostics retained privately; both transactions rolled back. This snapshot contains safe metadata/hashes only. No full product testing or owner acceptance claimed. API/env inventories remain current prior source inventories with new shutdown freshness notes; graph baseline72f60235 remains STALE. No architecture change requiring new ADR; decision history records temporary shutdown hold. Git remote/upstream was not freshly fetched; originalGitHubconnectorread remains separate proof. SharedDocker not restarted/reset/pruned. Process query matched only parent read-only PowerShell at observation; does not inventory every unrelated process/service.\n'
updated=[];missing=[]
def write(p,text):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8');updated.append(p)
def prepend(p,text):
 if not p.exists():missing.append(str(p));return
 write(p,text+p.read_text(encoding='utf-8-sig'))
standard=['HANDOVER_README.md','CODEX.md','AGENTS.md','PROJECT.md','.codex/CURRENT_STATE.md','.codex/SESSION_HANDOVER.md','.codex/PROJECT_MEMORY.md','.codex/IMPROVEMENT_REGISTER.md','docs/70_detailed_session_handover_2026-09-14.md','docs/52_owner_backlog_2026-09-06.md','docs/handover/ACCESS_AND_ENVIRONMENT.md','docs/handover/ARCHITECTURE_AND_LOGIC.md','docs/handover/EXECUTION_ROADMAP.md','docs/handover/DOCUMENTATION_CATALOG.md','.claude/memory/project-context.md','.claude/memory/architecture-history.md','.claude/memory/decisions.md','.claude/memory/FVI-Cron-Schedules-Windows.md']
for rel in standard:prepend(root/rel,authority+((agents+'\n'+remaining+'\n'+next_steps+'\n') if rel in ['.codex/SESSION_HANDOVER.md','docs/70_detailed_session_handover_2026-09-14.md','docs/52_owner_backlog_2026-09-06.md'] else ''))
for rel in ['docs/handover/API_ROUTE_INVENTORY.md','docs/handover/ENVIRONMENT_VARIABLE_INVENTORY.md','graphify-out/GRAPH_REPORT.md']:prepend(root/rel,authority+'Source inventories retained; no hosted completeness claim. Graph remains explicitly stale.\n\n')
for rel in ['docs/evidence/FVI_INCREMENTAL_RELEASE_PLAN_2026-10-01.md','docs/evidence/FVI_HERMES_KEEP_FIX_DISPOSITION_2026-10-01.md','docs/handover/returns/2026-10-01-codex-investor-releases-RETURN.md']:prepend(candidate/rel,authority+agents+'\n'+remaining+'\n')
prepend(root/'.claude/memory/lessons-learned.md','## 2026-10-03 — LL-367: Preserve exact SQL source bytes and quiesce before owner shutdown\n\nRoot causes: Git CRLF altered ticket migration bytes relative to immutable embedded LF ledger source; shell semicolon continued dependent commands after ENOENT; crash left missing agents and stale ACTIVE assumptions. Fix: compare immutable source literal/hash and normalized semantic equality, write only exact qualified bytes, gate commands on exit status, prove rollback on both actualPG17 targets. Prevention: save current packet/dist/source/receipt hashes; never waive schema guards; inspect authoritative state before retry; pause existing heartbeat and observe/close actual live FVI agent handles for owner shutdown. Resume full workflow from checkpoint, not serial broad retesting or partial-ready claims.\n\n')
write(root/'.claude/memory/session-log-2026-10-03.md',detail)
write(root/'docs/evidence/FVI_SHUTDOWN_RESTART_CHECKPOINT_2026-10-03.md',detail)
prepend(root/'docs/evidence/FVI_PROCESS_HYGIENE_CHECKPOINT_2026-10-02.md',authority+agents+'\n'+next_steps+'\n')
write(root/'docs/handover/returns/2026-10-03-codex-shutdown-restart-RETURN.md',detail+'\n## Return acceptance\n\nContinuity matrix updated through additive newest sections. Prior return/template preserved. Essential restart state is in canonical documents, local artifact hashes are explicitly separate. Unpushed/remotefreshness not asserted. Exact modified/ignored paths and hashes are in shutdown manifest. No deployment or full acceptance claim.\n')
obs=Path(r'C:\Users\Alice Yesudasan\vault\reconiq-intelligence')
prepend(obs/'FVI MOC.md',authority)
if obs.exists():write(obs/'Sessions/2026-10-03 - Shutdown restart checkpoint.md',detail)
note=Path(r'./LOCAL_USER\.codex\memories\extensions\ad_hoc\notes')/(now.strftime('%Y-%m-%dT%H-%M-%S')+'-fvi-owner-shutdown-checkpoint.md')
write(note,'Owner explicitly requested FVI shutdown/restart process hygiene. Newest return docs/handover/returns/2026-10-03-codex-shutdown-restart-RETURN.md. Goal remains active/incomplete, heartbeat PAUSED for owner reboot; wait for owner resume. PRODcef2c7e7/DEV48e15093 color release remains live; BOTH fresh canonical CSS/auth verified. SQL437/415 unchanged; combined source/typecheck/protectedbuild/118checks and BOTH actualPG17 rollback validations pass, but NO combined apply/upload. Ticket source LF checksum preserved, no guard waivers. Recover existing disjoint lanes; do not redo broad unchanged tests or duplicate uploads. Full backlog/holds retained; identities/credentials/history/marketing/eight deletions preserved.\n')
manifest={'at':stamp,'missing':missing,'snapshot':snapshot,'updated':[{'path':str(p),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size} for p in updated],'protected_artifacts':[{'path':str(p),'sha256':sha(p.read_bytes())} for p in artifact_paths],'dist_inventory_path':str(audit/'shutdown-dist-inventory-20261003.json')}
mp=root/'docs/evidence/FVI_SHUTDOWN_RESTART_CHECKPOINT_2026-10-03_MANIFEST.json';mp.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
assert all(sha(Path(x['path']).read_bytes())==x['sha256'] for x in manifest['updated'])
print(json.dumps({'checkpoint':str(root/'docs/evidence/FVI_SHUTDOWN_RESTART_CHECKPOINT_2026-10-03.md'),'return':str(root/'docs/handover/returns/2026-10-03-codex-shutdown-restart-RETURN.md'),'manifest':str(mp),'updated':len(updated),'missing':missing,'readback_hashes_match':True,'goal':'active','heartbeat':'PAUSED','git':states}))
