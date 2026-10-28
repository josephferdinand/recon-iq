import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const previousKey=process.env.APP_DATA_ENC_KEY,previousMode=process.env.NODE_ENV;
let checks=0;
try {
 process.env.NODE_ENV='production';delete process.env.APP_DATA_ENC_KEY;
 const vault=await import(base+'/src/lib/vault.server.ts');checks++;
 const adapter=vault.getAdapter('meta_managed','APP_DATA_ENC_KEY');
 await assert.rejects(adapter.wrap(new Uint8Array(32)),/Secure credential storage is unavailable/);checks++;
 process.env.APP_DATA_ENC_KEY='short';await assert.rejects(adapter.wrap(new Uint8Array(32)),/Secure credential storage is unavailable/);checks++;
 process.env.APP_DATA_ENC_KEY='SYNTHETIC_ONLY_LOCAL_ENCRYPTION_TEST_20261005';
 const data=new Uint8Array(32).fill(23),wrapped=await adapter.wrap(data);assert.deepEqual(await adapter.unwrap(wrapped),data);checks++;
 delete process.env.APP_DATA_ENC_KEY;await assert.rejects(adapter.wrap(data),/Secure credential storage is unavailable/);checks++;
 const server=await import(base+'/src/server.ts');
 const response=await server.hardenEdgeResponse(new Response('<html><body>Safe error</body></html>',{status:500,headers:{'content-type':'text/html','x-ssr-error':'PRIVATE_DIAGNOSTIC_MARKER'}}),new Request('https://app.reconiq.example/auth'));
 assert.equal(response.headers.get('x-ssr-error'),null);assert.equal(response.headers.get('x-fvi-csp-nonce-applied'),'1');assert.ok(!(await response.text()).includes('PRIVATE_DIAGNOSTIC_MARKER'));checks++;
 const page=await import(base+'/src/lib/error-page.ts');assert.ok(page.renderErrorPage('FVI-ABCDEF123456').includes('FVI-ABCDEF123456'));checks++;
 const receipt={at:new Date().toISOString(),checks,passed:true,fixture:'synthetic local key only; no provider/database/real key/session',hostedAcceptance:false};
 await writeFile('output/parent-integrated-next-20261005/preview-startup-repair/FOCUSED-CHECKS.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
}finally{if(previousKey===undefined)delete process.env.APP_DATA_ENC_KEY;else process.env.APP_DATA_ENC_KEY=previousKey;if(previousMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousMode;}
