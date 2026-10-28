"""Owned native-PG17 catalog qualification; no network/credential/business-row capture.

Uses fresh governance catalogs and hash-pinned metadata-only assignment dependency
scaffolds. Auth helpers, function owners, RLS, constraints and audit triggers are real
captured definitions. Subjects/tenants are explicitly synthetic local QA fixtures.
No AAL claim is set or MFA success inferred from PostgreSQL session claims.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import uuid
import psycopg2
from psycopg2 import sql
from psycopg2.extras import register_uuid
register_uuid()

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = Path('./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925')
METADATA = Path('E:/Falcon Group Projects/Cloud Data/Secured Key Vault')
BIN = Path(os.environ.get('FVI_MEMBERSHIP_PG_BIN', 'C:/Program Files/PostgreSQL/17/bin'))
RUN = Path(tempfile.mkdtemp(prefix='fvi-governance-membership-pg17-'))
DATA = RUN / 'pgdata'
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    PORT = listener.getsockname()[1]
CHECKS = []
RECEIPT = {'status': 'RUNNING', 'directory': str(RUN), 'port': PORT, 'hosted_writes': False,
           'synthetic_local_subjects': True, 'auth_helpers_stubbed': False, 'mfa_claimed': False,
           'checks': CHECKS, 'catalogs': []}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def command(name, *args):
    r = subprocess.run([str(BIN / (name + '.exe')), *map(str, args)], capture_output=True,
                       text=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    (RUN / (name + '.log')).write_text(r.stdout + r.stderr, encoding='utf8')
    if r.returncode:
        raise RuntimeError(f'{name} failed; retained log {RUN / (name + ".log")}')
    return r.stdout

def connect(db):
    return psycopg2.connect(host='127.0.0.1', port=PORT, dbname=db, user='fvi_fixture_bootstrap', connect_timeout=5)

def execute(conn, query, params=None):
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchone()[0] if cur.description else None

def check(label, condition):
    if not condition:
        raise AssertionError(label)
    CHECKS.append(label)

def caller(conn, actor):
    execute(conn, 'RESET ROLE; SET ROLE authenticated')
    execute(conn, "SELECT set_config('request.jwt.claims',%s,false)", (json.dumps({'sub': str(actor), 'role': 'authenticated'}),))

def owner(conn):
    execute(conn, 'RESET ROLE; SET ROLE postgres')

def denied(conn, label, query, params=(), code='42501'):
    try:
        execute(conn, query, params)
    except psycopg2.Error as error:
        check(label, error.pgcode == code)
    else:
        raise AssertionError(label + ': unexpectedly allowed')

def seed(conn, fresh):
    # Load synthetic rows before restoring captured triggers; zero remote rows.
    ids = {key: uuid.uuid4() for key in ['tenant','other_tenant','bu','other_bu','workspace','other_workspace',
             'requester','second_requester','checker','checker2','platform','outsider','role','group','second_group','sentinel_group']}
    owner(conn)
    for permission in fresh['permissions']:
        execute(conn, 'INSERT INTO public.permissions(id,resource,action,description,category,is_dangerous,requires_step_up) VALUES(%s,%s,%s,%s,%s,%s,%s)',
                [permission[k] for k in ['id','resource','action','description','category','is_dangerous','requires_step_up']])
    execute(conn, "INSERT INTO public.tenants(id,slug,name) VALUES(%s,'membership-qa','Membership QA'),(%s,'membership-other','Membership Other')", (ids['tenant'],ids['other_tenant']))
    for name in ['requester','second_requester','checker','checker2','platform','outsider']:
        execute(conn, 'INSERT INTO auth.users(id,email) VALUES(%s,%s)', (ids[name],name+'@membership-fixture.invalid'))
        execute(conn, 'INSERT INTO public.profiles(id,email,full_name) VALUES(%s,%s,%s)', (ids[name],name+'@membership-fixture.invalid',name))
        execute(conn, 'INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES(%s,%s,%s)',
                (ids['other_tenant'] if name=='outsider' else ids['tenant'], ids[name], 'tenant_admin' if name in ['checker','checker2'] else 'tenant_analyst'))
    execute(conn, "INSERT INTO public.platform_roles(user_id,role) VALUES(%s,'platform_admin')", (ids['platform'],))
    execute(conn, 'INSERT INTO public.business_units(id,tenant_id,name,path) VALUES(%s,%s,\'QA BU\',\'qa\'),(%s,%s,\'Other BU\',\'other\')', (ids['bu'],ids['tenant'],ids['other_bu'],ids['other_tenant']))
    execute(conn, 'INSERT INTO public.workspaces(id,tenant_id,name,slug,business_unit_id,department) VALUES(%s,%s,\'QA Workspace\',\'membership-qa\',%s,\'QA team\'),(%s,%s,\'Other Workspace\',\'other\',%s,NULL)', (ids['workspace'],ids['tenant'],ids['bu'],ids['other_workspace'],ids['other_tenant'],ids['other_bu']))
    execute(conn, "INSERT INTO public.tenant_environments(tenant_id,env,host) VALUES(%s,'dev','membership-fixture.invalid')", (ids['tenant'],))
    for name in ['requester','second_requester','platform']:
        execute(conn, 'INSERT INTO public.bu_user_assignments(tenant_id,bu_id,user_id) VALUES(%s,%s,%s)', (ids['tenant'],ids['bu'],ids[name]))
        execute(conn, 'INSERT INTO public.workspace_members(workspace_id,tenant_id,user_id) VALUES(%s,%s,%s)', (ids['workspace'],ids['tenant'],ids[name]))
    execute(conn, "INSERT INTO public.rbac_roles(id,tenant_id,key,name,is_system) VALUES(%s,%s,'qa_reader','Synthetic QA reader',false)", (ids['role'],ids['tenant']))
    execute(conn, "INSERT INTO public.rbac_role_permissions(role_id,permission_id) VALUES(%s,'audit.log.read')", (ids['role'],))
    for name in ['group','second_group','sentinel_group']:
        execute(conn, 'INSERT INTO public.tenant_groups(id,tenant_id,bu_id,name) VALUES(%s,%s,%s,%s)', (ids[name],ids['tenant'],ids['bu'],name))
        execute(conn, 'INSERT INTO public.tenant_group_roles(group_id,role_id) VALUES(%s,%s)', (ids[name],ids['role']))
        execute(conn, 'INSERT INTO public.bu_group_assignments(tenant_id,bu_id,group_id,inherit_descendants) VALUES(%s,%s,%s,false)', (ids['tenant'],ids['bu'],ids[name]))
    execute(conn, 'INSERT INTO public.tenant_group_members(group_id,user_id,added_by) VALUES(%s,%s,%s)', (ids['sentinel_group'],ids['checker2'],ids['checker']))
    return ids

def restore_current(conn, fresh, old):
    # Restore exact captured functions with libpq, preserving embedded CR/LF bodies.
    execute(conn, 'RESET ROLE; SET check_function_bodies=off; SET search_path=public,extensions,auth,private,pg_catalog')
    for f in old['functions']:
        execute(conn, f['definition'])
        execute(conn, sql.SQL('ALTER FUNCTION {}.{}({}) OWNER TO {}').format(
            sql.Identifier(f['schema']),sql.Identifier(f['name']),sql.SQL(f['identity']),sql.Identifier(f.get('owner','postgres'))))
    for f in fresh['helpers']:
        execute(conn, f['definition'])
        execute(conn, sql.SQL('ALTER FUNCTION {}.{}({}) OWNER TO {}').format(
            sql.Identifier(f['schema']),sql.Identifier(f['name']),sql.SQL(f['identity']),sql.Identifier(f.get('owner','postgres'))))
    for trigger in fresh['triggers']:
        execute(conn, trigger['helper'])
    for f in fresh['helpers']:
        actual = execute(conn, 'SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=%s AND p.proname=%s AND pg_get_function_identity_arguments(p.oid)=%s', (f['schema'],f['name'],f['identity']))
        check('exact raw current helper '+f['schema']+'.'+f['name'], actual == f['definition'])
    execute(conn, 'SET check_function_bodies=on')

def overlay_current(conn, fresh):
    # Current governance catalog supersedes the scaffold on the membership/audit tables.
    execute(conn, 'SET search_path=public,extensions,pg_catalog')
    for table in fresh['tables']:
        name = table['name']
        if name in ['access_review_campaigns','access_review_items','soc2_access_reviews']:
            continue  # Another backend's lease; not a membership dependency.
        expected = [c for c in fresh['columns'] if c['table']==name]
        actual = execute(conn, "SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=%s::regclass AND a.attnum>0 AND NOT a.attisdropped", ('public.'+name,))
        check('fresh column ABI '+name, [(c['name'],c['type'],c['not_null'],c['default']) for c in expected] == [(c['name'],c['type'],c['not_null'],c['default']) for c in actual])
        for constraint in [c for c in fresh['constraints'] if c['table']==name]:
            actual_definition = execute(conn, 'SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=%s::regclass AND conname=%s', ('public.'+name,constraint['name']))
            check('fresh constraint '+constraint['name'], actual_definition == constraint['definition'])
        execute(conn, sql.SQL('ALTER TABLE public.{} ENABLE ROW LEVEL SECURITY').format(sql.Identifier(name)))
        with conn.cursor() as cur:
            cur.execute('SELECT policyname FROM pg_policies WHERE schemaname=\'public\' AND tablename=%s', (name,))
            policies = [row[0] for row in cur.fetchall()]
        for p in policies:
            execute(conn, sql.SQL('DROP POLICY {} ON public.{}').format(sql.Identifier(p),sql.Identifier(name)))
        for p in [p for p in fresh['policies'] if p['tablename']==name]:
            statement = sql.SQL('CREATE POLICY {} ON public.{} AS {} FOR {} TO {}').format(sql.Identifier(p['policyname']),sql.Identifier(name),sql.SQL(p['permissive']),sql.SQL(p['cmd']),sql.SQL(',').join(sql.Identifier(r) if r!='public' else sql.SQL('PUBLIC') for r in p['roles']))
            if p['qual']:
                statement += sql.SQL(' USING ({})').format(sql.SQL(p['qual']))
            if p['with_check']:
                statement += sql.SQL(' WITH CHECK ({})').format(sql.SQL(p['with_check']))
            execute(conn, statement)
        for t in [t for t in fresh['triggers'] if t['table']==name]:
            execute(conn, sql.SQL('DROP TRIGGER IF EXISTS {} ON public.{}').format(sql.Identifier(t['name']),sql.Identifier(name)))
            execute(conn, t['definition'])

def extend_scaffold(conn, fresh):
    # Add only absent tables from the fresh metadata, with exact columns/defaults/constraints.
    execute(conn,'RESET ROLE; SET search_path=public,extensions,auth,private,pg_catalog')
    missing=[]
    # Exact earlier metadata-only FK target; no source-created substitute table.
    supporting=json.loads((METADATA/'FVI-PROD-APPLICATION-REPLICATION-CATALOG-POST-20261002-431.json').read_bytes())['catalog']
    extras=['data_resource_business_unit_owners']
    tables=fresh['tables']+[r for r in supporting['relations'] if r['schema']=='public' and r['name'] in extras]
    captured_columns=fresh['columns']+[c for c in supporting['columns'] if c['schema']=='public' and c['table'] in extras]
    constraints=fresh['constraints']+[c for c in supporting['constraints'] if c['schema']=='public' and c['table'] in extras]
    for table in tables:
        if execute(conn,'SELECT to_regclass(%s)',('public.'+table['name'],)) is not None:
            continue
        columns=[]
        for col in [c for c in captured_columns if c['table']==table['name']]:
            fragment=sql.Identifier(col['name'])+sql.SQL(' '+col['type'])
            if col['identity']:
                fragment+=sql.SQL(' GENERATED ALWAYS AS IDENTITY' if col['identity']=='a' else ' GENERATED BY DEFAULT AS IDENTITY')
            elif col['default']:
                fragment+=sql.SQL(' DEFAULT '+col['default'])
            if col['not_null']:
                fragment+=sql.SQL(' NOT NULL')
            columns.append(fragment)
        execute(conn,sql.SQL('CREATE TABLE public.{} ({})').format(sql.Identifier(table['name']),sql.SQL(',').join(columns)))
        execute(conn,sql.SQL('ALTER TABLE public.{} OWNER TO postgres').format(sql.Identifier(table['name'])))
        execute(conn,sql.SQL('GRANT ALL ON public.{} TO authenticated,service_role').format(sql.Identifier(table['name'])))
        missing.append(table['name'])
    for constraint in sorted([c for c in constraints if c['table'] in missing],key=lambda c:c['type']=='f'):
        execute(conn,sql.SQL('ALTER TABLE public.{} ADD CONSTRAINT {} {}').format(sql.Identifier(constraint['table']),sql.Identifier(constraint['name']),sql.SQL(constraint['definition'])))

def qualify(conn, ids, db):
    t,b,w,g = [str(ids[x]) for x in ['tenant','bu','workspace','group']]
    req,checker = str(ids['requester']),str(ids['checker'])
    submit = 'SELECT public.submit_governance_membership_request(%s,%s,%s,%s,%s,%s,%s)'
    decide = 'SELECT public.decide_governance_membership_request(%s,%s,%s,%s,%s,%s)'
    withdraw = 'SELECT public.withdraw_governance_membership_request(%s,%s,%s,%s,%s)'
    args = [t,b,w,g,'dev','Synthetic local access request',str(uuid.uuid4())]
    owner(conn)
    sentinel = execute(conn, "SELECT md5(row_to_json(gm)::text) FROM public.tenant_group_members gm WHERE group_id=%s AND user_id=%s", (str(ids['sentinel_group']),str(ids['checker2'])))
    caller(conn, req)
    options='SELECT public.list_governance_membership_options(%s,%s,%s,%s,%s,%s,%s,%s)'
    check('named eligible BU choices',execute(conn,options,[t,'bu',1,25,'QA',None,None,None])['rows'][0]['label']=='QA BU')
    check('named current workspace choices',execute(conn,options,[t,'workspace',1,25,'QA',b,None,None])['rows'][0]['id']==w)
    env_options=execute(conn,options,[t,'environment',1,25,'',None,None,None])
    check('only actual active environment registrations offered',len(env_options['rows'])==1 and env_options['rows'][0]['environment']=='dev')
    group_options=execute(conn,options,[t,'group',1,25,'',b,w,None])
    check('eligible associated group names and actual rights',len(group_options['rows'])==3 and all('audit.log.read' in row['requested_rights'] and row['selectable'] for row in group_options['rows']))
    denied(conn,'options wrong tenant refused',options,[str(ids['other_tenant']),'bu',1,25,'',None,None,None])
    denied(conn,'options wrong BU refused',options,[t,'group',1,25,'',str(ids['other_bu']),w,None])
    denied(conn,'options wrong workspace refused',options,[t,'group',1,25,'',b,str(ids['other_workspace']),None])
    denied(conn,'options unregistered environment refused',options,[t,'group',1,25,'',b,w,'sandbox'])
    check('literal option search does not interpret wildcard percent',execute(conn,options,[t,'group',1,25,'%',b,w,None])['total']==0)
    denied(conn,'bounded native option paging',options,[t,'bu',1,101,'',None,None,None],'22023')
    check('ordinary pregrant permissions absent', execute(conn, "SELECT count(*) FROM public.effective_user_permissions(%s,%s,%s) WHERE permission_id='audit.log.read'", (req,t,b)) == 0)
    first = execute(conn,submit,args)
    replay = execute(conn,submit,args)
    check('ordinary requester submit and exact idempotency replay', first==replay and first['status']=='pending')
    owner(conn)
    check('submit replay only one request audit', execute(conn, "SELECT count(*) FROM public.audit_log WHERE resource_id=%s AND action='governance.membership.request'", (first['id'],))==1)
    caller(conn,req)
    denied(conn,'changed payload key collision',submit,[*args[:5],'Changed reason',args[6]],'23505')
    denied(conn,'wrong BU refused',submit,[t,str(ids['other_bu']),w,g,'dev','Invalid BU',str(uuid.uuid4())])
    denied(conn,'wrong workspace refused',submit,[t,b,str(ids['other_workspace']),g,'dev','Invalid workspace',str(uuid.uuid4())])
    denied(conn,'unregistered environment refused',submit,[t,b,w,g,'sandbox','Invalid environment',str(uuid.uuid4())])
    denied(conn,'client direct request insert refused',"INSERT INTO public.governance_membership_requests(tenant_id) VALUES(%s)",(t,))
    denied(conn,'ordinary decision refused',decide,[t,first['id'],1,'approve','No admin',str(uuid.uuid4())])
    caller(conn,str(ids['outsider']))
    denied(conn,'wrong tenant submit refused',submit,[*args[:6],str(uuid.uuid4())])
    denied(conn,'wrong tenant detail refused','SELECT public.get_governance_membership_request(%s,%s)',[t,first['id']])
    caller(conn,str(ids['platform']))
    denied(conn,'platform admin without tenant admin refused',decide,[t,first['id'],1,'approve','Platform alone',str(uuid.uuid4())])
    check('platform alone cannot see other requests',execute(conn,'SELECT count(*) FROM public.governance_membership_requests WHERE tenant_id=%s',[t])==0)
    caller(conn,checker)
    denied(conn,'stale version refused',decide,[t,first['id'],2,'approve','Stale',str(uuid.uuid4())],'40001')
    dargs=[t,first['id'],1,'approve','Independent review',str(uuid.uuid4())]
    approved=execute(conn,decide,dargs)
    check('distinct ordinary QA checker approval',approved['status']=='approved' and approved['version']==2 and approved['outcome']=='grant_confirmed')
    check('decision replay exact outcome',execute(conn,decide,dargs)==approved)
    denied(conn,'new key closed replay refused',decide,[*dargs[:5],str(uuid.uuid4())],'40001')
    denied(conn,'same key changed decision refused',decide,[t,first['id'],1,'reject','Independent review',dargs[5]],'23505')
    caller(conn,str(ids['checker2']))
    denied(conn,'cross actor key reuse refused',decide,dargs,'23505')
    owner(conn)
    check('atomic grant exact actor',execute(conn,'SELECT added_by::text FROM public.tenant_group_members WHERE group_id=%s AND user_id=%s',[g,req])==checker)
    check('only one approve audit',execute(conn,"SELECT count(*) FROM public.audit_log WHERE resource_id=%s AND action='governance.membership.approve'",[first['id']])==1)
    check('audit chain produced real hash',execute(conn,"SELECT row_hash IS NOT NULL AND actor_user_id=%s FROM public.audit_log WHERE id=%s",[checker,approved['audit_id']]))
    caller(conn,req)
    check('ordinary permission actually effective',execute(conn,"SELECT count(*) FROM public.effective_user_permissions(%s,%s,%s) WHERE permission_id='audit.log.read'",[req,t,b])>0)
    detail=execute(conn,'SELECT public.get_governance_membership_request(%s,%s)',[t,first['id']])
    check('detail history and truthful broad group scope',detail['membership_active'] and len(detail['history'])==2 and 'across workspaces' in detail['scope_label'])
    owner(conn)
    execute(conn,'DELETE FROM public.tenant_group_members WHERE group_id=%s AND user_id=%s',[g,req])
    caller(conn,req)
    check('revocation denies actual effective group permission',execute(conn,"SELECT count(*) FROM public.effective_user_permissions(%s,%s,%s) WHERE permission_id='audit.log.read'",[req,t,b])==0)
    detail=execute(conn,'SELECT public.get_governance_membership_request(%s,%s)',[t,first['id']])
    check('history retained after revocation; current membership false',detail['status']=='approved' and not detail['membership_active'] and len(detail['history'])==2)
    caller(conn,checker)
    check('old approval replay does not regrant',execute(conn,decide,dargs)==approved)
    owner(conn)
    check('replay after revocation no resurrected membership',execute(conn,'SELECT count(*) FROM public.tenant_group_members WHERE group_id=%s AND user_id=%s',[g,req])==0)
    caller(conn,checker)
    self_request=execute(conn,submit,[t,b,w,g,'dev','Admin requests own access',str(uuid.uuid4())])
    denied(conn,'self approval refused',decide,[t,self_request['id'],1,'approve','Self',str(uuid.uuid4())])
    denied(conn,'self rejection refused',decide,[t,self_request['id'],1,'reject','Self',str(uuid.uuid4())])
    self_withdraw=[t,self_request['id'],1,'Requester withdraws',str(uuid.uuid4())]
    check('requester versioned withdrawal',execute(conn,withdraw,self_withdraw)['status']=='withdrawn')
    check('withdraw same key replay',execute(conn,withdraw,self_withdraw)['version']==2)
    denied(conn,'withdraw closed new key refused',withdraw,[*self_withdraw[:4],str(uuid.uuid4())],'40001')
    caller(conn,req)
    second=execute(conn,submit,[*args[:6],str(uuid.uuid4())])
    caller(conn,str(ids['second_requester']))
    denied(conn,'another requester cannot withdraw',withdraw,[t,second['id'],1,'Other',str(uuid.uuid4())])
    check('requester cannot read others history',execute(conn,'SELECT count(*) FROM public.governance_membership_events WHERE request_id=%s',[second['id']])==0)
    caller(conn,checker)
    rejected=execute(conn,decide,[t,second['id'],1,'reject','Reasoned denial',str(uuid.uuid4())])
    check('independent rejection grants no access',rejected['status']=='rejected' and rejected['outcome']=='no_access_granted')
    listed=execute(conn,'SELECT public.list_governance_membership_requests(%s,2,1,\'\',NULL,NULL,NULL)',[t])
    check('paging total and KPIs full filtered set',len(listed['rows'])==1 and listed['total']==3 and listed['kpis']['approved_last_7_days']==1 and listed['kpis']['rejected_or_withdrawn']==2)
    filtered=execute(conn,"SELECT public.list_governance_membership_requests(%s,1,25,'group','approved',NULL,'dev')",[t])
    check('search status and environment filtering',filtered['total']==1 and filtered['rows'][0]['id']==first['id'])
    caller(conn,req)
    own_list=execute(conn,'SELECT public.list_governance_membership_requests(%s,1,25,\'\',NULL,NULL,NULL)',[t])
    check('ordinary caller owns only own requests',own_list['total']==2 and not own_list['permissions']['can_review_queue'])
    # Recheck current requester/admin state at write time, using captured real tables.
    pending=execute(conn,submit,[*args[:6],str(uuid.uuid4())])
    owner(conn)
    execute(conn,'UPDATE public.tenant_members SET active=false WHERE tenant_id=%s AND user_id=%s',[t,req])
    caller(conn,checker)
    denied(conn,'revoked requester cannot gain group',decide,[t,pending['id'],1,'approve','Revoked subject',str(uuid.uuid4())])
    caller(conn,req)
    denied(conn,'inactive requester list is refusal not empty success','SELECT public.list_governance_membership_requests(%s)',[t])
    check('inactive requester raw RLS hides request',execute(conn,'SELECT count(*) FROM public.governance_membership_requests WHERE tenant_id=%s',[t])==0)
    owner(conn)
    execute(conn,'UPDATE public.tenant_members SET active=true WHERE tenant_id=%s AND user_id=%s',[t,req])
    execute(conn,'UPDATE public.tenant_members SET active=false WHERE tenant_id=%s AND user_id=%s',[t,checker])
    caller(conn,checker)
    denied(conn,'inactive checker refused',decide,[t,pending['id'],1,'approve','Inactive checker',str(uuid.uuid4())])
    owner(conn)
    execute(conn,'UPDATE public.tenant_members SET active=true WHERE tenant_id=%s AND user_id=%s',[t,checker])
    execute(conn,"UPDATE public.rbac_roles SET key='qa_changed' WHERE id=%s",[str(ids['role'])])
    caller(conn,checker)
    denied(conn,'changed role snapshot refused',decide,[t,pending['id'],1,'approve','Changed role',str(uuid.uuid4())],'40001')
    owner(conn)
    execute(conn,"UPDATE public.rbac_roles SET key='qa_reader' WHERE id=%s",[str(ids['role'])])
    execute(conn,"INSERT INTO public.rbac_role_permissions(role_id,permission_id) VALUES(%s,'tenant.role.grant')",[str(ids['role'])])
    caller(conn,checker)
    denied(conn,'privilege escalating group refused',decide,[t,pending['id'],1,'approve','Admin permission',str(uuid.uuid4())])
    caller(conn,req)
    check('privileged groups not selectable in named choices',execute(conn,options,[t,'group',1,25,'',b,w,None])['total']==0)
    owner(conn)
    execute(conn,"DELETE FROM public.rbac_role_permissions WHERE role_id=%s AND permission_id='tenant.role.grant'",[str(ids['role'])])
    execute(conn,"CREATE FUNCTION public.governance_membership_fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='governance.membership.approve' THEN RAISE EXCEPTION 'Owned fixture audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER governance_membership_fixture_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.governance_membership_fixture_fail_audit()")
    caller(conn,checker)
    failed_key=str(uuid.uuid4())
    denied(conn,'audit failure rejects atomic operation',decide,[t,pending['id'],1,'approve','Atomic failure',failed_key],'23514')
    owner(conn)
    check('audit failure rollback leaves pending version1 and no membership',execute(conn,"SELECT status='pending' AND version=1 AND NOT EXISTS(SELECT 1 FROM public.tenant_group_members WHERE group_id=%s AND user_id=%s) FROM public.governance_membership_requests WHERE id=%s",[g,req,pending['id']]))
    check('failed key was not consumed',execute(conn,'SELECT count(*) FROM private.governance_membership_operations WHERE tenant_id=%s AND request_key=%s',[t,failed_key])==0)
    execute(conn,'DROP TRIGGER governance_membership_fixture_audit_failure ON public.audit_log; DROP FUNCTION public.governance_membership_fixture_fail_audit()')
    # Two actual database connections: only one independent approval may commit.
    def racing_decision(admin):
        with connect(db) as session:
            session.autocommit=True
            caller(session,str(admin))
            try:
                execute(session,decide,[t,pending['id'],1,'approve','Race',str(uuid.uuid4())])
                return 'success'
            except psycopg2.Error as error:
                return error.pgcode
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes=list(pool.map(racing_decision,[ids['checker'],ids['checker2']]))
    check('two session concurrent approvals exactly one grant',sorted(outcomes)==['40001','success'])
    check('retained unrelated membership projection unchanged',execute(conn,"SELECT md5(row_to_json(gm)::text) FROM public.tenant_group_members gm WHERE group_id=%s AND user_id=%s",[str(ids['sentinel_group']),str(ids['checker2'])])==sentinel)
    # More than 1000 real synthetic local catalog choices, no fabricated UI rows.
    execute(conn,"INSERT INTO public.tenant_groups(tenant_id,bu_id,name) SELECT %s,%s,'Scale option '||lpad(i::text,4,'0') FROM generate_series(1,1005) i",[t,b])
    caller(conn,req)
    scale=execute(conn,options,[t,'group',11,100,'Scale option',b,w,None])
    check('1000+ named option paging total and last page',scale['total']==1005 and len(scale['rows'])==5 and not scale['has_more'] and scale['rows'][0]['label']=='Scale option 1001')
    scope_list=execute(conn,options,[t,'group',1,100,'Scale option',b,w,None])
    check('first option page bounded with has_more',len(scope_list['rows'])==100 and scope_list['has_more'])
    caller(conn,req)
    denied(conn,'direct request update refused','UPDATE public.governance_membership_requests SET version=99 WHERE id=%s',[first['id']])
    denied(conn,'direct request deletion refused','DELETE FROM public.governance_membership_requests WHERE id=%s',[first['id']])
    execute(conn,'RESET ROLE; SET ROLE anon')
    denied(conn,'anon submit execute denied',submit,args)
    owner(conn)
    check('private operation table no authenticated SELECT',not execute(conn,"SELECT has_table_privilege('authenticated','private.governance_membership_operations','SELECT')"))
    check('migration has no public privilege escalation RPC',not execute(conn,"SELECT has_function_privilege('anon','public.decide_governance_membership_request(uuid,uuid,integer,text,text,uuid)','EXECUTE')"))

server=None
try:
    acl=subprocess.run(['icacls.exe',str(RUN),'/inheritance:r','/grant:r',os.environ['USERDOMAIN']+'\\'+os.environ['USERNAME']+':(OI)(CI)F','SYSTEM:(OI)(CI)F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
    if acl.returncode:
        raise RuntimeError('Owned fixture private ACL failed')
    command('initdb','-D',DATA,'-U','fvi_fixture_bootstrap','-A','trust','--no-locale','-E','UTF8')
    logfile=(RUN/'server.log').open('wb')
    server=subprocess.Popen([str(BIN/'postgres.exe'),'-D',str(DATA),'-h','127.0.0.1','-p',str(PORT),'-c','shared_buffers=16MB','-c','max_connections=8'],stdin=subprocess.DEVNULL,stdout=logfile,stderr=logfile,creationflags=subprocess.CREATE_NO_WINDOW)
    ready=False
    for i in range(60):
        try:
            probe=connect('postgres')
            probe.autocommit=True
            version=execute(probe,'SELECT version()')
            check('owned native PostgreSQL17', 'PostgreSQL 17.' in version)
            execute(probe,'CREATE DATABASE fvi_membership_prod')
            execute(probe,'CREATE DATABASE fvi_membership_dev')
            probe.close()
            ready=True
            break
        except psycopg2.OperationalError:
            time.sleep(.1)
    if not ready:
        raise RuntimeError('Owned native server unavailable')
    for env,expected_hash in [('PROD','a66fb7fd3e495548e33c63b7c502f6a83d5b2bda2fe4a94ee288cb325ebddfc6'),('DEV','ad50cd40568be1d68b04e2389ebd034775e349a4b4e8a1e414114bfe89e4f348')]:
        raw=(PRIVATE/f'FVI-GOVERNANCE-CATALOG-{env}-EXTENDED-20261002.json').read_bytes()
        if digest(raw)!=expected_hash:
            raise RuntimeError('Fresh catalog drift')
        fresh=json.loads(raw)['rows'][0]['catalog']
        supplemental_path=PRIVATE/f'FVI-GOVERNANCE-CATALOG-{env}-SUPPLEMENT-20261002.json'
        supplemental_raw=supplemental_path.read_bytes()
        supplemental_expected={'PROD':'384111f02ee55e75a1db737459b472870ee692658e5f43316dd9dc1e127cd04d','DEV':'fbf8cfe4d037bbadbfec5d69afafccf3899c5f1c4ca74db228ac9a367df4b202'}[env]
        if digest(supplemental_raw)!=supplemental_expected:
            raise RuntimeError('Fresh permission helper supplement drift')
        supplemental=json.loads(supplemental_raw)['rows'][0]['catalog']
        fresh['helpers']=fresh['helpers']+supplemental['helpers']
        if not any(f['name']=='effective_user_permissions' for f in fresh['helpers']):
            raise RuntimeError('Fresh actual permission resolver absent')
        prep=json.loads((METADATA/f'FVI-{env}-ASSIGNMENT-PREPARE-20261002.json').read_bytes())
        scaffold=Path(prep['scaffold']).read_bytes()
        controls=Path(prep['controls']).read_bytes()
        oldraw=(METADATA/f'FVI-{env}-EXCEPTION-ASSIGNMENT-INTEGRATION-CATALOG-20261002.json').read_bytes()
        if digest(scaffold)!=prep['scaffold_sha256'] or digest(controls)!=prep['controls_sha256'] or digest(oldraw)!=prep['catalog_sha256']:
            raise RuntimeError('Metadata-only dependency scaffold drift')
        old=json.loads(oldraw)['catalog']
        db='fvi_membership_'+env.lower()
        conn=connect(db)
        conn.autocommit=True
        execute(conn,scaffold.decode('utf8'))
        execute(conn,sql.SQL('ALTER DATABASE {} OWNER TO postgres').format(sql.Identifier(db)))
        extend_scaffold(conn,fresh)
        ids=seed(conn,fresh)
        restore_current(conn,fresh,old)
        execute(conn,'RESET ROLE; SET search_path=public,extensions,auth,private,pg_catalog')
        execute(conn,controls.decode('utf8'))
        overlay_current(conn,fresh)
        owner(conn)
        execute(conn,(ROOT/'supabase/migrations/20261002133000_governance_membership_requests.sql').read_text(encoding='utf8'))
        qualify(conn,ids,db)
        denied(conn,'occupied preimage migration replay refused',(ROOT/'supabase/migrations/20261002133000_governance_membership_requests.sql').read_text(encoding='utf8'),(), 'P0001')
        conn.close()
        RECEIPT['catalogs'].append({'environment':env,'current_catalog_sha256':expected_hash,'current_helper_supplement_sha256':supplemental_expected,'ledger':fresh['ledger'],'dependency_catalog_sha256':digest(oldraw),'dependency_scaffold_sha256':digest(scaffold),'status':'PASS'})
        print(env+' ordinary-callers/captured-auth-RLS/audit native qualification PASS',flush=True)
    RECEIPT['status']='NATIVE_PG17_MEMBERSHIP_PASS'
except Exception as error:
    RECEIPT['status']='NATIVE_PG17_MEMBERSHIP_FAILED'
    RECEIPT['error']=str(error)
    raise
finally:
    if server is not None and server.poll() is None:
        command('pg_ctl','-D',DATA,'-m','fast','-w','stop')
    RECEIPT['migration_sha256']=digest((ROOT/'supabase/migrations/20261002133000_governance_membership_requests.sql').read_bytes())
    (RUN/'receipt.json').write_text(json.dumps(RECEIPT,indent=2),encoding='utf8')
    print(json.dumps({'status':RECEIPT['status'],'checks':len(CHECKS),'receipt':str(RUN/'receipt.json'),'error':RECEIPT.get('error')}),flush=True)
