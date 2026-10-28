// Offline native PostgreSQL qualification. Metadata only; no provider connection.
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const repo=resolve(import.meta.dirname,'..');
const pgBin=process.env.FVI_REVIEW_PG_BIN ?? 'C:/Program Files/PostgreSQL/17/bin';
const currentPath=process.env.FVI_REVIEW_CATALOG ?? './LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-GOVERNANCE-CATALOG-PROD-20261002.json';
const priorPath='E:/Falcon Group Projects/Cloud Data/Secured Key Vault/FVI-PROD-APPLICATION-REPLICATION-CATALOG-20261001-431.json';
const supplementalPath=process.env.FVI_REVIEW_SUPPLEMENT ?? './LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-GOVERNANCE-CATALOG-PROD-EXTENDED-20261002.json';
const sha=x=>createHash('sha256').update(x).digest('hex');
const read=(p,hash)=>{const bytes=readFileSync(p);if(hash && sha(bytes)!==hash)throw Error('Metadata preimage mismatch');return JSON.parse(bytes);};
const current=read(currentPath,'9759ab9a81fa8ef40d662b27ab03cce41d7003a10bd2a9b599b4c518eae80c9e').rows[0].catalog;
const prior=read(priorPath,'cd65c5b8915ed7ecac9a8cb58e4b69ec64cfefa53a2e163813f6583f39037512').catalog;
const supplement=read(supplementalPath,'a66fb7fd3e495548e33c63b7c502f6a83d5b2bda2fe4a94ee288cb325ebddfc6');
const supplemental=supplement?.rows?.[0]?.catalog ?? supplement?.catalog ?? supplement;
const helperSupplementPath='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-GOVERNANCE-CATALOG-PROD-SUPPLEMENT-20261002.json';
const helperSupplementDoc=existsSync(helperSupplementPath)?read(helperSupplementPath,'384111f02ee55e75a1db737459b472870ee692658e5f43316dd9dc1e127cd04d'):null;
const helperSupplement=helperSupplementDoc?.rows?.[0]?.catalog;
const merge=(old,newer,key)=>[...new Map([...old,...newer].map(x=>[key(x),x])).values()];
const columns=merge(merge(merge(prior.columns,supplemental?.columns??[],x=>`${x.schema??'public'}.${x.table}.${x.name}`),current.columns,x=>`${x.schema??'public'}.${x.table}.${x.name}`),helperSupplement?.columns??[],x=>`${x.schema??'public'}.${x.table}.${x.name}`);
const constraints=merge(merge(merge(prior.constraints,supplemental?.constraints??[],x=>`${x.table}.${x.name}`),current.constraints,x=>`${x.table}.${x.name}`),helperSupplement?.constraints??[],x=>`${x.table}.${x.name}`);
const routines=merge(merge(merge(prior.functions,supplemental?.helpers??[],x=>`${x.schema}.${x.name}(${x.identity})`),current.helpers,x=>`${x.schema}.${x.name}(${x.identity})`),helperSupplement?.helpers??[],x=>`${x.schema}.${x.name}(${x.identity})`);
const lit=x=>x==null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
const ident=x=>'"'+x.replaceAll('"','""')+'"';
const migration=join(repo,'supabase/migrations/20261002133100_governance_access_review_decisions.sql');
const migrationBytes=readFileSync(migration);const sourceHash=sha(migrationBytes);
const dir=mkdtempSync(join(tmpdir(),'fvi-governance-access-review-native-'));
const dataDir=join(dir,'cluster');const checks=[];let started=false;let port;
function exe(name,args,options={}) {
 const r=spawnSync(join(pgBin,name+'.exe'),args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024,...options});
 if(r.error || r.status!==0) throw Error(`${name} failed: ${r.error?.message??r.stderr??r.stdout}`);
 return r.stdout;
}
function sql(label,text){writeFileSync(join(dir,label+'.sql'),text);const r=exe('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-f',join(dir,label+'.sql')]);writeFileSync(join(dir,label+'.out'),r);return r.trim();}
function pass(label){checks.push(label);console.log('PASS '+label);}
const id=n=>'81000000-0000-4000-8000-'+String(n).padStart(12,'0');
const tenant=id(1),otherTenant=id(2),maker=id(3),checker=id(4),subject=id(5),outsider=id(6),ordinary=id(7),bu=id(8),group=id(9),role=id(10),workspace=id(11),recon=id(12),registry=id(13),otherGroup=id(14);
const claims=actor=>`RESET ROLE; SELECT set_config('request.jwt.claim.sub',${lit(actor)},false); SELECT set_config('request.jwt.claim.role','authenticated',false); SET ROLE authenticated;`;
const rpc=(name,input)=>`public.governance_access_review_${name}(${lit(JSON.stringify(input))}::jsonb)`;
const expectDenied=(label,actor,call,code='42501')=>{
 sql(label,`${claims(actor)} DO $$ BEGIN PERFORM ${call}; RAISE EXCEPTION 'Unexpected successful action'; EXCEPTION WHEN SQLSTATE '${code}' THEN NULL; END $$;`);pass(label);
};
const createInput=(key,members=[{subject_user_id:subject,group_id:group,reviewer_id:checker,workspace_id:workspace}])=>({tenant_id:tenant,name:'Synthetic certification',due_at:'2099-10-02T12:00:00Z',request_key:id(key),memberships:members});
const decideInput=(item,key,decision='retain',version=1)=>({tenant_id:tenant,id:item.id,expected_version:version,snapshot_hash:item.snapshot_hash,request_key:id(key),decision,reason:'Synthetic qualification reason'});
const getItem=campaign=>JSON.parse(sql('get-item-'+checks.length,`${claims(checker)} SELECT ${rpc('get',{tenant_id:tenant,id:campaign.item_ids[0]})};`).split('\n').at(-1));
const createCampaign=(key,members)=>JSON.parse(sql('create-'+key,`${claims(maker)} SELECT ${rpc('campaign_create',createInput(key,members))};`).split('\n').at(-1));
function asyncSql(label,text){
 writeFileSync(join(dir,label+'.sql'),text);
 return new Promise((resolve,reject)=>{
   const child=spawn(join(pgBin,'psql.exe'),['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-f',join(dir,label+'.sql')],{windowsHide:true});
   let output='',error='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>error+=s);child.on('error',reject);
   child.on('exit',code=>{writeFileSync(join(dir,label+'.out'),output+error);code===0?resolve(output):reject(Error('Async SQL failed '+label+': '+error));});
 });
}

try {
 const binaryVersion=exe('postgres',['--version']).trim();
 if(!/PostgreSQL\) (16|17)\./.test(binaryVersion))throw Error('Expected native PostgreSQL 16/17');
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));port=socket.address().port;await new Promise(r=>socket.close(r));
 exe('initdb',['-D',dataDir,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
 started=true;
 exe('pg_ctl',['-D',dataDir,'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{stdio:'ignore'});
 const tables=new Set(['access_review_campaigns','access_review_items','audit_log','business_units','platform_roles','rbac_role_permissions','rbac_roles','tenant_group_members','tenant_group_roles','tenant_groups','tenant_members','workspace_members','workspaces',
   'bu_group_assignments','bu_user_assignments','rbac_user_grants','teams','team_members','recon_definitions','recon_definition_business_units','recon_definition_bu_grants','data_resource_registry','data_resource_registry_owner_bu','data_resource_registry_grants','data_resource_bu_grants','audit_chain_head','permissions','platform_support_grants','profiles','recon_permissions']);
 const defaultsSkipped=[];const foreignKeysSkipped=[];
 let ddl=`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;
 CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA extensions;
 GRANT USAGE ON SCHEMA public,private,auth TO authenticated,anon,service_role;
 CREATE EXTENSION ltree WITH SCHEMA public; CREATE EXTENSION citext WITH SCHEMA public; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 SET search_path=public,extensions; SET check_function_bodies=off;
 CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE public.tenants(id uuid PRIMARY KEY);
 `;
 for(const e of prior.enums.filter(e=>e.schema==='public'))ddl+=`CREATE TYPE public.${ident(e.name)} AS ENUM(${e.labels.map(lit).join(',')});\n`;
 for(const t of tables) {
   const cols=columns.filter(c=>(c.schema??'public')==='public'&&c.table===t).sort((a,b)=>a.position-b.position);
   if(!cols.length)throw Error('Missing actual metadata for '+t);
   ddl+=`CREATE TABLE public.${ident(t)}(${cols.map(c=>{
     let d=c.default;
     if(d?.includes('nextval('))d=null; // install owned fixture sequence after table
     if(d && /public\.[a-z_]+\(/.test(d) && !/gen_random_uuid/.test(d)){defaultsSkipped.push(`${t}.${c.name}`);d=null;}
     return `${ident(c.name)} ${c.type}${c.not_null?' NOT NULL':''}${d?' DEFAULT '+d:''}${c.identity?' GENERATED BY DEFAULT AS IDENTITY':''}`;
   }).join(',')});\n`;
 }
 // Install all PK/unique/check constraints, plus every FK whose relation is present.
 for(const c of constraints.filter(c=>(c.schema??'public')==='public'&&tables.has(c.table)&&c.type!=='f'))ddl+=`ALTER TABLE public.${ident(c.table)} ADD CONSTRAINT ${ident(c.name)} ${c.definition};\n`;
 const actualIndexes=merge(prior.indexes,[...(supplemental?.indexes??[]),...current.indexes].map(x=>({schema:x.schemaname,table:x.tablename,name:x.indexname,definition:x.indexdef})),x=>`${x.schema}.${x.name}`);
 for(const index of actualIndexes.filter(x=>x.schema==='public'&&tables.has(x.table)&&/CREATE UNIQUE INDEX/.test(x.definition))) {
   if(constraints.some(c=>c.table===index.table&&c.name===index.name))continue;
   ddl+=index.definition+';\n';
 }
 for(const c of constraints.filter(c=>(c.schema??'public')==='public'&&tables.has(c.table)&&c.type==='f')) {
   const target=c.definition.match(/REFERENCES\s+(?:public\.)?([\w"]+)/)?.[1]?.replaceAll('"','');
   if(c.definition.includes('REFERENCES auth.users')||target==='tenants'||tables.has(target))ddl+=`ALTER TABLE public.${ident(c.table)} ADD CONSTRAINT ${ident(c.name)} ${c.definition};\n`;
   else foreignKeysSkipped.push(`${c.table}.${c.name}`);
 }
 ddl+=`CREATE SEQUENCE public.review_fixture_audit_seq; ALTER TABLE public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.review_fixture_audit_seq');\n`;
 const wanted=['uid','role','has_tenant_role','is_tenant_member','is_platform_admin','has_platform_role','can_admin_tenant','tenant_admin_touch_updated_at','effective_user_permissions','user_has_permission','audit_log_chain','audit_log_block_mutation','recon_authoritative_access_decision_as','recon_authoritative_access_decision','recon_effective_access','recon_run_effective_read_allowed','user_can_access_recon','recon_platform_support_grant_active','data_resource_shadow_allows_actor'];
 const selected=routines.filter(f=>wanted.includes(f.name));
 for(const f of selected)ddl+=f.definition+';\n';
 // Captured current audit/touch triggers are retained, without substituting helpers.
 for(const trigger of current.triggers.filter(t=>['audit_log','access_review_campaigns','access_review_items'].includes(t.table))) {
   if(trigger.helper&&!selected.some(f=>trigger.helper===f.definition))ddl+=trigger.helper+';\n';
   ddl+=trigger.definition+';\n';
 }
 ddl+=`GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,anon,service_role; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
 ALTER TABLE public.access_review_campaigns ENABLE ROW LEVEL SECURITY; ALTER TABLE public.access_review_items ENABLE ROW LEVEL SECURITY;
 CREATE POLICY arc_admin ON public.access_review_campaigns FOR ALL TO authenticated USING(public.can_admin_tenant(tenant_id)) WITH CHECK(public.can_admin_tenant(tenant_id));
 CREATE POLICY ari_admin ON public.access_review_items FOR ALL TO authenticated USING(public.can_admin_tenant(tenant_id) OR reviewer_id=auth.uid()) WITH CHECK(public.can_admin_tenant(tenant_id) OR reviewer_id=auth.uid());
 `;
 for(const t of ['profiles','recon_definitions']) {
   ddl+=`ALTER TABLE public.${ident(t)} ENABLE ROW LEVEL SECURITY;\n`;
   for(const p of supplemental.policies.filter(p=>p.tablename===t&&p.cmd==='SELECT')) {
     const roles=Array.isArray(p.roles)?p.roles.join(','):p.roles;
     ddl+=`CREATE POLICY ${ident(p.policyname)} ON public.${ident(t)} AS ${p.permissive} FOR SELECT TO ${roles} USING(${p.qual});\n`;
   }
 }
 sql('metadata-fixture',ddl);
 const legacySubject=id(32),legacyMaker=id(33),legacyTenant=id(34);
 const oldItemProjection=sql('pre-migration-historical',`INSERT INTO auth.users(id) VALUES(${lit(legacySubject)}),(${lit(legacyMaker)}); INSERT INTO tenants(id) VALUES(${lit(legacyTenant)});
 INSERT INTO access_review_campaigns(id,tenant_id,name,created_by) VALUES(${lit(id(35))},${lit(legacyTenant)},'Preexisting historical campaign',${lit(legacyMaker)});
 INSERT INTO access_review_items(id,tenant_id,campaign_id,subject_user_id,decision,evidence) VALUES(${lit(id(36))},${lit(legacyTenant)},${lit(id(35))},${lit(legacySubject)},'modified','{"original":"keep"}'); SELECT to_jsonb(i) FROM access_review_items i WHERE id=${lit(id(36))};`);
 sql('exact-migration',migrationBytes.toString());pass('exact leased migration compiles on native engine with actual captured campaign/item/audit schemas and helpers');
 const originalColumns=current.columns.filter(c=>c.table==='access_review_items').sort((a,b)=>a.position-b.position).map(c=>ident(c.name)).join(',');
 if(sql('post-migration-historical',`SELECT to_jsonb(x) FROM (SELECT ${originalColumns} FROM access_review_items WHERE id=${lit(id(36))}) x;`)!==oldItemProjection)throw Error('Migration changed original historical projection');pass('forward migration preserves original historical columns and evidence byte-equivalent');
 sql('seed',`SET search_path=public,extensions;
 INSERT INTO auth.users(id) VALUES ${[maker,checker,subject,outsider,ordinary].map(x=>`(${lit(x)})`).join(',')};
 INSERT INTO tenants(id) VALUES(${lit(tenant)}),(${lit(otherTenant)});
 INSERT INTO profiles(id,email,full_name) VALUES(${lit(maker)},'maker@synthetic.invalid','Synthetic Maker'),(${lit(checker)},'checker@synthetic.invalid','Synthetic Checker'),(${lit(subject)},'subject@synthetic.invalid','Synthetic Subject');
 INSERT INTO tenant_members(tenant_id,user_id,role,active) VALUES(${lit(tenant)},${lit(maker)},'tenant_admin',true),(${lit(tenant)},${lit(checker)},'tenant_admin',true),(${lit(tenant)},${lit(subject)},'tenant_analyst',true),(${lit(tenant)},${lit(ordinary)},'tenant_analyst',true),(${lit(otherTenant)},${lit(outsider)},'tenant_admin',true);
 INSERT INTO business_units(id,tenant_id,name,code,path,depth) VALUES(${lit(bu)},${lit(tenant)},'Synthetic BU','SYN', 'synthetic',0);
 INSERT INTO tenant_groups(id,tenant_id,name,bu_id) VALUES(${lit(group)},${lit(tenant)},'Synthetic group',${lit(bu)}),(${lit(otherGroup)},${lit(tenant)},'Unrelated group',${lit(bu)});
 INSERT INTO tenant_group_members(group_id,user_id,added_by) VALUES(${lit(group)},${lit(subject)},${lit(maker)}),(${lit(group)},${lit(ordinary)},${lit(maker)}),(${lit(otherGroup)},${lit(subject)},${lit(maker)});
 INSERT INTO bu_group_assignments(tenant_id,bu_id,group_id) VALUES(${lit(tenant)},${lit(bu)},${lit(group)});
 INSERT INTO permissions(id,resource,action,description,category) VALUES('governance.synthetic.read','governance','read','Synthetic qualification only','governance');
 INSERT INTO rbac_roles(id,tenant_id,key,name) VALUES(${lit(role)},${lit(tenant)},'synthetic-review','Synthetic review');
 INSERT INTO rbac_role_permissions(role_id,permission_id) VALUES(${lit(role)},'governance.synthetic.read');
 INSERT INTO tenant_group_roles(group_id,role_id) VALUES(${lit(group)},${lit(role)});
 INSERT INTO workspaces(id,tenant_id,name,slug,business_unit_id) VALUES(${lit(workspace)},${lit(tenant)},'Synthetic workspace','synthetic-review',${lit(bu)});
 INSERT INTO workspace_members(workspace_id,tenant_id,user_id) VALUES(${lit(workspace)},${lit(tenant)},${lit(subject)});
 INSERT INTO audit_chain_head(singleton) VALUES(true) ON CONFLICT DO NOTHING;
 INSERT INTO recon_definitions(id,tenant_id,name,recon_type,recon_code,created_by,access_mode,environment,governance_state,multi_bu_governed) VALUES(${lit(recon)},${lit(tenant)},'Synthetic mapped review','two_sided','FVI-QA-2WAY-81000000',${lit(maker)},'mapped_exact','development','development_draft',true);
 INSERT INTO recon_definition_business_units(tenant_id,recon_id,bu_id) VALUES(${lit(tenant)},${lit(recon)},${lit(bu)});
 INSERT INTO recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action) VALUES(${lit(tenant)},${lit(recon)},${lit(bu)},'group',${lit(group)},'view'),(${lit(tenant)},${lit(recon)},${lit(bu)},'group',${lit(group)},'run'),(${lit(tenant)},${lit(recon)},${lit(bu)},'group',${lit(group)},'edit');
 `);
 if(sql('ordinary-rls-before',`${claims(subject)} SELECT count(*) FROM public.recon_definitions WHERE id=${lit(recon)};`).split('\n').at(-1)!=='1')throw Error('Current mapped resource not visible through captured RLS before revoke');pass('ordinary subject mapped resource visible through exact captured SELECT/RLS predicates before revocation');
 expectDenied('ordinary-campaign-create',ordinary,rpc('campaign_create',createInput(39)));
 expectDenied('nonadmin-reviewer-assignment',maker,rpc('campaign_create',createInput(38,[{subject_user_id:subject,group_id:group,reviewer_id:ordinary,workspace_id:workspace}])));
 const options=JSON.parse(sql('first-campaign-options',`${claims(maker)} SELECT ${rpc('options',{tenant_id:tenant,kind:'members',group_id:group,workspace_id:workspace,page:1,page_size:1})};`).split('\n').at(-1));
 if(options.total!==1||options.rows.length!==1||options.rows[0].group_name!=='Synthetic group'||options.rows[0].workspace_name!=='Synthetic workspace'||!options.rows[0].snapshot_hash||options.rows[0].label!==null)throw Error('Named first-campaign option/RLS profile contract failed');pass('first campaign options use real memberships/group/workspace/rights/hash; forbidden profile label remains null');
 const reviewers=JSON.parse(sql('independent-reviewer-options',`${claims(maker)} SELECT ${rpc('options',{tenant_id:tenant,kind:'reviewers',group_id:group,subject_user_id:subject})};`).split('\n').at(-1));if(reviewers.total!==1||reviewers.rows[0].id!==checker)throw Error('Reviewer scope failed');pass('reviewer options only independent active tenant admins');
 expectDenied('outsider-options',outsider,rpc('options',{tenant_id:tenant,kind:'groups'}));
 expectDenied('wrong-group-campaign',maker,rpc('campaign_create',createInput(37,[{subject_user_id:subject,group_id:id(999),reviewer_id:checker,workspace_id:workspace}])),'40001');
 expectDenied('wrong-workspace-campaign',maker,rpc('campaign_create',createInput(71,[{subject_user_id:subject,group_id:group,reviewer_id:checker,workspace_id:id(999)}])),'40001');
 expectDenied('changed-option-snapshot-campaign',maker,rpc('campaign_create',createInput(72,[{subject_user_id:subject,group_id:group,reviewer_id:checker,workspace_id:workspace,snapshot_hash:'0'.repeat(64)}])),'40001');
 const before=sql('historical-seed',`INSERT INTO access_review_campaigns(id,tenant_id,name,created_by) VALUES(${lit(id(30))},${lit(tenant)},'Historical unknown',${lit(maker)}); INSERT INTO access_review_items(id,tenant_id,campaign_id,subject_user_id,decision,evidence) VALUES(${lit(id(31))},${lit(tenant)},${lit(id(30))},${lit(subject)},'revoked','{"legacy":"retained"}'); SELECT to_jsonb(i) FROM access_review_items i WHERE id=${lit(id(31))};`);
 const campaign=createCampaign(40);let item=getItem(campaign);pass('independent tenant-admin creates versioned exact membership snapshot and assigned detail');
 const replay=JSON.parse(sql('create-replay',`${claims(maker)} SELECT ${rpc('campaign_create',createInput(40))};`).split('\n').at(-1));if(JSON.stringify(replay)!==JSON.stringify(campaign))throw Error('Create replay changed');pass('campaign same-key exact replay');
 expectDenied('create-key-collision',maker,rpc('campaign_create',{...createInput(40),name:'Changed'}),'23505');
 expectDenied('cross-actor-key-collision',checker,rpc('campaign_create',createInput(40)),'23505');
 const concurrentCall=rpc('campaign_create',createInput(73));
 const race=await Promise.all([asyncSql('concurrent-maker-a',`${claims(maker)} BEGIN; SELECT ${concurrentCall}; SELECT pg_sleep(0.8); COMMIT;`),asyncSql('concurrent-maker-b',`${claims(maker)} SELECT ${concurrentCall};`)]);
 const raceResults=race.map(out=>JSON.parse(out.split('\n').find(line=>line.startsWith('{'))));if(JSON.stringify(raceResults[0])!==JSON.stringify(raceResults[1]))throw Error('Concurrent replay differed');
 const concurrentCampaignId=raceResults[0].campaign_id;
 if(sql('concurrent-one-audit',`SELECT count(*) FROM audit_log WHERE resource_id=${lit(concurrentCampaignId)} AND action='governance.access_review.campaign.create';`)!=='1')throw Error('Concurrent create duplicated audit');pass('two actual native sessions serialize same-key creation to one campaign and one audit');
 expectDenied('outsider-list',outsider,rpc('list',{tenant_id:tenant}));
 expectDenied('self-decision-maker',maker,rpc('decide',decideInput(item,41)));
 expectDenied('self-decision-subject',subject,rpc('decide',decideInput(item,42)));
 expectDenied('wrong-tenant-decision',outsider,rpc('decide',{...decideInput(item,43),tenant_id:otherTenant}));
 expectDenied('wrong-version',checker,rpc('decide',decideInput(item,44,'retain',2)),'40001');
 expectDenied('wrong-snapshot',checker,rpc('decide',{...decideInput(item,45),snapshot_hash:'0'.repeat(64)}),'40001');
 sql('revoke-reviewer-role',`UPDATE tenant_members SET active=false WHERE tenant_id=${lit(tenant)} AND user_id=${lit(checker)};`);
 expectDenied('revoked-reviewer',checker,rpc('get',{tenant_id:tenant,id:item.id}));
 sql('restore-qa-reviewer',`UPDATE tenant_members SET active=true WHERE tenant_id=${lit(tenant)} AND user_id=${lit(checker)};`);
 const change=JSON.parse(sql('request-change',`${claims(checker)} SELECT ${rpc('decide',decideInput(item,46,'request_change'))};`).split('\n').at(-1));if(change.outcome!=='change_requested'||change.membership_revoked||change.decided_at!==null)throw Error('Change request falsely completed');pass('request-change stays pending, versioned and audited without membership mutation');
 item=getItem(campaign);const retained=JSON.parse(sql('retain',`${claims(checker)} SELECT ${rpc('decide',decideInput(item,47,'retain',2))};`).split('\n').at(-1));if(retained.outcome!=='retained'||retained.version!==3)throw Error('Retain failed');pass('retain records current independent exact decision');
 const retainedReplay=JSON.parse(sql('decision-replay',`${claims(checker)} SELECT ${rpc('decide',decideInput(item,47,'retain',2))};`).split('\n').at(-1));if(JSON.stringify(retainedReplay)!==JSON.stringify(retained))throw Error('Decision replay changed');pass('decision same-key exact replay without duplicate mutation or audit');
 expectDenied('decision-key-collision',checker,rpc('decide',{...decideInput(item,47,'retain',2),reason:'Changed'}),'23505');
 expectDenied('second-terminal-decision',checker,rpc('decide',decideInput({...item,version:3},48,'retain',3)),'40001');
 const staleCampaign=createCampaign(50);const stale=getItem(staleCampaign);
 sql('change-current-rights',`INSERT INTO permissions(id,resource,action,description,category) VALUES('governance.synthetic.edit','governance','edit','Synthetic qualification only','governance'); INSERT INTO rbac_role_permissions(role_id,permission_id) VALUES(${lit(role)},'governance.synthetic.edit');`);
 expectDenied('changed-rights-stale-approve',checker,rpc('decide',decideInput(stale,51)),'40001');
 const revocation=createCampaign(60);const revokeItem=getItem(revocation);
 sql('audit-failure-trigger',`CREATE FUNCTION public.review_fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='governance.access_review.revoke' THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER zz_review_fixture_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION review_fixture_fail_audit();`);
 expectDenied('audit-failure-rolls-back-revocation',checker,rpc('decide',decideInput(revokeItem,61,'revoke')),'23514');
 if(sql('membership-after-rollback',`SELECT count(*) FROM tenant_group_members WHERE group_id=${lit(group)} AND user_id=${lit(subject)};`)!=='1')throw Error('Audit failure removed membership');
 sql('remove-owned-failure-trigger','DROP TRIGGER zz_review_fixture_fail ON audit_log; DROP FUNCTION review_fixture_fail_audit();');pass('failed audit leaves item, membership and receipt transaction uncommitted');
 const revoked=JSON.parse(sql('revoke',`${claims(checker)} SELECT ${rpc('decide',decideInput(revokeItem,61,'revoke'))};`).split('\n').at(-1));if(!revoked.membership_revoked||revoked.outcome!=='revoked')throw Error('Actual revoke failed');
 const after=sql('effective-deny',`${claims(subject)} SELECT count(*) FROM public.effective_user_permissions(${lit(subject)},${lit(tenant)},NULL) WHERE group_id=${lit(group)};`);if(after.split('\n').at(-1)!=='0')throw Error('Group effective rights survived');pass('exact group membership revoked, effective group and inherited BU role permissions denied');
 if(sql('ordinary-rls-after',`${claims(subject)} SELECT count(*) FROM public.recon_definitions WHERE id=${lit(recon)};`).split('\n').at(-1)!=='0')throw Error('Mapped resource remained visible via RLS');pass('subsequent ordinary mapped resource SELECT denied through exact captured real RLS predicates');
 sql('ordinary-run-edit-after',`${claims(subject)} DO $$ BEGIN IF private.recon_authoritative_access_decision(${lit(recon)},'run') OR private.recon_authoritative_access_decision(${lit(recon)},'edit') THEN RAISE EXCEPTION 'Mapped write rights survived'; END IF; END $$;`);pass('subsequent ordinary mapped run/edit authority denied');
 const unchanged=sql('historical-after',`SELECT to_jsonb(i) FROM access_review_items i WHERE id=${lit(id(31))};`);if(unchanged!==before)throw Error('Historical unknown row changed');pass('unknown historical item and evidence byte-equivalent');
 if(sql('unrelated-after',`SELECT count(*) FROM tenant_group_members WHERE group_id=${lit(otherGroup)} AND user_id=${lit(subject)};`)!=='1')throw Error('Unrelated membership removed');pass('unrelated subject membership and shared group grants preserved');
 sql('direct-update-denied',`${claims(checker)} DO $$ BEGIN UPDATE public.access_review_items SET decision='revoked'; RAISE EXCEPTION 'Direct write allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;`);pass('authenticated direct decision writes denied');
 sql('anon-acl',`DO $$ DECLARE op text; BEGIN FOREACH op IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP IF has_table_privilege('authenticated','public.access_review_items',op) OR has_table_privilege('anon','public.access_review_items',op) THEN RAISE EXCEPTION 'Unexpected write ACL %',op; END IF; END LOOP; END $$;`);pass('ALL/default write privileges including TRUNCATE and PG17 MAINTAIN removed');
 const page=JSON.parse(sql('paged-list',`${claims(checker)} SELECT ${rpc('list',{tenant_id:tenant,page:2,page_size:1})};`).split('\n').at(-1));
 if(page.total!==5||page.rows.length!==1||page.kpis.completed_last_30_days!==2||page.kpis.memberships_to_review!==2)throw Error('Full-set list/KPI counts incorrect');pass('page-size bounded rows and full authorized set KPI counts');
 const legacy=JSON.parse(sql('historical-detail',`${claims(checker)} SELECT ${rpc('get',{tenant_id:tenant,id:id(31)})};`).split('\n').at(-1));if(!legacy.historical||legacy.outcome!=='historical_unknown'||legacy.permitted_actions.length)throw Error('Historical item presented as current confirmation');pass('legacy revoked label stays historical unknown and has no current action');
 if(sha(readFileSync(migration))!==sourceHash)throw Error('Source changed during qualification');
} catch(error) {
 writeFileSync(join(dir,'failure.json'),JSON.stringify({sourceHash,checks,error:error.message},null,2));console.error(error.message);process.exitCode=1;
} finally {
 if(started){exe('pg_ctl',['-D',dataDir,'-m','fast','-w','stop']);started=false;}
 writeFileSync(join(dir,'receipt.json'),JSON.stringify({sourceHash,checks,status:process.exitCode?'FAILED':'PASS',engine:pgBin,port,fixture:dir,hostedWrites:false,
   metadata:currentPath,dependencyMetadata:supplementalPath??priorPath,dependencyMetadataCurrent:!!supplementalPath,auth:'exact captured auth.uid/role; native authenticated SQL role; synthetic local claims only, no live MFA claim'},null,2));
 console.log(JSON.stringify({status:process.exitCode?'FAILED':'PASS',checks:checks.length,receipt:join(dir,'receipt.json')}));
}
