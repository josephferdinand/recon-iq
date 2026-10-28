import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const root = process.cwd();
const output = path.join(root, 'docs/evidence/status-lane-2026-10-03');
const name = 'fvi-status-native-20261004-' + randomUUID().slice(0, 8);
const image = 'postgres:17.6-alpine';
const call = (args, input) => spawnSync('docker', args, { cwd: root, input, encoding: 'utf8', timeout: 60_000, windowsHide: true });
let created = false;
try {
  const imageResult = call(['image', 'inspect', image, '--format', '{{.Id}}']);
  if (imageResult.status !== 0) throw new Error('Existing PostgreSQL 17.6 fixture image unavailable. No image pull attempted.');
  const started = call(['run','-d','--name',name,'--network','none','-e','POSTGRES_PASSWORD=status-local-fixture-only',image]);
  if (started.status !== 0) throw new Error(started.stderr); created = true;
  let ready = false;
  for (let i=0;i<40;i++) { const probe=call(['exec',name,'pg_isready','-U','postgres']); if(probe.status===0){ready=true;break;} await new Promise(resolve=>setTimeout(resolve,250)); }
  if (!ready) throw new Error('Isolated status PostgreSQL fixture did not become ready.');
  const sql = ['tests/status-native-bootstrap.sql','docs/evidence/status-lane-2026-10-03/guarded-status-workflow-proposal.sql','tests/status-native-regression.sql'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
  const result = call(['exec','-i',name,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],sql);
  fs.writeFileSync(path.join(output,'native-qualification.log'),result.stdout+'\n'+result.stderr);
  if(result.status!==0||!result.stdout.includes('STATUS_NATIVE_FIXTURE_PASS')) throw new Error('Status native SQL fixture failed; see native-qualification.log.');
  const version = call(['exec',name,'psql','-X','-U','postgres','-Atc','SELECT version()']).stdout.trim();
  fs.writeFileSync(path.join(output,'native-qualification.json'),JSON.stringify({at:new Date().toISOString(),kind:'isolated_synthetic_postgresql_fixture',hosted:false,real_mfa:false,container:name,image,imageId:imageResult.stdout.trim(),version,result:'PASS'},null,2));
  console.log(JSON.stringify({result:'PASS',container:name,version,log:'docs/evidence/status-lane-2026-10-03/native-qualification.log'}));
} finally { if(created){const stopped=call(['stop',name]); console.log(JSON.stringify({container:name,stopped:stopped.status===0,preserved:true}));} }
