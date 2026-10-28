// Parallel consumed-contract qualification only. Never invokes the assembler,
// emits a guarded forward packet, or modifies parent integration inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const base='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const specs=[['PROD','FVI-MAPPED-RECON-GOVERNANCE-PROD-CATALOG-2026-10-04T06-30-55-088Z.json','edb24167a441cd5acfdc6dab7d81adbeebd6dfc3eff3e5e0eb4430c3db09c5ad',452],['DEV','FVI-MAPPED-RECON-GOVERNANCE-DEV-CATALOG-2026-10-04T06-30-59-241Z.json','217cd1e22f6cde5f76d61297b47dda15aa3d1e64937cc8317c7f0b40db2e6ddb',430]];
const catalogs=specs.map(([environment,name,expected,ledger])=>{
 const file=path.join(base,name),bytes=fs.readFileSync(file);if(hash(bytes)!==expected)throw new Error('Capture SHA mismatch '+environment);
 const envelope=JSON.parse(bytes.toString());const c=envelope.catalog;
 const raw=JSON.parse(envelope.rawResponseText);const rawCatalog=raw.catalog??raw[0]?.catalog??raw.results?.[0]?.rows?.[0]?.catalog;
 if(JSON.stringify(stable(c))!==JSON.stringify(stable(rawCatalog)))throw new Error('Raw authoritative response differs '+environment);
 if(c.ledger!==ledger||String(c.engine)!=='170006'||c.latest!=='20261004033000'||c.version_collision!==null)throw new Error('Captured base differs '+environment);
 if(c.helpers.length!==43||c.relations.length!==25)throw new Error('Capture footprint differs '+environment);
 return {environment,file,sha256:expected,catalog:c};
});
const helper=(c,schema,name)=>{const h=c.helpers.find(h=>h.schema===schema&&h.name===name);if(!h)throw new Error('Missing consumed helper '+schema+'.'+name);if(hash(h.source)!==h.source_sha256)throw new Error('Raw helper SHA differs '+name);return h;};
const consumed=[...['request_recon_definition_edit','decide_recon_definition_edit','submit_recon_definition_promotion','decide_recon_definition_promotion','tg_guard_recon_definition_governance','require_recon_multi_bu_owner','tg_guard_recon_run_governance','audit_log_chain'].map(n=>['public',n]),...['recon_authoritative_access_decision_as','recon_run_bound_approved_version','recon_root_write_allowed','recon_definition_config_snapshot'].map(n=>['private',n]),...['uid','role','jwt'].map(n=>['auth',n])];
const profile=consumed.map(([schema,name])=>{
 const [p,d]=catalogs.map(x=>helper(x.catalog,schema,name));
 const semantic=h=>({...h,source:h.source.replaceAll('\r\n','\n'),definition:h.definition.replaceAll('\r\n','\n'),source_sha256:null});
 if(JSON.stringify(stable(semantic(p)))!==JSON.stringify(stable(semantic(d))))throw new Error('Material consumed paired contract differs '+schema+'.'+name);
 fs.mkdirSync(path.join(out,'current-consumed-preimages'),{recursive:true});
 fs.writeFileSync(path.join(out,'current-consumed-preimages',schema+'.'+name+'.sql'),p.definition);
 fs.writeFileSync(path.join(out,'current-consumed-preimages','DEV.'+schema+'.'+name+'.sql'),d.definition);
 return {schema,name,owner:p.owner,acl:p.acl,config:p.config,identity:p.identity,arguments:p.arguments,result:p.result,security_definer:p.security_definer,source_sha256:p.source_sha256,lineEnding:p.source.includes('\r\n')?'CRLF':'LF',devSourceSha256:d.source_sha256,devLineEnding:d.source.includes('\r\n')?'CRLF':'LF',rawSourcesEqual:p.source===d.source,semanticClassificationOnly:true};
});
const current=catalogs[0].catalog;
const proposed=fs.readFileSync('scripts/qa/mapped-recon-governance-implementation-20261004.inc.sql','utf8');
const runFile=fs.readFileSync('scripts/qa/mapped-recon-governance-native-guards-20261004.inc.sql','utf8');
const matched=runFile.match(/CREATE FUNCTION private\.mapped_recon_governance_run\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$;/);
if(!matched)throw new Error('Missing proposed narrow run helper');
const corrected=matched[0].replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION').replace(/ RETURN _new;\nEND \$\$;/,()=> ' -- Retain the actual native approved revision/independent runner contract.\n PERFORM private.recon_run_bound_approved_version(_new.tenant_id,_new.definition_id,_new.run_by);\n RETURN _new;\nEND $$;');
if(corrected===matched[0].replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION'))throw new Error('Narrow run correction not applied');
const functions=['request_recon_definition_edit','decide_recon_definition_edit','submit_recon_definition_promotion','decide_recon_definition_promotion'];
const epilogue=functions.map(name=>{
 const h=helper(current,'public',name);
 if(h.owner!=='postgres'||!h.security_definer||h.config?.length!==1||h.config[0]!=='search_path=public, private, extensions, pg_temp')throw new Error('Unexpected actual RPC contract '+name);
 const args=h.identity.split(',').map(a=>a.trim().split(/\s+/).slice(1).join(' ')).join(',');
 return `ALTER FUNCTION public.${name}(${args}) SET search_path=public,private,extensions,pg_temp;`;
}).join('\n');
const delta='-- Parent incorporates AFTER proposed definitions, before its postcondition checks.\n-- This is NOT a standalone migration/guard packet. Existing owners and ACLs\n-- are preserved by CREATE OR REPLACE; no OWNER or GRANT changes are proposed.\n'+corrected+'\n'+epilogue+'\n';
fs.writeFileSync(path.join(out,'catalog-contract-corrections.inc.sql'),delta);
const columns=current.columns.filter(c=>['tenant_security_settings','tenant_identity_policies'].includes(c.table));
const assurance={currentMfaColumn:columns.find(c=>c.table==='tenant_security_settings'&&c.name==='mfa_required'),signedUidSource:helper(current,'auth','uid').source,signedRoleSource:helper(current,'auth','role').source,signedJwtSource:helper(current,'auth','jwt').source,policyValueCaptured:false,policyHelpers:current.helpers.filter(h=>/mfa/i.test(h.name)).map(h=>h.schema+'.'+h.name),qaSpecificAssuranceHelper:'public.csa_assurance_actor is Assurance-lab-specific, not a generic governance/MFA authority'};
if(!assurance.currentMfaColumn||assurance.currentMfaColumn.type!=='boolean'||!assurance.currentMfaColumn.not_null)throw new Error('MFA policy column drift');
const assembler=fs.readFileSync('scripts/qa/mapped-recon-governance-assemble-20261004.mjs','utf8');
const report={status:'ACTUAL_CONSUMED_CONTRACTS_QUALIFIED_PARENT_CORRECTIONS_REQUIRED',assembled:false,base:catalogs.map(({catalog,...x})=>({...x,engine:catalog.engine,ledger:catalog.ledger,latest:catalog.latest,helpers:catalog.helpers.length,relations:catalog.relations.length})),consumed:profile,assurance,
 corrections:[
  {kind:'native-run-binding',reason:'Current native run guard calls recon_run_bound_approved_version, verifies immutable config/request/approver binding, and refuses the approving checker as runner. The proposed early-return helper must consume that same guard.',sidecar:'catalog-contract-corrections.inc.sql'},
  {kind:'rpc-configuration',reason:'Four proposal headers replace actual search_path. Restore the captured exact search_path while preserving existing owner/ACL/args/result/security-definer.',sidecar:'catalog-contract-corrections.inc.sql'},
  {kind:'stored-source-line-endings',reason:'Actual guard sources include CRLF. Recompute the BEGIN newline needle separately from EACH pg_get_functiondef using a CR/LF-safe match; never normalize the captured source guard.',parentOwnedAssemblerSha256:hash(assembler)},
 ],
 untouchedCurrentContracts:['authoritative ResourceAccess evaluator including read-only support grants/retired reads','current run revision binding/audit/snapshot/immutability triggers','resource actor attribution: checker-created actor provenance with persisted maker created_by','native reconciliation identifier allocation','retirement draft-to-active allowance','audit-chain signed session actor/tenant attribution'],
 accepted69Unchanged:true,proposalInputSha256:hash(proposed),correctionSha256:hash(delta),nativeProbePending:true};
fs.writeFileSync(path.join(out,'catalog-contract-qualification.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(out,'parent-assembler-crlf-correction.txt'),`Parent-only assembler correction; do not replay an already assembled packet.\nInspected assembler SHA256 ${hash(assembler)}\n\nAfter EACH definition:=pg_get_functiondef(...) assignment, compute:\n  needle:=substring(definition FROM E'BEGIN[\\\\r\\\\n]+');\nThen guard with coalesce(position(needle IN definition),0)=0.\nInside a JavaScript template literal, double the backslashes again.\nUse the matched newline length in overlay as before.\nKeep current raw prosrc/owner/ACL/args/config catalog guards byte-exact.\nThe original one-time E'BEGIN\\n' needle fails actual CRLF run guard insertion.\n\nParent transport adapter must consume envelope.catalog and confirm rawResponseText.catalog equivalence (capture envelope is not results[0].rows[0]).\nNo child assembly or mutation of parent assembler performed.\n`);
console.log(JSON.stringify({status:report.status,pairedConsumed:profile.length,helperBodiesSourceHashVerified:profile.length,actualAssurance:'signed auth.uid/auth.role/auth.jwt + current tenant_security_settings.mfa_required',correctionSha256:report.correctionSha256,guardCRLF:profile.filter(p=>p.lineEnding==='CRLF').map(p=>p.schema+'.'+p.name)}));
