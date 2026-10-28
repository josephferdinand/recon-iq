// Consumed metadata only; preserves all previous captures and performs no writes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const packet='docs/handover/returns/2026-10-03-failed-login-email-packet/revision-3';
await mkdir(packet,{recursive:true});
const previous=JSON.parse(await readFile(`${privateRoot}/FVI-FAILED-LOGIN-CATALOG-PROD-20261003.json`,'utf8'));
// Original metadata SQL contains no account rows. Restrict auth metadata to the
// five columns actually consumed by the notification recorder.
const query=previous.query.replace("(table_schema='auth' AND table_name IN ('users','audit_log_entries','mfa_factors','mfa_challenges'))","(table_schema='auth' AND table_name='users' AND column_name IN ('id','email','email_confirmed_at','deleted_at','is_anonymous'))");
if(query===previous.query)throw Error('Consumed Auth metadata boundary absent');
const vault=await readFile('./.private/CREDENTIALS.md','utf8'),a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(a<0||b<=a)throw Error('Canonical credential markers absent');
const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Existing Management access unavailable');
await writeFile(`${privateRoot}/FVI-FAILED-LOGIN-CONSUMED-QUERY-20261004.sql`,query);
const results=[];
for(const [environment,ref,expectedLedger] of [['PROD','YOUR_PROJECT_REF',451],['DEV','YOUR_PROJECT_REF',429]]){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`${environment} metadata HTTP${response.status}; body withheld`);
 const rows=await response.json(),c=rows?.[0]?.catalog;if(c?.engine!=='170006'||c.ledger?.count!==expectedLedger||c.ledger.latest!=='20261003180000')throw Error(`${environment} current identity drift`);
 const authResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 if(!authResponse.ok)throw Error(`${environment} config HTTP${authResponse.status}; body withheld`);
 const auth=await authResponse.json();const authConfig={rate_limit_email_sent:auth.rate_limit_email_sent,hook_send_email_enabled:auth.hook_send_email_enabled,security_sb_forwarded_for_enabled:auth.security_sb_forwarded_for_enabled,hook_password_verification_attempt_enabled:auth.hook_password_verification_attempt_enabled,hook_mfa_verification_attempt_enabled:auth.hook_mfa_verification_attempt_enabled};
 if(authConfig.rate_limit_email_sent!==999)throw Error(`${environment} expected999 readback absent`);
 const file=`${privateRoot}/FVI-FAILED-LOGIN-CONSUMED-${environment}-${expectedLedger}-20261004-${Date.now()}.json`,bytes=JSON.stringify({at:new Date().toISOString(),ref,read_only:true,query,rows,authConfig},null,2);await writeFile(file,bytes);
 results.push({environment,ref,file,sha256:createHash('sha256').update(bytes).digest('hex'),ledger:c.ledger,engine:c.engine,authConfig});
}
await writeFile(`${packet}/fresh-metadata.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
