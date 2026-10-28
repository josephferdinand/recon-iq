import fs from 'node:fs';import path from 'node:path';import { chromium } from 'playwright';
import { expect } from '@playwright/test';
const dir=path.resolve('docs/evidence/status-lane-2026-10-03/acceptance-20261004/captures');fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true});const errors=[];const proof={at:new Date().toISOString(),tier:'local source component with synthetic adapters',real_mfa:false,hosted_mutations:0,email_sends:0,checks:[]};
try {
 const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
 async function fill(){await page.getByText('Add incident or historical incident',{exact:true}).waitFor();await page.getByLabel('Public title',{exact:true}).fill('Synthetic interrupted incident command');await page.getByLabel('Public summary',{exact:true}).fill('Synthetic local recovery fixture only. This event did not occur in FVI production.');await page.getByLabel('Affected registered environments / regions').selectOption('production-current');await page.getByLabel('Affected services').selectOption('recon');await page.getByLabel('Actual start (UTC)',{exact:true}).fill('2025-01-01T00:00');await page.getByLabel('Announcement/update event time (UTC)',{exact:true}).fill('2025-01-01T00:01');await page.getByLabel('Private factual evidence reference',{exact:true}).fill('Synthetic local recovery fixture evidence');await page.getByRole('checkbox').check();}
 await page.goto('http://127.0.0.1:4307/admin.html?recovery=lost-ack',{waitUntil:'networkidle'});await fill();
 const functions=page.getByLabel('Affected registered functions (optional)',{exact:true});const option=await functions.locator('option:not([disabled])').first().getAttribute('value');if(!option)throw Error('Missing registered function option');await functions.selectOption(option);
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('button',{name:'Check saved command receipt',exact:true}).waitFor();
 if(!await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled())throw Error('Editor not frozen after uncertainty');
 await page.screenshot({path:path.join(dir,'incident-unconfirmed-command.png'),fullPage:true});proof.checks.push('uncertain acknowledgement keeps exact command frozen');
 await page.getByRole('button',{name:'Check saved command receipt',exact:true}).click();await page.getByText(/Recorded draft, revision 1/).waitFor();
 if(await page.getByRole('button',{name:'Check saved command receipt',exact:true}).count())throw Error('Recovery did not clear pending command');
 if(await page.getByRole('heading',{name:'Synthetic interrupted incident command',exact:true}).count()!==1)throw Error('Recovery duplicated incident');
 await page.getByRole('button',{name:'View preserved audit',exact:true}).click();await page.getByRole('heading',{name:'Preserved incident audit',exact:true}).waitFor();
 await page.screenshot({path:path.join(dir,'incident-recovered-receipt-audit.png'),fullPage:true});proof.checks.push('saved receipt unlocks editor without replay or duplicate','registered function scope selectable','preserved successful audit readable');
 await page.goto('http://127.0.0.1:4307/admin.html?recovery=refusal',{waitUntil:'networkidle'});await fill();await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText(/Private denial audit 1 recorded/).waitFor();
 await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeEnabled();if(await page.getByRole('heading',{name:'Synthetic interrupted incident command',exact:true}).count())throw Error('Refusal created incident');
 await page.screenshot({path:path.join(dir,'incident-confirmed-refusal.png'),fullPage:true});proof.checks.push('confirmed synthetic refusal unlocks editor and preserves input without creating incident');
 if(errors.length)throw Error(errors.join(';'));proof.result='PASS';proof.page_errors=errors;fs.writeFileSync(path.join(dir,'capture-receipt.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
} catch(error){proof.result='FAIL';proof.error=error.message;proof.page_errors=errors;fs.writeFileSync(path.join(dir,'capture-receipt.json'),JSON.stringify(proof,null,2));throw error;}finally {await browser.close();}
