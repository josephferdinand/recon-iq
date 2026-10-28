import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const out=path.join(root,'output/mapped-recon-governance-20261004');
fs.mkdirSync(out,{recursive:true});
const sourceCollisions=fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.startsWith('20261004080000'));
if(sourceCollisions.length)throw new Error('Proposed source version collision: '+sourceCollisions.join(','));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const implementation=read('scripts/qa/mapped-recon-governance-implementation-20261004.inc.sql');
const guards=read('scripts/qa/mapped-recon-governance-native-guards-20261004.inc.sql');
// Definitions are compiled before calls execute. Guard helpers need the new
// composite columns; install them after all implementation definitions.
const dispatch=`
DO $dispatch$
DECLARE definition text; needle text; branch text;
BEGIN
 definition:=pg_get_functiondef('public.tg_guard_recon_definition_governance()'::regprocedure);
 needle:=substring(definition from 'BEGIN['||chr(13)||chr(10)||']+');
 branch:=$branch$  IF TG_OP='INSERT' AND NEW.access_mode='mapped_exact' THEN
    RETURN private.mapped_recon_governance_stage_insert(NEW);
  END IF;
  IF TG_OP='UPDATE' AND OLD.access_mode='mapped_exact' AND OLD.governance_state<>'legacy_mapped'
     AND NEW.retired_at IS NOT DISTINCT FROM OLD.retired_at
     AND NEW.retirement_request_id IS NOT DISTINCT FROM OLD.retirement_request_id THEN
    RETURN private.mapped_recon_governance_update(OLD,NEW);
  END IF;
$branch$;
 IF needle IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'mapped governance trigger preimage has no unique BEGIN' USING ERRCODE='PT409'; END IF;
 definition:=overlay(definition placing branch from position(needle IN definition)+length(needle) for 0);
 EXECUTE definition;
 definition:=pg_get_functiondef('public.require_recon_multi_bu_owner()'::regprocedure);
 needle:=substring(definition from 'BEGIN['||chr(13)||chr(10)||']+');
 branch:=$branch$  IF TG_OP='INSERT' AND NEW.access_mode='mapped_exact' AND NEW.governance_state='staging_copy' THEN
    PERFORM private.mapped_recon_governance_stage_insert(NEW);
    RETURN NEW;
  END IF;
$branch$;
 IF needle IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'mapped owner trigger preimage has no unique BEGIN' USING ERRCODE='PT409'; END IF;
 definition:=overlay(definition placing branch from position(needle IN definition)+length(needle) for 0);
 EXECUTE definition;
 definition:=pg_get_functiondef('public.tg_guard_recon_run_governance()'::regprocedure);
 needle:=substring(definition from 'BEGIN['||chr(13)||chr(10)||']+');
 branch:=$branch$  IF auth.role()='authenticated' AND current_setting('role',true)='authenticated'
    AND EXISTS(SELECT 1 FROM public.recon_definitions mapped_definition WHERE mapped_definition.id=NEW.definition_id AND mapped_definition.tenant_id=NEW.tenant_id AND mapped_definition.access_mode='mapped_exact' AND mapped_definition.governance_state<>'legacy_mapped') THEN
    RETURN private.mapped_recon_governance_run(NEW);
  END IF;
$branch$;
 IF needle IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'mapped run trigger preimage has no unique BEGIN' USING ERRCODE='PT409'; END IF;
 definition:=overlay(definition placing branch from position(needle IN definition)+length(needle) for 0);
 EXECUTE definition;
END $dispatch$;
`;
const constraint=`
ALTER TABLE public.recon_definition_governance_requests ADD CONSTRAINT mapped_recon_governance_frozen_shape CHECK (
 mapped_governance_version IS NULL OR (mapped_governance_version=1
 AND parent_config_fingerprint IS NOT NULL AND parent_config_fingerprint ~ '^[0-9a-f]{64}$'
 AND parent_mapping_snapshot IS NOT NULL AND parent_mapping_fingerprint IS NOT NULL
 AND parent_mapping_fingerprint=private.mapped_recon_governance_hash(parent_mapping_snapshot)
 AND (request_kind='edit' OR (staging_config_fingerprint IS NOT NULL AND staging_config_fingerprint=snapshot_sha256 AND staging_mapping_snapshot IS NOT NULL
 AND staging_mapping_fingerprint IS NOT NULL AND staging_mapping_fingerprint=private.mapped_recon_governance_hash(staging_mapping_snapshot))))) ;
`;
const corrections=read('output/mapped-recon-governance-20261004/catalog-contract-corrections.inc.sql');
if(sha(corrections)!=='4e523cd53714185f24d2c4b46fa9345266d5d692e9f99649aef300a0b225a6bd')throw new Error('Qualified catalog corrections changed');
const body=implementation+'\n'+guards+dispatch+constraint+'\n'+corrections;
fs.writeFileSync(path.join(out,'unqualified-implementation.sql'),body);

// The catalog query itself is the guard. No hand-normalized owner/ACL/args,
// default expressions or helper source is substituted for captured metadata.
const files=process.argv.slice(2);
if(files.length!==2){
 const report={status:'WAITING_FOR_PAIRED_CURRENT_CATALOG',ready:false,version:'20261004080000',
  requestFile:'scripts/qa/mapped-recon-governance-metadata-request-20261004.sql',
  requestSha256:sha(read('scripts/qa/mapped-recon-governance-metadata-request-20261004.sql')),
  implementationSha256:sha(body),required:{PROD:452,DEV:430,latest:'20261004033000'},
  note:'unqualified-implementation.sql is native-test input only; NOT an apply packet'};
 fs.writeFileSync(path.join(out,'qualification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
 process.exit(0);
}
const catalogs=files.map(f=>{
 const bytes=fs.readFileSync(f);const envelope=JSON.parse(bytes.toString());
 const row=envelope.results?.[0]?.rows?.[0];const catalog=row?.catalog??row;
 if(!catalog?.helpers||!catalog?.triggers||!catalog?.columns)throw new Error('Missing full consumed catalog: '+f);
 if(!['452','430'].includes(String(catalog.ledger))||String(catalog.latest)!=='20261004033000')throw new Error('Current base changed; request new exact catalog');
 if(catalog.version_collision?.length)throw new Error('Proposed version already exists');
 for(const name of ['tg_guard_recon_definition_governance','tg_guard_recon_run_governance','require_recon_multi_bu_owner','request_recon_definition_edit','decide_recon_definition_edit','submit_recon_definition_promotion','decide_recon_definition_promotion','recon_authoritative_access_decision_as']){
  const helper=catalog.helpers.find(x=>x.name===name&&x.schema===(name==='recon_authoritative_access_decision_as'?'private':'public'));
  if(!helper?.source||!helper?.owner||!helper?.identity&& !['tg_guard_recon_definition_governance','tg_guard_recon_run_governance','require_recon_multi_bu_owner'].includes(name))throw new Error('Required actual helper contract missing: '+name);
 }
 return {file:f,sha256:sha(bytes),catalog};
});
if(new Set(catalogs.map(x=>String(x.catalog.ledger))).size!==2)throw new Error('PROD and DEV captures required');
const query=read('scripts/qa/mapped-recon-governance-metadata-request-20261004.sql').replace(/;\s*$/,'');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const forward=`-- Parent only. Execute reviewed transaction after native proof and current ACK.\nDO $current$\nDECLARE captured jsonb; expected jsonb;\nBEGIN\n SELECT catalog INTO captured FROM (${query}) mapped_catalog_capture;\n expected:=CASE captured->>'ledger' ${catalogs.map(x=>`WHEN ${quote(String(x.catalog.ledger))} THEN ${quote(JSON.stringify(x.catalog))}::jsonb`).join('\n')} ELSE NULL END;\n IF expected IS NULL OR captured IS DISTINCT FROM expected THEN RAISE EXCEPTION 'mapped_recon_governance.current_catalog_changed' USING ERRCODE='PT409'; END IF;\nEND $current$;\n${body}`;
fs.writeFileSync(path.join(out,'20261004080000-mapped-recon-governance.forward.sql'),forward);
fs.writeFileSync(path.join(out,'qualification.json'),JSON.stringify({status:'CATALOG_QUALIFIED_NATIVE_PROOF_REQUIRED',ready:false,catalogs:catalogs.map(({catalog,...x})=>({...x,ledger:catalog.ledger,latest:catalog.latest})),forwardSha256:sha(forward),implementationSha256:sha(body)},null,2)+'\n');
console.log('Exact paired guard assembled; native proof still required.');
