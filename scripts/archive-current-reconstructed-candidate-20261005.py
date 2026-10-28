from pathlib import Path
import hashlib,json,zipfile,datetime
workspace=Path.cwd()
candidate=Path('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928').resolve()
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
archive=workspace/'docs/evidence'/f'FVI_RECONSTRUCTED_SOURCE_CHECKPOINT_{stamp}.zip'
sources=[p for p in (candidate/'src').rglob('*') if p.is_file()]
sources += [candidate/name for name in ['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','wrangler.toml'] if (candidate/name).is_file()]
sources += [p for p in (candidate/'scripts').glob('*.mjs') if p.is_file() and p.name in ['build-fvi-production-from-protected-files.mjs','build-fvi-development-from-protected-files.mjs','fvi-dev-binding-contract.mjs','cloudflare-require-fallback.mjs','verify-build-secret-exclusion.mjs','verify-build-supabase-secret-shapes.mjs','fvi-cloudflare.mjs']]
manifest={'at':stamp,'candidate':str(candidate),'files':{},'scope':'Reconstructed current-design source checkpoint only; NOT complete selected deployed-source ancestry or deploy approval','whole_current_deployed_source_qualified':False,'application_uploaded':False,'env_credentials_node_modules_qa_transports_excluded':True,'pending_named_published_slices':['Home/Reports','Reference','Governance'],'compiler':'Main required typecheck passed after generated-types/footer/validated-row typing repair'}
with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED) as output:
 for p in sorted(set(sources)):
  if p.is_symlink() or not p.resolve().is_relative_to(candidate):raise RuntimeError('Source archive boundary/link')
  relative=p.relative_to(candidate).as_posix()
  if any(part.lower().startswith('.env') for part in p.parts) or any(part.lower() in ['node_modules','qa-private'] for part in p.parts):raise RuntimeError('Excluded source path')
  data=p.read_bytes();manifest['files'][relative]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()};output.writestr(relative,data)
 output.writestr('SOURCE-CHECKPOINT-MANIFEST.json',json.dumps(manifest,indent=2))
with zipfile.ZipFile(archive,'r') as check:
 for relative,value in manifest['files'].items():
  if hashlib.sha256(check.read(relative)).hexdigest()!=value['sha256']:raise RuntimeError('Archive readback mismatch')
receipt={'at':stamp,'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size,'entries':len(manifest['files']),'verified_archive_readback':True,'whole_current_deployed_source_qualified':False,'application_uploaded':False}
file=workspace/'docs/evidence'/f'FVI_RECONSTRUCTED_SOURCE_CHECKPOINT_{stamp}.json'
with file.open('x') as stream:json.dump(receipt,stream,indent=2)
print(json.dumps(receipt))
