// Nash — read-only readiness, never activation/auth failure/mail dispatch.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(a<0||b<=a)throw Error('Canonical credential markers absent');
const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Existing Management access unavailable');
const query=`SELECT jsonb_build_object(
 'engine',current_setting('server_version_num'),
 'ledger',(SELECT jsonb_build_object('count',count(*),'latest',max(version::text)) FROM supabase_migrations.schema_migrations),
 'attempt_table',to_regclass('private.failed_login_attempts') IS NOT NULL,
 'delivery_audit_table',to_regclass('private.failed_login_delivery_audit') IS NOT NULL,
 'notification_routines',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'service_can_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),'anon_can_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_can_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) ORDER BY p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('failed_login_begin','failed_login_finish','failed_login_claim','failed_login_settle','failed_login_requeue_recorded','failed_login_delivery_receipt')),
 'queue_exists',to_regclass('pgmq.q_transactional_emails') IS NOT NULL,
 'enqueue_service_only',(SELECT has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') FROM pg_proc p WHERE p.oid=to_regprocedure('public.enqueue_email(text,jsonb)'))
) AS readiness;`;
await writeFile(`${privateRoot}/FVI-FAILED-LOGIN-LIVE-READINESS-QUERY-20261004.sql`,query);
const output=[];
for(const [environment,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:true,query}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`${environment} metadata HTTP${response.status}; response withheld`);
 const rows=await response.json();const configResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 if(!configResponse.ok)throw Error(`${environment} auth-config HTTP${configResponse.status}; response withheld`);
 const config=await configResponse.json();
 const safeConfig={rate_limit_email_sent:config.rate_limit_email_sent,send_email_hook_enabled:config.hook_send_email_enabled,ip_forwarding_enabled:config.security_sb_forwarded_for_enabled,password_verification_hook_enabled:config.hook_password_verification_attempt_enabled,mfa_verification_hook_enabled:config.hook_mfa_verification_attempt_enabled};
 const record={at:new Date().toISOString(),environment,ref,read_only:true,query,readiness:rows?.[0]?.readiness,authConfig:safeConfig,authConfigMutation:'none',emailDispatch:'none'};
 const file=`${privateRoot}/FVI-FAILED-LOGIN-LIVE-READINESS-${environment}-20261004-${Date.now()}.json`,bytes=JSON.stringify(record,null,2);await writeFile(file,bytes);
 output.push({environment,file,sha256:createHash('sha256').update(bytes).digest('hex'),...record});
}
await writeFile('docs/handover/returns/2026-10-03-failed-login-email-packet/revision-2/live-readiness-20261004.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output.map(({query,...record})=>record)));
