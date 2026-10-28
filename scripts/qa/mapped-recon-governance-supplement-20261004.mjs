import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out=path.resolve('output/mapped-recon-governance-20261004');
const latest=fs.readFileSync(path.join(out,'unqualified-implementation.sql'),'utf8');
const prior=fs.readFileSync(path.join(out,'native-fixture.sql'),'utf8');
function defs(s,name){
 const pattern=new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?AS\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1;','gi');
 return [...s.matchAll(pattern)];
}
let sql='-- Own native fixture only; exact retained function preimages before two focused replacements.\n';
for(const name of ['public.decide_recon_definition_edit','private.mapped_recon_governance_stage_insert']){
 const before=defs(prior,name).at(-1);const after=defs(latest,name).at(-1);
 if(!before||!after)throw new Error('Missing bounded function '+name);
 const hash=crypto.createHash('sha256').update(before[2]).digest('hex');
 const args=name.startsWith('public.')?'uuid,boolean,text':'public.recon_definitions';
 sql+=`DO $guard$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='${name}(${args})'::regprocedure)<> '${hash}' THEN RAISE EXCEPTION 'own fixture focused preimage changed: ${name}'; END IF; END $guard$;\n`;
 sql+=after[0].replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION')+'\n';
}
sql+=fs.readFileSync('tests/sql/mapped-recon-governance-supplement-20261004.sql','utf8');
fs.writeFileSync(path.join(out,'native-supplement.sql'),sql);
console.log('Prepared only two changed native function definitions and new supplementary cases.');
