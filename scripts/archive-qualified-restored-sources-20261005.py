from pathlib import Path
import hashlib, json, zipfile
workspace=Path.cwd()
candidate=Path(r'./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928').resolve()
restore=json.loads((workspace/'output/qualified-dependency-restore-20261005/RESTORE-RECEIPT.json').read_text())
entries={item['target']:item['sha256'] for item in restore['results']}
entries.update({
 'src/lib/recon-engine.ts':'523644c6137e5beb91a0ae0eebc616d58b7201f822b3f41eca07ad82f7742647',
 'src/components/recons-tab.tsx':'5768b300a8f4a508935204b25a969448bc9863df45f3a1b0b8807f20e1db5842',
 'src/lib/groups.functions.ts':'98fd8bdd0bafc746be1aa4e75c55c87e9df9579171a5c5564b3ec3da8f8d3899',
 'src/lib/business-units.functions.ts':'ddd27cdb46be7023b5daf2c435cb0e4c3e0a5adbcb01ee41348785e41cb5502e',
 'src/components/groups-tab.tsx':'c96455e196bd19d0cf600e84030fe3af2da80bd8754359b3e29af1bac5d70672',
})
blobs=[]
for rel, expected in entries.items():
 target=(candidate/rel).resolve()
 if not target.is_relative_to(candidate): raise RuntimeError('Source path boundary')
 data=target.read_bytes()
 if hashlib.sha256(data).hexdigest()!=expected: raise RuntimeError('Qualified source drift: '+rel)
 blobs.append((rel,data))
archive=workspace/'docs/evidence/FVI_QUALIFIED_SOURCE_RECOVERY_2026-10-05.zip'
manifest={'files':entries,'whole_candidate_qualified':False,'runtime_deployed':False,'no_credentials_or_env_files':True,'scope':'explicit qualified restoration entries only'}
with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED) as output:
 for rel,data in blobs: output.writestr(rel,data)
 output.writestr('RECOVERY-MANIFEST.json',json.dumps(manifest,indent=2))
receipt={'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size,'qualified_entries':len(entries),'whole_candidate_qualified':False}
path=workspace/'docs/evidence/FVI_QUALIFIED_SOURCE_RECOVERY_2026-10-05.json'
with path.open('x') as file: json.dump(receipt,file,indent=2)
print(json.dumps(receipt))
