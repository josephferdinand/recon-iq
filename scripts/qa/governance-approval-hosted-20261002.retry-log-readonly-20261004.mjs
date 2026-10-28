// Aggregate-only provider logs for the previously observed refusal backend.
// No raw SQL/JWT/log messages are selected; no log settings or sessions changed.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { credential, own } from "./governance-approval-hosted-20261002.release-20261004.mjs";
const sql=`SELECT log_attributes['parsed.process_id'] AS pid,log_attributes['parsed.sql_state_code'] AS sqlstate,count() AS occurrences,min(timestamp) AS first_seen,max(timestamp) AS last_seen FROM logs WHERE source='postgres_logs' AND log_attributes['parsed.process_id']='1165594' AND log_attributes['parsed.sql_state_code']='40001' AND (event_message ILIKE '%Stale request version or closed request%' OR log_attributes['parsed.context'] ILIKE '%withdraw_governance_membership_request%') GROUP BY pid,sqlstate LIMIT 5`;
const range={iso_timestamp_start:"2026-10-03T21:12:00Z",iso_timestamp_end:"2026-10-03T21:15:00Z"};
const token=await credential("SUPABASE_ACCESS_TOKEN");
const params=new URLSearchParams({sql,...range});
const response=await fetch(`https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/analytics/endpoints/logs?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
const text=await response.text();let body;try{body=JSON.parse(text);}catch{body=null;}
const returned=Array.isArray(body?.result)?body.result:Array.isArray(body?.data)?body.data:null;
const rows=(returned??[]).map(row=>({pid:row.pid,sqlstate:row.sqlstate,occurrences:row.occurrences,first_seen:row.first_seen,last_seen:row.last_seen}));
const proof={at:new Date().toISOString(),read_only:true,aggregate_only:true,range,sql,http:response.status,query_error_present:!!body?.error,result_shape_keys:body&&typeof body==="object"?Object.keys(body):[],rows,status:response.ok&&!body?.error&&returned?(rows.length?"EXACT-PID-40001-REFUSAL-LOGS-CONFIRMED":"NO-MATCH-IN-BOUNDED-LOG-WINDOW"):"PROVIDER-LOG-READ-UNAVAILABLE",qualification:"No raw event/query/JWT log content returned. Zero matches or unavailable query cannot prove that retries stopped or justify session termination."};
const file=path.join(own,`PROD-RETRY-LOG-AGGREGATE-${new Date().toISOString().replaceAll(/[:.]/gu,"-")}.json`);await writeFile(file,JSON.stringify(proof,null,2),{flag:"wx"});console.log(JSON.stringify({...proof,evidence:file}));
