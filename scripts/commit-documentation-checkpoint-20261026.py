from pathlib import Path
import os,json,subprocess,hashlib,time
r=Path.cwd();tmp=r/'.codex-tmp/documentation-checkpoint-20261026';p=json.loads((tmp/'PLAN.json').read_text());env=os.environ.copy();idx=r/'.git'/('fvi-docs-'+str(time.time_ns())+'.index');env['GIT_INDEX_FILE']=str(idx)
def git(*args,input=None):
 q=subprocess.run(['git','-c','gc.auto=0','-c','maintenance.auto=false',*args],input=input,capture_output=True,env=env)
 if q.returncode:raise RuntimeError('git '+args[0]+' failed: '+q.stderr.decode('utf8',errors='replace')[:500])
 return q.stdout.decode().strip()
main=git('rev-parse','HEAD');realindex=r/'.git/index';indexsha=hashlib.sha256(realindex.read_bytes()).hexdigest();git('read-tree',p['base']);manifest=[]
for f in p['files']:
 if not(f.endswith('.md') or f.endswith('.json')):raise RuntimeError('Non-document publication refused')
 if f.startswith(('src/','supabase/','workers/','.github/')):raise RuntimeError('Product file publication refused')
 b=(tmp/'publish'/f).read_bytes();blob=git('hash-object','-w','--stdin',input=b);git('update-index','--add','--cacheinfo','100644,'+blob+','+f);manifest.append({'file':f,'sha256':hashlib.sha256(b).hexdigest()})
tree=git('write-tree');commit=git('commit-tree',tree,'-p',p['base'],input=b'docs: checkpoint status v3, backlog and provider continuity [skip ci] [skip release]\n');git('update-ref','refs/heads/'+p['branch'],commit,'0'*40)
assert git('rev-parse','HEAD')==main;assert hashlib.sha256(realindex.read_bytes()).hexdigest()==indexsha
receipt={'status':'COMMITTED_LOCAL_PENDING_PUSH','checkpoint_commit':commit,'base':p['base'],'branch':p['branch'],'local_main_preserved':main,'index_preserved':True,'files':manifest,'secret_scan':p['new_content_secret_scan'],'push_verified':False};(tmp/'COMMIT.json').write_text(json.dumps(receipt,indent=2));(r/'docs/handover/checkpoint-2026-10-26/GIT_PUBLICATION.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({'commit':commit,'branch':p['branch'],'files':len(manifest),'local_main_and_index_preserved':True}))
