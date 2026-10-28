// Changed-contract probes in the retained own small native fixture only.
// No assembly, hosted SQL, Docker, or replay of the accepted 69 cases.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const resume=process.argv.includes('--resume-after-correction-syntax');
let retainedCases=[];
if(resume){
 const failed=JSON.parse(fs.readFileSync(path.join(out,'catalog-differences-native-receipt.json'),'utf8'));
 if(failed.status!=='FAILED'||!failed.stopped)throw new Error('Missing stopped failed probe checkpoint');
 for(const name of ['catalog-differences-native.sql','catalog-differences-native.log','catalog-differences-native-receipt.json'])fs.copyFileSync(path.join(out,name),path.join(out,'attempt1-'+name));
 retainedCases=[...fs.readFileSync(path.join(out,'catalog-differences-native.log'),'utf8').matchAll(/NOTICE:\s+PASS: ([^\r\n]+)/g)].map(m=>m[1]);
}
const receipt=JSON.parse(fs.readFileSync(path.join(out,'native-receipt.json'),'utf8'));
if(receipt.status!=='NATIVE_VERSION_PASSED_CURRENT_CATALOG_PENDING'||!receipt.stopped)throw new Error('Retained stopped own fixture identity changed');
const qualified=JSON.parse(fs.readFileSync(path.join(out,'catalog-contract-qualification.json'),'utf8'));
const catalogs=qualified.base.map(x=>JSON.parse(fs.readFileSync(x.file,'utf8')).catalog);
const prod=catalogs[0],dev=catalogs[1];
const helper=(c,schema,name)=>{const h=c.helpers.find(h=>h.schema===schema&&h.name===name);if(!h)throw new Error('Missing helper '+name);return h;};
const trigger=(c,name)=>{const t=c.triggers.find(t=>t.name===name);if(!t)throw new Error('Missing trigger '+name);return t;};
const literal=s=>"E'"+s.replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('\r','\\r').replaceAll('\n','\\n')+"'";
const install=definition=>`DO $native_install$ BEGIN EXECUTE ${literal(definition)}; END $native_install$;\n`;
const restoreAcl=(schema,name,args,roles)=>`REVOKE ALL ON FUNCTION ${schema}.${name}(${args}) FROM PUBLIC,anon,authenticated,service_role; ${roles.length?`GRANT EXECUTE ON FUNCTION ${schema}.${name}(${args}) TO ${roles.join(',')};`:''}\n`;
let sql=`-- Actual consumed function/trigger definitions, exact CRLF included.
ALTER TABLE public.recon_definitions ADD COLUMN created_by_actor_id uuid,ADD COLUMN created_by_actor_status text,ADD COLUMN updated_by_actor_id uuid,ADD COLUMN updated_by_actor_status text;
ALTER TABLE public.business_units ADD COLUMN code text;
ALTER TABLE public.recon_runs ADD COLUMN approved_revision_id uuid,ADD COLUMN approved_revision_number integer,ADD COLUMN approved_revision_sha256 text;
ALTER TABLE public.audit_log ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY,ADD COLUMN occurred_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN prev_hash bytea,ADD COLUMN row_hash bytea;
CREATE TABLE public.audit_chain_head(singleton boolean PRIMARY KEY DEFAULT true,last_audit_id bigint,last_hash bytea,updated_at timestamptz DEFAULT now());
INSERT INTO public.audit_chain_head(singleton) VALUES(true);
CREATE TABLE public.platform_support_grants(actor_id uuid,tenant_id uuid,capability text,revoked_at timestamptz,granted_at timestamptz,valid_until timestamptz);
`;
// Actual support/read evaluator and immutable approved-revision binder. No
// replacement/synthetic authorization evaluator is supplied for these probes.
for(const name of ['recon_platform_support_grant_active','recon_authoritative_access_decision_as','recon_run_bound_approved_version'])sql+=install(helper(prod,'private',name).definition);
sql+=restoreAcl('private','recon_platform_support_grant_active','uuid,uuid,text',[])+restoreAcl('private','recon_authoritative_access_decision_as','uuid,uuid,text',[])+restoreAcl('private','recon_run_bound_approved_version','uuid,uuid,uuid',[]);
// The audit chain consumes these exact membership predicates. Platform role
// tables remain empty synthetic fixture inputs, not owner role grants.
const enums=prod.enums.filter(e=>e.schema==='public'&&e.name==='platform_role');
sql+=`CREATE TYPE public.platform_role AS ENUM (${enums.map(e=>"'"+e.value+"'").join(',')});\nCREATE TABLE public.platform_roles(user_id uuid,role public.platform_role);\n`;
for(const [schema,name]of [['private','has_platform_role'],['private','is_platform_admin'],['public','is_platform_admin'],['private','is_tenant_member'],['public','is_tenant_member']])sql+=install(helper(prod,schema,name).definition);
sql+=install(helper(prod,'public','audit_log_chain').definition);
sql+=`CREATE TRIGGER catalog_probe_audit_chain BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_chain();\n`;
// Exercise each actual source variant's insertion point independently. The
// control uses the old LF-only search without mutating any helper.
const actualGuardNames=['tg_guard_recon_definition_governance','require_recon_multi_bu_owner','tg_guard_recon_run_governance'];
for(const [i,c]of catalogs.entries()){
 for(const name of actualGuardNames){
  const h=helper(c,'public',name);sql+=install(h.definition);
  const expected=h.source.includes('BEGIN\r\n')?0:1;
  sql+=`SELECT qa.assert('${i?'DEV':'PROD'} ${name} actual newline control',(position(E'BEGIN\\n' IN pg_get_functiondef('public.${name}()'::regprocedure))${expected?' > 0':' = 0'}));\n`;
  const branch=name==='tg_guard_recon_definition_governance'?`  IF TG_OP='INSERT' AND NEW.access_mode='mapped_exact' THEN RETURN private.mapped_recon_governance_stage_insert(NEW); END IF;
  IF TG_OP='UPDATE' AND OLD.access_mode='mapped_exact' AND OLD.governance_state<>'legacy_mapped' AND NEW.retired_at IS NOT DISTINCT FROM OLD.retired_at AND NEW.retirement_request_id IS NOT DISTINCT FROM OLD.retirement_request_id THEN RETURN private.mapped_recon_governance_update(OLD,NEW); END IF;
`:name==='require_recon_multi_bu_owner'?`  IF TG_OP='INSERT' AND NEW.access_mode='mapped_exact' AND NEW.governance_state='staging_copy' THEN PERFORM private.mapped_recon_governance_stage_insert(NEW); RETURN NEW; END IF;
`:`  IF auth.role()='authenticated' AND current_setting('role',true)='authenticated' AND EXISTS(SELECT 1 FROM public.recon_definitions mapped_definition WHERE mapped_definition.id=NEW.definition_id AND mapped_definition.tenant_id=NEW.tenant_id AND mapped_definition.access_mode='mapped_exact' AND mapped_definition.governance_state<>'legacy_mapped') THEN RETURN private.mapped_recon_governance_run(NEW); END IF;
`;
  sql+=`DO $probe$ DECLARE definition text:=pg_get_functiondef('public.${name}()'::regprocedure); needle text; BEGIN needle:=substring(definition FROM E'BEGIN[\\\\r\\\\n]+'); IF needle IS NULL THEN RAISE EXCEPTION 'missing BEGIN'; END IF; definition:=overlay(definition placing ${literal(branch)} from position(needle IN definition)+length(needle) for 0); EXECUTE definition; END $probe$;\n`;
  // Native bytes must equal the original source with exactly this insertion;
  // EOL normalization is never used as a target source guard.
  const at=h.source.match(/BEGIN[\r\n]+/);const expectedSource=h.source.slice(0,at.index+at[0].length)+branch+h.source.slice(at.index+at[0].length);
  const expectedHash=crypto.createHash('sha256').update(expectedSource).digest('hex');
  sql+=`SELECT qa.assert('${i?'DEV':'PROD'} ${name} exact native dispatch suffix preserved',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${expectedHash}' FROM pg_proc WHERE oid='public.${name}()'::regprocedure));\n`;
 }
}
// Leave the current DEV EOL variant installed; contracts are otherwise equal.
sql+=restoreAcl('public','tg_guard_recon_definition_governance','',['service_role'])+restoreAcl('public','require_recon_multi_bu_owner','',['anon','authenticated','service_role'])+`GRANT EXECUTE ON FUNCTION public.require_recon_multi_bu_owner() TO PUBLIC;\n`+restoreAcl('public','tg_guard_recon_run_governance','',[]);
sql+=install(trigger(prod,'zz_resource_actor_attribution').helper)+install(trigger(prod,'trg_assign_reconciliation_code').helper)+install(trigger(prod,'trg_guard_recon_definition_retirement').helper);
sql+=`CREATE TRIGGER zz_resource_actor_attribution BEFORE INSERT OR UPDATE ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION public.set_resource_actor_attribution();
CREATE TRIGGER trg_assign_reconciliation_code BEFORE INSERT ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION public.assign_reconciliation_code();
CREATE TRIGGER trg_guard_recon_definition_retirement BEFORE DELETE OR UPDATE OF status,retired_at,retirement_request_id ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION public.tg_guard_recon_definition_retirement();\n`;
sql+=install(trigger(prod,'recon_runs_approval_guard').helper)+`CREATE TRIGGER recon_runs_approval_guard BEFORE INSERT ON public.recon_runs FOR EACH ROW EXECUTE FUNCTION public.tg_guard_recon_run_approved_revision();\n`;
sql+=fs.readFileSync(path.join(out,'catalog-contract-corrections.inc.sql'),'utf8');
for(const name of ['request_recon_definition_edit','decide_recon_definition_edit','submit_recon_definition_promotion','decide_recon_definition_promotion']){
 const h=helper(prod,'public',name);const args=h.identity.split(',').map(a=>a.trim().split(/\s+/).slice(1).join(' ')).join(',');
 sql+=restoreAcl('public',name,args,['authenticated','service_role']);
 sql+=`SELECT qa.assert('actual ${name} owner ACL configuration retained',(SELECT pg_get_userbyid(proowner)='${h.owner}' AND proacl::text='${h.acl}' AND proconfig::text=ARRAY['search_path=public, private, extensions, pg_temp']::text FROM pg_proc WHERE oid='public.${name}(${args})'::regprocedure));\n`;
}
sql+=fs.readFileSync('tests/sql/mapped-recon-governance-catalog-differences-20261004.sql','utf8');
if(resume){
 const entry=sql.indexOf('-- Parent incorporates AFTER proposed definitions');
 if(entry<0||retainedCases.length!==12)throw new Error('Focused resume checkpoint differs');
 sql=sql.slice(entry);
}
const file=path.join(out,'catalog-differences-native.sql');fs.writeFileSync(file,sql);
const bin='C:/Program Files/PostgreSQL/17/bin',data=path.join(out,'native-pg17-data');
const fd=fs.openSync(path.join(out,'native-pg-control.log'),'a');
const control=action=>{const r=spawnSync(path.join(bin,'pg_ctl.exe'),['-D',data,...(action==='start'?['-l',path.join(out,'native-server.log'),'-w','start']:['-m','fast','-w','stop'])],{windowsHide:true,stdio:['ignore',fd,fd],timeout:20000});if(r.error||r.status!==0)throw new Error('Own native cluster '+action+' failed');};
const result={tier:'synthetic native probes of actual changed consumed catalog contracts, not hosted MFA proof',accepted69Repeated:false,assembled:false,sqlSha256:crypto.createHash('sha256').update(sql).digest('hex'),cases:[]};
try{
 control('start');
 const r=spawnSync(path.join(bin,'psql.exe'),['-X','-h','127.0.0.1','-p',String(receipt.port),'-U','postgres','-d',receipt.database,'-v','ON_ERROR_STOP=1','-f',file],{windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:3*1024*1024});
 fs.writeFileSync(path.join(out,'catalog-differences-native.log'),(r.stdout??'')+(r.stderr??''));
 if(r.error||r.status!==0)throw new Error('Changed-catalog probe failed; inspect catalog-differences-native.log');
 result.cases=[...retainedCases,...(r.stderr??'').matchAll(/NOTICE:\s+PASS: ([^\r\n]+)/g)].map(m=>typeof m==='string'?m:m[1]);result.status='ACTUAL_CATALOG_DIFFERENCE_PROBES_PASS';
}catch(e){result.status='FAILED';result.error=e.message;process.exitCode=1;}
finally{
 try{control('stop');result.stopped=true;}catch(e){result.stopError=e.message;process.exitCode=1;}
 fs.closeSync(fd);fs.writeFileSync(path.join(out,'catalog-differences-native-receipt.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
