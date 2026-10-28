import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const extract=s=>s.match(/CREATE FUNCTION private\.mapped_recon_governance_mapping\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$;/);
const before=extract(fs.readFileSync(path.join(out,'native-fixture.sql'),'utf8'));
const after=extract(fs.readFileSync(path.join(out,'unqualified-implementation.sql'),'utf8'));
if(!before||!after)throw new Error('Missing exact mapping helper preimage');
const hash=crypto.createHash('sha256').update(before[1]).digest('hex');
const sql=`DO $guard$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='private.mapped_recon_governance_mapping(uuid,uuid)'::regprocedure)<> '${hash}' THEN RAISE EXCEPTION 'own fixture scope helper preimage changed'; END IF; END $guard$;\n`+
 after[0].replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION')+'\n'+fs.readFileSync('tests/sql/mapped-recon-governance-scope-focus-20261004.sql','utf8');
fs.writeFileSync(path.join(out,'native-scope.sql'),sql);
console.log('Prepared one exact-preimage helper replacement and new association validation cases.');
