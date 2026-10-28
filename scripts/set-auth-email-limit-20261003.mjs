import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const mode=process.argv[2]??'inspect';if(!['inspect','apply'].includes(mode))throw Error('Use inspect or apply');
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw Error('Canonical credential section unavailable');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Management access unavailable');
const digest=x=>createHash('sha256').update(x).digest('hex');
const senderFields=['smtp_host','smtp_port','smtp_user','smtp_admin_email','smtp_sender_name','hook_send_email_enabled','hook_send_email_uri'];
function safe(config){return {rate_limit_email_sent:config.rate_limit_email_sent,sender:Object.fromEntries(senderFields.map(k=>[k,config[k]??null])),smtpCredentialReturned:typeof config.smtp_pass==='string'&&config.smtp_pass.length>0,smtpCredentialFingerprint:typeof config.smtp_pass==='string'&&config.smtp_pass.length>0?digest(config.smtp_pass):null};}
async function config(ref,method='GET',body){const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`${ref} Auth config ${method} HTTP${response.status}; response withheld`);return response.json();}
async function hookSender(ref,sender){
 const expected=`https://${ref}.functions.supabase.co/send-email`;
 if(sender.hook_send_email_enabled!==true||sender.hook_send_email_uri!==expected)throw Error('Expected FVI email hook binding unavailable');
 const headers={authorization:`Bearer ${token}`};
 const metaResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/send-email`,{headers,signal:AbortSignal.timeout(30000)});
 if(!metaResponse.ok)throw Error(`Email hook metadata HTTP${metaResponse.status}`);
 const meta=await metaResponse.json();
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/send-email/body`,{headers,signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Email hook source HTTP${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer()),source=bytes.toString('utf8');
 if(!source.includes('api.zeptomail.in')||!source.includes('ZEPTO_MAIL_API_TOKEN'))throw Error('Deployed hook source does not prove expected ZeptoMail sender');
 return {type:'send-email hook',uri:expected,slug:meta.slug??'send-email',version:meta.version??null,status:meta.status??null,sourceSha256:digest(bytes),sourceBytes:bytes.length,provider:'ZeptoMail',providerOrigin:'https://api.zeptomail.in'};
}
for(const [environment,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 const beforeRaw=await config(ref),before=safe(beforeRaw);
 const settingsFingerprints=raw=>Object.fromEntries(Object.keys(raw).filter(k=>k!=='rate_limit_email_sent').sort().map(k=>[k,digest(JSON.stringify(raw[k]))]));
 const beforeSettings=settingsFingerprints(beforeRaw);
 const zeptoMailConfigured=/(^|\.)zeptomail\.[a-z.]+$/i.test(String(before.sender.smtp_host??'').trim());
 const hook=zeptoMailConfigured?null:await hookSender(ref,before.sender);
 if(mode==='inspect'){console.log(JSON.stringify({environment,ref,rateLimitPerHour:before.rate_limit_email_sent,smtpHost:before.sender.smtp_host,smtpPort:before.sender.smtp_port,hook,zeptoMailConfigured:zeptoMailConfigured||Boolean(hook)}));continue;}
 if(Number(before.rate_limit_email_sent)!==999)await config(ref,'PATCH',{rate_limit_email_sent:999});
 const afterRaw=await config(ref),after=safe(afterRaw),afterSettings=settingsFingerprints(afterRaw);
 const changedOtherFields=[...new Set([...Object.keys(beforeSettings),...Object.keys(afterSettings)])].filter(k=>beforeSettings[k]!==afterSettings[k]);
 if(changedOtherFields.length)throw Error(`${environment} other Auth settings changed during verification; field names: ${changedOtherFields.join(',')}`);
 if(Number(after.rate_limit_email_sent)!==999||JSON.stringify(before.sender)!==JSON.stringify(after.sender)||before.smtpCredentialFingerprint!==after.smtpCredentialFingerprint)throw Error(`${environment} Auth rate/sender readback mismatch; reconcile before retry`);
 const afterHook=hook?await hookSender(ref,after.sender):null;
 if(JSON.stringify(hook)!==JSON.stringify(afterHook))throw Error('Email hook changed during rate update');
 const receipt={at:new Date().toISOString(),environment,ref,authorization:'Owner explicitly requested999/hour; preserve ZeptoMail; FVI PROD/DEV parity',patchFields:['rate_limit_email_sent'],before,after,hook,allOtherSettingsFingerprintBefore:beforeSettings,allOtherSettingsFingerprintAfter:afterSettings,allOtherSettingsUnchanged:true,verified:true,emailsSentForVerification:0};
 const file=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-AUTH-EMAIL-LIMIT-${environment}-20261003-${Date.now()}.json`;
 await writeFile(file,JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({environment,ref,beforeLimit:before.rate_limit_email_sent,afterLimit:after.rate_limit_email_sent,limitPerHour:999,smtpHost:after.sender.smtp_host,hook,senderSettingsUnchanged:true,allOtherAuthSettingsUnchanged:true,allOtherSettingCount:Object.keys(beforeSettings).length,credentialFingerprintChecked:before.smtpCredentialReturned&&after.smtpCredentialReturned,receipt:file,verified:true}));
}
