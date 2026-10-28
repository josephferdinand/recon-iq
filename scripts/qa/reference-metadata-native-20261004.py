"""Isolated PG17 semantic proof from current readonly helper/column metadata.
Local synthetic role claims are fixture inputs, never hosted JWT/MFA evidence.
No remote connection, no shared cluster, and no deletion of retained evidence.
"""
import os, pathlib, json, hashlib, socket, subprocess, tempfile, psycopg2
from psycopg2.extras import Json

canonical=pathlib.Path.cwd().resolve()
assert canonical.name=='ReconIQ'
lane=canonical/'scripts/qa/output/reference-metadata-contract-20261003'
private=pathlib.Path(os.environ['LOCALAPPDATA'])/'FVI-QA-Private-20260925/reference-metadata-contract-20261003'
catalog=json.loads((private/'PROD-catalog.json').read_text())['rows'][0]['catalog']
proposal=(lane/'PROPOSED_reference_table_view_summary.sql').read_text()
binpath=pathlib.Path('C:/Program Files/PostgreSQL/17/bin')
cluster=pathlib.Path(tempfile.mkdtemp(prefix='fvi-reference-metadata-pg17-20261004-'))
data=cluster/'pgdata'
with socket.socket() as s:
    s.bind(('127.0.0.1',0));port=s.getsockname()[1]
def run(args):
    if pathlib.Path(str(args[0])).name=='pg_ctl.exe':
        # Background postgres retains inherited pipe handles on Windows. Use a
        # file for control output so communicate() cannot wait on the server.
        with (cluster/'pg-control.log').open('a') as log:
            r=subprocess.run([str(x) for x in args],stdout=log,stderr=log,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
        if r.returncode:raise RuntimeError('Local PG17 control failed; exact cluster logs retained: '+str(cluster))
        return ''
    r=subprocess.run([str(x) for x in args],capture_output=True,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
    if r.returncode:raise RuntimeError('Local PG17 command failed; logs retained: '+str(cluster))
    return r.stdout
run([binpath/'initdb.exe','-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
run([binpath/'pg_ctl.exe','-D',data,'-l',cluster/'server.log','-o',f'-h 127.0.0.1 -p {port} -F','-w','start'])
conn=None;checks=[]
def check(label,ok,detail=None):
    checks.append({'label':label,'pass':bool(ok),'detail':detail})
    if not ok:raise AssertionError(label)
try:
    conn=psycopg2.connect(host='127.0.0.1',port=port,user='postgres',dbname='postgres');conn.autocommit=True
    cur=conn.cursor()
    cur.execute('SELECT current_setting(\'data_directory\'),current_setting(\'server_version\')')
    actual,engine=cur.fetchone();assert pathlib.Path(actual).resolve()==data.resolve() and engine.startswith('17.')
    cur.execute("CREATE SCHEMA auth;CREATE SCHEMA private;CREATE EXTENSION ltree;CREATE TYPE public.tenant_role AS ENUM ('tenant_admin','tenant_analyst','tenant_viewer');CREATE TYPE public.bu_role AS ENUM ('bu_admin','bu_member');CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;")
    # Exact current column names/types projected for predicate semantics. Full
    # migration/constraint/trigger parity is not claimed by this isolated fixture.
    tables={}
    for col in catalog['columns']:tables.setdefault(col['table'],[]).append(col)
    for name,cols in tables.items():
        cur.execute('CREATE TABLE public."'+name+'" ('+','.join('"'+c['name']+'" '+c['type'] for c in cols)+')')
    for h in catalog['helpers']:
        if h['schema']=='auth' or h['name'] in ['data_resource_shadow_allows_actor','reference_scope_allows','get_data_resource_access_summary']:
            cur.execute(h['definition'])
    # Auth UID/role routines are the actual provider definitions, not new tokens.
    for h in catalog['helpers']:
        if h['name'] in ['reference_scope_allows','data_resource_shadow_allows_actor']:
            cur.execute("SELECT md5(replace(pg_get_functiondef(%s::regprocedure),E'\\r\\n',E'\\n'))",(h['schema']+'.'+h['name']+(' (uuid,text)' if h['name']=='reference_scope_allows' else ' (uuid,uuid,text)'),))
            check('exact current predicate preimage '+h['name'],cur.fetchone()[0]==h['md5'])
    def uid(n):return '00000000-0000-4000-8000-'+str(n).zfill(12)
    t1,t2=uid(1),uid(2);admin,finance,direct,viewer,inactive,cross,platform=[uid(n) for n in range(11,18)]
    root,child,ops=[uid(n) for n in range(21,24)];fg,og,editg=[uid(n) for n in range(31,34)]
    legacy,mapped,pending,foreign,unmapped=[uid(n) for n in range(41,46)];lr,mr,fr=[uid(n) for n in range(51,54)]
    def insert(table,values):
        cur.execute('INSERT INTO public."'+table+'" ('+','.join('"'+k+'"' for k in values)+') VALUES ('+','.join(['%s']*len(values))+')',list(values.values()))
    for a,role,active,tenant in [(admin,'tenant_admin',True,t1),(finance,'tenant_analyst',True,t1),(direct,'tenant_analyst',True,t1),(viewer,'tenant_viewer',True,t1),(inactive,'tenant_admin',False,t1),(cross,'tenant_admin',True,t2)]:
        insert('tenant_members',{'tenant_id':tenant,'user_id':a,'role':role,'active':active})
    for b,name,bpath in [(root,'Finance','finance'),(child,'Finance child','finance.child'),(ops,'Operations','ops')]:insert('business_units',{'id':b,'tenant_id':t1,'name':name,'path':bpath,'is_archived':False})
    for g,name in [(fg,'Finance viewers'),(og,'Operations viewers'),(editg,'Privileged editors')]:insert('tenant_groups',{'id':g,'tenant_id':t1,'name':name})
    insert('tenant_group_members',{'group_id':fg,'user_id':finance})
    insert('bu_group_assignments',{'id':uid(60),'tenant_id':t1,'bu_id':root,'group_id':fg,'inherit_descendants':True})
    insert('bu_group_assignments',{'id':uid(61),'tenant_id':t1,'bu_id':ops,'group_id':og,'inherit_descendants':False})
    insert('bu_user_assignments',{'tenant_id':t1,'bu_id':root,'user_id':direct,'inherit_descendants':True})
    for table,name,mode,tenant in [(legacy,'Legacy declared scope','legacy_passthrough',t1),(mapped,'Exact mapped scope','mapped_exact',t1),(pending,'Pending admin-only','unmapped_pending',t1),(foreign,'Foreign tenant','legacy_passthrough',t2),(unmapped,'Legacy no invented scope','legacy_passthrough',t1)]:
        insert('reference_data_tables',{'id':table,'tenant_id':tenant,'name':name,'public_id':'QA-'+name,'access_mode':mode})
    for rid,table,tenant in [(lr,legacy,t1),(mr,mapped,t1),(fr,foreign,t2)]:insert('data_resource_registry',{'id':rid,'tenant_id':tenant,'resource_type':'reference_table','reference_table_id':table})
    for rid,bu in [(lr,root),(mr,child),(mr,ops)]:insert('data_resource_registry_owner_bu',{'tenant_id':t1,'registry_id':rid,'bu_id':bu})
    grant_rows=[]
    for gid,rid,bu,kind,user,group,action in [(uid(71),lr,root,'group',None,fg,'view'),(uid(72),lr,root,'group',None,editg,'edit'),(uid(73),mr,child,'group',None,fg,'view'),(uid(74),mr,ops,'group',None,og,'view'),(uid(75),mr,child,'user',direct,None,'view')]:
        row={'id':gid,'tenant_id':t1,'registry_id':rid,'bu_id':bu,'principal_type':kind,'principal_user_id':user,'principal_group_id':group,'action':action};grant_rows.append(row);insert('data_resource_registry_grants',row)
    cur.execute('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated,anon,service_role;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC,authenticated,anon,service_role;GRANT EXECUTE ON FUNCTION public.reference_scope_allows(uuid,text),public.get_data_resource_access_summary(text,uuid[]) TO authenticated;')
    def actor(a,role='authenticated'):
        cur.execute('RESET ROLE');cur.execute("SELECT set_config('request.jwt.claim.sub',%s,false),set_config('request.jwt.claim.role',%s,false),set_config('request.jwt.claims',%s,false)",(a or '',role,json.dumps({'sub':a,'role':role})))
        cur.execute('SET ROLE '+role)
    def summary(a,tenant,ids):
        actor(a);cur.execute('SELECT coalesce(jsonb_agg(to_jsonb(x)),\'[]\'::jsonb) FROM public.get_reference_table_view_summary(%s,%s::uuid[]) x',(tenant,ids));return cur.fetchone()[0]
    def denied(a,tenant,ids,role='authenticated',code='42501'):
        actor(a,role)
        try:cur.execute('SELECT * FROM public.get_reference_table_view_summary(%s,%s::uuid[])',(tenant,ids));return False
        except psycopg2.Error as e:return e.pgcode==code
    def actions():
        out={}
        for a in [admin,finance,direct,viewer,inactive,cross,platform]:
            actor(a);cur.execute("SELECT id,action,public.reference_scope_allows(id,action) FROM (VALUES (%s::uuid),(%s::uuid),(%s::uuid)) t(id) CROSS JOIN (VALUES ('view'),('ingest'),('edit'),('manage'),('approve')) a(action) ORDER BY id,action",(legacy,mapped,pending));out[a]=cur.fetchall()
        return out
    before_actions=actions();cur.execute('RESET ROLE')
    def state_hash():
        rows={}
        for table in ['tenant_members','tenant_group_members','bu_user_assignments','bu_group_assignments','reference_data_tables','data_resource_registry','data_resource_registry_grants','data_resource_registry_owner_bu']:
            cur.execute('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),\'[]\'::jsonb) FROM public."'+table+'" x');rows[table]=cur.fetchone()[0]
        return hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
    before_hash=state_hash();actor(viewer);cur.execute("SELECT public.reference_scope_allows(%s,'view'),(SELECT count(*) FROM public.get_data_resource_access_summary('reference_table',ARRAY[%s::uuid]))",(legacy,legacy));old_view,old_count=cur.fetchone();check('reproduces actual legacy content/metadata mismatch',old_view and old_count==0)
    cur.execute('RESET ROLE');cur.execute(proposal)
    v=summary(viewer,t1,[legacy])[0];check('legacy viewer receives actual owner metadata',v['business_unit_names']==['Finance']);check('legacy viewer receives only declared view group names',v['user_group_names']==['Finance viewers']);check('no legacy role or privilege grant introduced',before_actions==actions())
    cur.execute('RESET ROLE');check('all projected business/identity/mapping records preserved',before_hash==state_hash(),before_hash)
    for a in [finance,direct]:
        v=summary(a,t1,[mapped])[0];check('mapped reader sees only qualifying owning BU '+a,v['business_unit_names']==['Finance child']);check('mapped reader group metadata respects direct versus group grant '+a,v['user_group_names']==(['Finance viewers'] if a==finance else []))
    v=summary(admin,t1,[mapped])[0];check('tenant admin actual two-owner metadata',v['business_unit_names']==['Finance child','Operations']);check('tenant admin actual group metadata',v['user_group_names']==['Finance viewers','Operations viewers'])
    check('view-only member cannot see mapped table without grant',summary(viewer,t1,[mapped])==[]);check('unmapped pending root remains admin-only',summary(viewer,t1,[pending])==[]);check('unmapped pending admin remains readable',len(summary(admin,t1,[pending]))==1)
    v=summary(viewer,t1,[unmapped])[0];check('unmapped legacy has no invented owner/group',v['access_state']=='unmapped' and v['business_unit_names']==[] and v['user_group_names']==[])
    check('unknown table ID has no existence/metadata leak',summary(viewer,t1,[uid(999)])==[]);check('batch deduplicates and excludes unauthorized roots',len(summary(viewer,t1,[legacy,legacy,mapped,foreign]))==1)
    check('wrong-tenant root never leaks metadata',summary(cross,t2,[legacy])==[]);check('inactive tenant admin denied',denied(inactive,t1,[legacy]));check('platform-only actor gains no membership override',denied(platform,t1,[legacy]));check('missing current actor denied',denied(None,t1,[legacy]));check('anon execution denied',denied(viewer,t1,[legacy],role='anon'));check('service role execution denied',denied(viewer,t1,[legacy],role='service_role'))
    for label,ids in [('empty',[]),('null',None),('null-entry',[None]),('oversized',[legacy]*101),('multi-dimension',[[legacy,mapped]])]:check('bounded invalid metadata input '+label,denied(viewer,t1,ids,code='22023'))
    cur.execute('RESET ROLE');cur.execute('DELETE FROM public.data_resource_registry_grants WHERE id=%s',(uid(73),));check('current own group grant revocation denies mapped metadata',summary(finance,t1,[mapped])==[]);cur.execute('RESET ROLE');insert('data_resource_registry_grants',grant_rows[2]);check('restored same grant recovers exact mapping',summary(finance,t1,[mapped])[0]['business_unit_names']==['Finance child'])
    cur.execute('RESET ROLE');cur.execute('UPDATE public.bu_group_assignments SET inherit_descendants=false WHERE id=%s',(uid(60),));check('non-inherited parent group does not authorize child',summary(finance,t1,[mapped])==[]);cur.execute('RESET ROLE');cur.execute('UPDATE public.bu_group_assignments SET inherit_descendants=true WHERE id=%s',(uid(60),))
    cur.execute('UPDATE public.business_units SET is_archived=true WHERE id=%s',(root,));check('archived assigned BU denies effective mapped path',summary(finance,t1,[mapped])==[]);cur.execute('RESET ROLE');cur.execute('UPDATE public.business_units SET is_archived=false WHERE id=%s',(root,))
    actor(finance)
    try:cur.execute('SELECT * FROM public.data_resource_registry_grants');raw_denied=False
    except psycopg2.Error as e:raw_denied=e.pgcode=='42501'
    check('raw registry table ACL remains denied',raw_denied);cur.execute('RESET ROLE');check('final all fixture history restored',before_hash==state_hash());check('final all write/read decisions unchanged',before_actions==actions());cur.execute('RESET ROLE')
    try:cur.execute(proposal);duplicate_denied=False
    except psycopg2.Error as e:duplicate_denied='already exists' in str(e);cur.execute('ROLLBACK')
    check('exact existing new helper is not blindly overwritten',duplicate_denied)
    receipt={'at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'status':'NATIVE_PG17_REFERENCE_METADATA_PASS','engine':engine,'cluster':str(cluster),'port':port,'proposal_sha256':hashlib.sha256(proposal.encode()).hexdigest(),'catalog_helpers':'actual readonly PROD448/DEV426 predicates; column projection','auth_tier':'LOCAL fixture role claims only; not hosted JWT/MFA','checks':checks,'scope':'No remote SQL or business operations; new metadata-only function; existing ACL/policy/record/permission decisions unchanged'}
    (lane/'NATIVE_PG17_RESULT.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({'status':receipt['status'],'checks':len(checks),'engine':engine,'receipt':str(lane/'NATIVE_PG17_RESULT.json')}))
finally:
    if conn:conn.close()
    # This exact freshly-created data directory is the only process we stop.
    assert data.resolve().parent==cluster.resolve() and cluster.name.startswith('fvi-reference-metadata-pg17-20261004-')
    run([binpath/'pg_ctl.exe','-D',data,'-m','fast','-w','stop'])
