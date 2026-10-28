// Diagnose only the explicitly named Curie synthetic fixture; no hosted access.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const name=process.argv[2];if(!/^fvi-curie-recon-read-(prod|dev)-[a-f0-9]{8}$/u.test(name??''))throw Error('Own fixture name required');
const guard=readFileSync('scripts/public-recon-read-dependency-guard-20261003.sql','utf8');
const query=guard.match(/FROM \((SELECT[\s\S]+)\) captured;/u)?.[1];if(!query)throw Error('No dependency query');
const expected=JSON.parse([...guard.matchAll(/actual='((?:[^']|'')*)'::jsonb/gu)][name.includes('-dev-')?1:0][1].replaceAll("''","'"));
const r=spawnSync('docker',['exec','-i',name,'psql','-X','-At','-U','postgres','-v','ON_ERROR_STOP=1'],{input:query+';',encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error(r.stderr);
const actual=JSON.parse(r.stdout.trim());
writeFileSync(`docs/handover/returns/2026-10-03-curie-recon-read-packet/native-${name.includes('-dev-')?'DEV':'PROD'}/fixture-guard-actual.json`,JSON.stringify(actual,null,2));
const stable=x=>JSON.stringify(x,Object.keys(x??{}).sort());
for(const key of Object.keys(expected)){
 if(Array.isArray(expected[key])){
  if(expected[key].length!==actual[key]?.length)console.log(key,'length',expected[key].length,actual[key]?.length);
  expected[key].forEach((e,i)=>{if(stable(e)!==stable(actual[key]?.[i]))console.log(key,i,JSON.stringify({expected:e,actual:actual[key]?.[i]}));});
 }else if(expected[key]!==actual[key])console.log(key,JSON.stringify({expected:expected[key],actual:actual[key]}));
}
