import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const latest=fs.readFileSync(path.join(out,'unqualified-implementation.sql'),'utf8');
const prior=fs.readFileSync(path.join(out,'native-fixture.sql'),'utf8');
function def(s,name){const re=new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?AS\\s+\\$\\$([\\s\\S]*?)\\$\\$;','g');return [...s.matchAll(re)].at(-1);}
let sql='-- Own native fixture only; newly changed immutable-version evidence checks.\n';
for(const [name,args] of [['public.request_recon_definition_edit','uuid,uuid,text'],['public.submit_recon_definition_promotion','uuid,uuid,text'],['public.decide_recon_definition_promotion','uuid,boolean,text']]){
 const before=def(prior,name),after=def(latest,name);if(!before||!after)throw new Error('Missing exact function '+name);
 const hash=crypto.createHash('sha256').update(before[1]).digest('hex');
 sql+=`DO $guard$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='${name}(${args})'::regprocedure)<>'${hash}' THEN RAISE EXCEPTION 'own version fixture preimage changed: ${name}'; END IF; END $guard$;\n`+after[0]+'\n';
}
sql+=fs.readFileSync('tests/sql/mapped-recon-governance-version-focus-20261004.sql','utf8');
fs.writeFileSync(path.join(out,'native-version.sql'),sql);
console.log('Prepared three exact-preimage RPC replacements and new version-evidence cases.');
