// Qualify the proposed preimage guard in actual PG17 READ ONLY, without DDL,
// mutation functions, auth-claim injection or a native migration PASS claim.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { own, credential } from "./governance-approval-hosted-20261002.release-20261004.mjs";
const proposal=JSON.parse(await readFile(path.join(own,"GOVERNANCE-BUSINESS-CONFLICT-PROPOSAL-20261004-v2.json"),"utf8"));
const token=await credential("SUPABASE_ACCESS_TOKEN");const results=[];
for(const environment of ["PROD","DEV"]){
 const packet=proposal.environments[environment];const captured=JSON.parse(await readFile(packet.catalog_file,"utf8")).result[0].metadata.functions;
 const quote=value=>`'${value.replaceAll("'","''")}'`;
 const columns=packet.changed.map(row=>{const qualified=row.function.slice(0,row.function.indexOf('('));const f=captured.find(item=>`${item.schema}.${item.name}`===qualified);return `SELECT ${quote(row.function)} AS signature,p.oid IS NOT NULL AS resolved,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=${quote(row.before_body_sha256)} AS body_matches,p.proowner=${quote(f.owner)}::regrole AND p.prosecdef=true AS authority_matches,p.proconfig IS NOT DISTINCT FROM ${f.config?`ARRAY[${f.config.map(quote).join(',')}]::text[]`:'NULL::text[]'} AS config_matches,p.proacl IS NOT DISTINCT FROM ${f.acl?`${quote('{'+f.acl.join(',')+'}')}::aclitem[]`:'NULL::aclitem[]'} AS acl_matches FROM pg_proc p WHERE p.oid=${quote(row.function)}::regprocedure`;});
 const query=`SELECT jsonb_agg(to_jsonb(g)) AS guard_checks FROM (${columns.join(' UNION ALL ')}) g`;
 const ref=environment==="PROD"?"YOUR_PROJECT_REF":"YOUR_PROJECT_REF";
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`Native ${environment} read-only guard query failed HTTP${response.status}`);
 const data=await response.json();const rows=data[0]?.guard_checks;if(!Array.isArray(rows)||rows.length!==6||rows.some(row=>![row.resolved,row.body_matches,row.authority_matches,row.config_matches,row.acl_matches].every(value=>value===true)))throw new Error(`Native ${environment} guard drift; do not apply proposal`);
 results.push({environment,http:response.status,read_only:true,checks:rows});
}
const file=path.join(own,`GOVERNANCE-CONFLICT-GUARD-READONLY-${new Date().toISOString().replaceAll(/[:.]/gu,"-")}.json`);await writeFile(file,JSON.stringify({at:new Date().toISOString(),status:"12-NATIVE-PG17-PREIMAGE-GUARDS-PASS-READONLY-NOT-MIGRATION",results},null,2),{flag:"wx"});console.log(JSON.stringify({status:"12-NATIVE-PG17-PREIMAGE-GUARDS-PASS-READONLY-NOT-MIGRATION",environments:results.map(r=>({environment:r.environment,checks:r.checks.length})),evidence:file}));
