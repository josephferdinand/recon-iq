import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const privateRoot = './LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const vault = await readFile('./.private/CREDENTIALS.md', 'utf8');
const start = vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->');
const end = vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if (start < 0 || end <= start) throw Error('Canonical credential markers absent');
const token = vault.slice(start, end).split(/\r?\n/).find(x => /^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g, '');
if (!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token ?? '')) throw Error('Management access unavailable');
const query = `SELECT jsonb_build_object(
 'ledger',(SELECT jsonb_build_object('count',count(*),'latest',max(version::text)) FROM supabase_migrations.schema_migrations),
 'engine',current_setting('server_version_num'),
 'columns',(SELECT jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'name',column_name,'type',udt_name,'nullable',is_nullable,'default',column_default,'identity',is_identity,'identity_generation',identity_generation) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns WHERE (table_schema='auth' AND table_name IN ('users','audit_log_entries','mfa_factors','mfa_challenges')) OR (table_schema='public' AND table_name IN ('email_send_log','email_send_state','security_events','rate_limit_buckets','tenant_conditional_access_policies')) OR (table_schema='pgmq' AND table_name IN ('q_transactional_emails','q_transactional_emails_dlq'))),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.conname,'definition',pg_get_constraintdef(t.oid)) ORDER BY n.nspname,c.relname,t.conname) FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('email_send_log','email_send_state','security_events','rate_limit_buckets')),
 'relations',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='auth' AND c.relname IN ('users','audit_log_entries')) OR (n.nspname='public' AND c.relname IN ('email_send_log','email_send_state','security_events','rate_limit_buckets')) OR(n.nspname='pgmq' AND c.relname='q_transactional_emails')),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND ((n.nspname='public' AND (p.proname IN ('enqueue_email','read_email_batch','delete_email','move_to_dlq','rate_limit_hit') OR p.proname LIKE 'failed_login_%')) OR(n.nspname='pgmq' AND p.proname IN ('send','delete','read','format_table_name')))),
 'composite_types',(SELECT jsonb_agg(jsonb_build_object('name',t.typname,'fields',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=t.typrelid AND a.attnum>0 AND NOT a.attisdropped))) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='pgmq' AND t.typname='message_record'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN ('email_send_log','email_send_state','security_events','rate_limit_buckets')),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',extname,'version',extversion)) FROM pg_extension WHERE extname IN ('pgmq','pgcrypto','pg_cron'))
) AS catalog;`;
await writeFile(`${privateRoot}/FVI-FAILED-LOGIN-CATALOG-QUERY-20261003.sql`,query);
for (const [environment, ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]) {
 const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method:'POST', headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' }, body:JSON.stringify({read_only:true,query}), signal:AbortSignal.timeout(30000) });
 if (!response.ok) throw Error(`${environment} metadata HTTP${response.status}; body withheld`);
 const rows = await response.json(); const catalog=rows?.[0]?.catalog;
 if (!catalog?.ledger) throw Error('Metadata absent');
 const configResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 let authConfig={readStatus:configResponse.status};
 if(configResponse.ok){const config=await configResponse.json(); authConfig={...authConfig,...Object.fromEntries(Object.entries(config).filter(([key])=>/^(hook_(password_verification_attempt|mfa_verification_attempt)_(enabled|uri)|rate_limit_token_refresh|rate_limit_verify|security_sb_forwarded_for_enabled|security_captcha_enabled|security_captcha_provider|site_url)$/.test(key)))};}
 const keyResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=false`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 const keyMetadata=keyResponse.ok?(await keyResponse.json()).map(k=>({name:k.name,type:k.type,id:k.id})):[];
 const file=`${privateRoot}/FVI-FAILED-LOGIN-CATALOG-${environment}-20261003.json`;
 const bytes=JSON.stringify({at:new Date().toISOString(),ref,read_only:true,query,rows,authConfig,keyMetadata},null,2); await writeFile(file,bytes);
 console.log(JSON.stringify({environment,file,sha256:createHash('sha256').update(bytes).digest('hex'),ledger:catalog.ledger,engine:catalog.engine,columnCount:catalog.columns?.length,helpers:catalog.helpers?.map(x=>x.name),authConfig,keyMetadata}));
}
