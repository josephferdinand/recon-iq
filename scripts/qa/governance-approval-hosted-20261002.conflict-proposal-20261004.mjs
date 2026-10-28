// Generates review-only parent SQL from exact captured native definitions.
// Does not connect to the database or execute a migration.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { own } from "./governance-approval-hosted-20261002.release-20261004.mjs";
const captures={PROD:"PROD-REFUSAL-METADATA-2026-10-03T21-22-57-640Z.json",DEV:"DEV-REFUSAL-METADATA-2026-10-03T21-22-57-832Z.json"};
const counts={"public.withdraw_governance_membership_request":1,"public.decide_governance_membership_request":2,"public.governance_access_review_campaign_create":1,"public.governance_access_review_decide":3,"private.governance_review_snapshot":3,"public.governance_access_review_get":0};
const sha=value=>createHash("sha256").update(value).digest("hex");
const quote=value=>`'${value.replaceAll("'","''")}'`;
const hashes={};const proof={at:new Date().toISOString(),status:"REVIEW-ONLY-NOT-EXECUTED",checks:[],environments:{},limitations:["No SQL applied, native fixture executed or served conflict response fixed","Parent must choose fresh migration version, integrate typed conflict contract and perform guarded PG17 rollback/apply","Separate durable denied-attempt audit contract required; raising an exception rolls back audit writes in the same transaction","Parent must verify process_id against exact40001 logs before bounded backend termination; this child does not terminate sessions"]};
for(const environment of ["PROD","DEV"]){
 const file=path.join(own,captures[environment]);const bytes=await readFile(file);const capture=JSON.parse(bytes);const functions=capture.result[0].metadata.functions;
 const statements=[];const guards=[];const changed=[];
 for(const [qualified,count]of Object.entries(counts)){
  const f=functions.find(row=>`${row.schema}.${row.name}`===qualified);if(!f)throw new Error(`Exact native ${qualified} absent`);
  if(!f.security_definer||f.owner!=="postgres"||!f.definition.startsWith(`CREATE OR REPLACE FUNCTION ${qualified}(`))throw new Error("Unexpected native function authority/header");
  const matches=(f.body.match(/ERRCODE\s*=\s*'40001'/gu)??[]).length;if(matches!==count)throw new Error(`Frozen business-conflict cardinality changed ${qualified}:${matches}`);
  let after=f.definition.replace(/ERRCODE\s*=\s*'40001'/gu,"ERRCODE='PT409'");
  if(qualified==="public.governance_access_review_get"){
   if((after.match(/EXCEPTION WHEN SQLSTATE '40001'/gu)??[]).length!==1)throw new Error("Snapshot stale handling closure changed");
   after=after.replace("EXCEPTION WHEN SQLSTATE '40001'","EXCEPTION WHEN SQLSTATE 'PT409'");
  }
  // Round-trip demonstrates that every retained statement is exact native text
  // except the selected business-code literals and the matching snapshot catch.
  const round=after.replaceAll("ERRCODE='PT409'","ERRCODE='40001'").replace("EXCEPTION WHEN SQLSTATE 'PT409'","EXCEPTION WHEN SQLSTATE '40001'");
  if(round!==f.definition)throw new Error("Proposal changes more than exact native error literals");
  for(const code of ["42501","23505","22023"])if((after.match(new RegExp(`'${code}'`,"g"))??[]).length!==(f.definition.match(new RegExp(`'${code}'`,"g"))??[]).length)throw new Error("Authorization/idempotency/input error semantics altered");
  // pg_get_function_identity_arguments includes argument names; regprocedure
  // accepts only argument TYPES. Restrict conversion to these actual six ports.
  const argumentTypes=f.identity.split(',').map(argument=>{const match=/^\s*[a-z_][a-z0-9_]*\s+(uuid|integer|text|jsonb)\s*$/u.exec(argument);if(!match)throw new Error("Captured typed port outside expected grammar");return match[1];});
  const signature=`${qualified}(${argumentTypes.join(',')})`;
  const hash=sha(f.body);if(environment==="PROD")hashes[qualified]=hash;else if(hashes[qualified]!==hash)throw new Error("Captured PROD/DEV native function bodies differ");
  guards.push(`IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=${quote(signature)}::regprocedure AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=${quote(hash)} AND p.proowner=${quote(f.owner)}::regrole AND p.prosecdef=true AND p.proconfig IS NOT DISTINCT FROM ${f.config?`ARRAY[${f.config.map(quote).join(',')}]::text[]`:'NULL::text[]'} AND p.proacl IS NOT DISTINCT FROM ${f.acl?`${quote('{'+f.acl.join(',')+'}')}::aclitem[]`:'NULL::aclitem[]'}) THEN RAISE EXCEPTION 'Exact native ${qualified} body/authority preimage changed'; END IF;`);
  statements.push(after.trimEnd()+";");changed.push({function:signature,before_body_sha256:hash,business_raises:count,snapshot_catch_changed:count===0});
  proof.checks.push({environment,function:qualified,native_roundtrip:true,authority_preserved:true,auth_input_idempotency_errors_preserved:true,cross_environment_body_equal:environment==="DEV"});
 }
 const sql=`-- PARENT REVIEW ONLY. NOT RUN. Bounded custom business conflicts return PT409.\n-- Genuine database serialization failures are not caught or remapped.\nBEGIN;\nDO $preimage$ BEGIN\n${guards.join('\n')}\nEND $preimage$;\n${statements.join('\n\n')}\nCOMMIT;\n`;
 const output=path.join(own,`${environment}-GOVERNANCE-BUSINESS-CONFLICT-PT409-PROPOSED-20261004-v2.sql`);await writeFile(output,sql,{flag:"wx"});
 proof.environments[environment]={catalog_file:file,catalog_sha256:sha(bytes),proposal_file:output,proposal_sha256:sha(sql),changed};
}
const evidence=path.join(own,"GOVERNANCE-BUSINESS-CONFLICT-PROPOSAL-20261004-v2.json");await writeFile(evidence,JSON.stringify(proof,null,2),{flag:"wx"});console.log(JSON.stringify({status:proof.status,focused_function_checks:proof.checks.length,outputs:Object.values(proof.environments).map(row=>row.proposal_file),evidence}));
