import fs from 'node:fs';import path from 'node:path';import {chromium} from 'playwright';
const dir=path.resolve('docs/evidence/status-lane-2026-10-03/refinement-20261004/captures');fs.mkdirSync(dir,{recursive:true});const browser=await chromium.launch({headless:true});const records=[];const errors=[];
try{
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4307/',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Unknown service health',exact:true}).waitFor();
  const total=await page.locator('tbody tr').count();if(total!==11)throw new Error('Expected eleven actual source-derived FVI domains');
  if(await page.locator('tbody tr:first-child td.scope-cell').count()!==2)throw new Error('Missing production/development comparison');
  await page.getByLabel('Environment',{exact:true}).selectOption('development');if(await page.locator('tbody tr:first-child td.scope-cell').count()!==1)throw new Error('Environment filter failed');
  await page.getByLabel('Environment',{exact:true}).selectOption('all');
  await page.getByRole('button',{name:'Request subscription',exact:true}).isDisabled().then(disabled=>{if(!disabled)throw new Error('Consent gate missing');});
  await page.getByLabel('Email address',{exact:true}).fill('fixture@example.invalid');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Request subscription',exact:true}).click();await page.getByText('Preview only: no subscription was saved and no email was sent.',{exact:true}).waitFor();
  await page.getByRole('checkbox').uncheck();
  await page.evaluate(()=>window.scrollTo(0,0));await page.getByRole('heading',{name:'System status',exact:true}).isVisible().then(visible=>{if(!visible)throw new Error('Capture did not return to document top');});
  await page.screenshot({path:path.join(dir,`fvi-refined-${name}.png`),fullPage:true});await page.screenshot({path:path.join(dir,`fvi-refined-${name}-first-viewport.png`)});
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));if(dimensions.document>dimensions.viewport)throw new Error(name+' overflow');
  records.push({name,width,height,domains:total,scopeColumns:2,dimensions,consentGuard:'PASS',tier:'actual rendered local source prototype; real telemetry not claimed'});await page.close();
 }
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4307/?scenario=evidence-fixture',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'Outage service health',exact:true}).waitFor();
 await page.locator('tr[data-domain="api"] td[data-cell="production-current"] summary').click();await page.getByText('Reachability only',{exact:true}).waitFor();
 await page.locator('tr[data-domain="copilot"] td[data-cell="production-current"] summary').click();await page.getByText('Stale observation',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Incident history',exact:true}).click();await page.getByText('Synthetic example: delayed source processing',{exact:true}).click();if(await page.locator('.timeline li').count()!==3)throw new Error('Historical versions not preserved');
 await page.screenshot({path:path.join(dir,'fvi-refined-synthetic-evidence-history.png'),fullPage:true});records.push({name:'synthetic evidence/history',versions:3,reachableDoesNotMeanOperational:true,staleVisible:true,tier:'explicitly synthetic; no real outage/MFA/incident/email claim'});await page.close();
 if(errors.length)throw new Error('Page errors: '+errors.join(';'));fs.writeFileSync(path.join(dir,'refinement-capture-receipt.json'),JSON.stringify({at:new Date().toISOString(),result:'PASS',records,errors,hosted:false,real_mfa:false,email_sends:0},null,2));console.log(JSON.stringify({result:'PASS',renders:records.length}));
}finally{await browser.close();}
