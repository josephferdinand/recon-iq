"""Focused own_only regression on the retained owned actual-catalog PG17 fixture.
Does not rerun broad qualification or connect to a hosted database.
"""
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

ROOT=Path(__file__).resolve().parent.parent
BASE=json.loads((ROOT/'scripts/governance-membership-qualification.json').read_bytes())
OLD_RECEIPT=Path(BASE['native_receipt_path'])
DATA=OLD_RECEIPT.parent/'pgdata'
assert DATA.resolve().parent.name.startswith('fvi-governance-membership-pg17-')
assert not (DATA/'postmaster.pid').exists(), 'Retained fixture is already active; do not take over another helper'
BIN=Path('C:/Program Files/PostgreSQL/17/bin')
RUN=Path(tempfile.mkdtemp(prefix='fvi-governance-membership-own-only-'))
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0))
    PORT=sock.getsockname()[1]
SOURCE=(ROOT/'supabase/migrations/20261002133000_governance_membership_requests.sql').read_bytes().decode('utf8')
START=SOURCE.index('CREATE FUNCTION public.list_governance_membership_requests(')
END=SOURCE.index('\nCREATE FUNCTION public.get_governance_membership_request(',START)
LIST_SQL=SOURCE[START:END]
HASH=hashlib.sha256(SOURCE.encode()).hexdigest()
CHECKS=[]
OUT={'status':'RUNNING','baseline_receipt':str(OLD_RECEIPT),'directory':str(RUN),'hosted_writes':False,
     'unchanged_broad_proof_rerun':False,'migration_sha256':HASH,'list_sql_sha256':hashlib.sha256(LIST_SQL.encode()).hexdigest(),'checks':CHECKS}

def execute(conn,query,params=None):
    with conn.cursor() as cur:
        cur.execute(query,params)
        return cur.fetchone()[0] if cur.description else None

def check(label,condition):
    assert condition,label
    CHECKS.append(label)

def caller(conn,user):
    execute(conn,'RESET ROLE; SET ROLE authenticated')
    execute(conn,"SELECT set_config('request.jwt.claims',%s,false)",[json.dumps({'sub':user,'role':'authenticated'})])

server=None
try:
    log=(RUN/'server.log').open('wb')
    server=subprocess.Popen([str(BIN/'postgres.exe'),'-D',str(DATA),'-h','127.0.0.1','-p',str(PORT),'-c','shared_buffers=16MB','-c','max_connections=8'],stdout=log,stderr=log,stdin=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    for env in ['prod','dev']:
        conn=None
        for i in range(60):
            try:
                conn=psycopg2.connect(host='127.0.0.1',port=PORT,user='fvi_fixture_bootstrap',dbname='fvi_membership_'+env,connect_timeout=2)
                break
            except psycopg2.OperationalError:
                time.sleep(.1)
        assert conn is not None,'Owned retained fixture not ready'
        conn.autocommit=True
        check(env+' exact owned data_directory',Path(execute(conn,"SELECT current_setting('data_directory')")).resolve()==DATA.resolve())
        execute(conn,'SET ROLE postgres')
        # Only this list function and its ACL are changed in this saved fixture.
        execute(conn,'DROP FUNCTION IF EXISTS public.list_governance_membership_requests(uuid,integer,integer,text,text,uuid,text)')
        execute(conn,'DROP FUNCTION IF EXISTS public.list_governance_membership_requests(uuid,integer,integer,text,text,uuid,text,boolean)')
        execute(conn,LIST_SQL)
        execute(conn,'REVOKE ALL ON FUNCTION public.list_governance_membership_requests(uuid,integer,integer,text,text,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.list_governance_membership_requests(uuid,integer,integer,text,text,uuid,text,boolean) TO authenticated')
        ids=execute(conn,"SELECT jsonb_build_object('tenant',tm.tenant_id::text,'admin',tm.user_id::text) FROM public.tenant_members tm JOIN public.profiles p ON p.id=tm.user_id WHERE p.full_name='checker' AND tm.active AND tm.role::text='tenant_admin'")
        assert ids,'Synthetic current independent checker missing'
        tenant,admin=ids['tenant'],ids['admin']
        other=execute(conn,"SELECT id::text FROM public.profiles WHERE full_name='second_requester'")
        bu=execute(conn,'SELECT id::text FROM public.business_units WHERE tenant_id=%s',[tenant])
        workspace=execute(conn,'SELECT id::text FROM public.workspaces WHERE tenant_id=%s',[tenant])
        group=execute(conn,"SELECT g.id::text FROM public.tenant_groups g WHERE g.tenant_id=%s AND g.name LIKE 'Scale option %%' AND NOT EXISTS(SELECT 1 FROM public.governance_membership_requests r WHERE r.group_id=g.id AND r.status='pending') ORDER BY g.name DESC LIMIT 1",[tenant])
        # Original fixture records retained. Create only two new local synthetic pending requests.
        submit='SELECT public.submit_governance_membership_request(%s,%s,%s,%s,\'dev\',%s,%s)'
        caller(conn,admin)
        own_before=execute(conn,'SELECT public.list_governance_membership_requests(%s,1,100,\'\',NULL,NULL,NULL,true)',[tenant])
        own=execute(conn,submit,[tenant,bu,workspace,group,'Own-only qualification',str(uuid.uuid4())])
        caller(conn,other)
        other_before=execute(conn,'SELECT public.list_governance_membership_requests(%s,1,100,\'\',NULL,NULL,NULL,true)',[tenant])
        foreign=execute(conn,submit,[tenant,bu,workspace,group,'Other requester qualification',str(uuid.uuid4())])
        caller(conn,admin)
        query='SELECT public.list_governance_membership_requests(%s,%s,%s,%s,%s,NULL,NULL,%s)'
        queue=execute(conn,query,[tenant,1,100,'',None,False])
        default=execute(conn,'SELECT public.list_governance_membership_requests(%s)',[tenant])
        mine=execute(conn,query,[tenant,1,100,'',None,True])
        check(env+' tenant admin queue default unchanged',queue['total']==default['total'] and any(r['id']==foreign['id'] for r in queue['rows']))
        check(env+' admin own_only rows all server actor',len(mine['rows'])>0 and all(r['requested_by']==admin for r in mine['rows']))
        check(env+' admin own_only hides other pending row',not any(r['id']==foreign['id'] for r in mine['rows']))
        check(env+' own_only preserves actual admin permission',mine['permissions']['can_review_queue'] is True and mine['permissions']['can_submit'] is True)
        check(env+' own_only full total and KPI counts',mine['total']==len(mine['rows'])==own_before['total']+1 and mine['kpis']['awaiting_decision']==own_before['kpis']['awaiting_decision']+1 and mine['kpis']['independent_checker_needed']==own_before['kpis']['independent_checker_needed']+1 and mine['kpis']['approved_last_7_days']==own_before['kpis']['approved_last_7_days'] and mine['kpis']['rejected_or_withdrawn']==own_before['kpis']['rejected_or_withdrawn'])
        check(env+' self decision permission still denied',next(r for r in mine['rows'] if r['id']==own['id'])['can_decide'] is False)
        page1=execute(conn,query,[tenant,1,1,'',None,True])
        page2=execute(conn,query,[tenant,2,1,'',None,True])
        check(env+' own-only paging preserves full counts',len(page1['rows'])==len(page2['rows'])==1 and page1['total']==page2['total']==mine['total'] and page1['kpis']==page2['kpis']==mine['kpis'])
        check(env+' own-only filter stays within own set',execute(conn,query,[tenant,1,100,foreign['id'],None,True])['total']==0)
        pending=execute(conn,query,[tenant,1,100,'','pending',True])
        check(env+' own-only status filtered full KPIs',pending['total']==own_before['kpis']['awaiting_decision']+1 and any(r['id']==own['id'] for r in pending['rows']) and pending['kpis']['rejected_or_withdrawn']==0)
        caller(conn,other)
        ordinary=execute(conn,query,[tenant,1,100,'',None,True])
        check(env+' ordinary requester remains own-only',ordinary['total']==other_before['total']+1 and any(r['id']==foreign['id'] for r in ordinary['rows']) and all(r['requested_by']==other for r in ordinary['rows']) and ordinary['permissions']['can_review_queue'] is False)
        execute(conn,'RESET ROLE; SET ROLE anon')
        try:
            execute(conn,query,[tenant,1,100,'',None,True])
        except psycopg2.Error as error:
            check(env+' anon list execution denied',error.pgcode=='42501')
        else:
            raise AssertionError('Anonymous own_only list unexpectedly allowed')
        conn.close()
    OUT['status']='NATIVE_PG17_OWN_ONLY_PASS'
except Exception as error:
    OUT['status']='NATIVE_PG17_OWN_ONLY_FAILED'
    OUT['error']=str(error)
    raise
finally:
    if server is not None and server.poll() is None:
        stop=subprocess.run([str(BIN/'pg_ctl.exe'),'-D',str(DATA),'-m','fast','-w','stop'],capture_output=True,text=True,timeout=30,creationflags=subprocess.CREATE_NO_WINDOW)
        assert stop.returncode==0,'Owned fixture shutdown failed'
    (RUN/'receipt.json').write_text(json.dumps(OUT,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'status':OUT['status'],'checks':len(CHECKS),'receipt':str(RUN/'receipt.json'),'error':OUT.get('error')}))
