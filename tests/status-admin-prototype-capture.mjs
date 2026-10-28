import fs from 'node:fs';import path from 'node:path';import {chromium} from 'playwright';
const dir=path.resolve('docs/design/status-prototype-20261004/captures');const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4307/admin.html',{waitUntil:'networkidle'});
await page.getByText('Add incident or historical incident',{exact:true}).waitFor();
await page.getByLabel('Public title',{exact:true}).fill('Synthetic historical incident workflow');await page.getByLabel('Public summary',{exact:true}).fill('Synthetic fixture only. No real production incident is represented.');
await page.getByLabel('Affected registered environments / regions').selectOption('production-current');await page.getByLabel('Affected services').selectOption('api');
await page.getByLabel('Actual start (UTC)',{exact:true}).fill('2025-01-01T00:00');await page.getByLabel('Announcement/update event time (UTC)',{exact:true}).fill('2025-01-01T00:01');
await page.getByLabel('Private factual evidence reference',{exact:true}).fill('Synthetic source-prototype evidence only');await page.getByRole('checkbox').check();
await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('heading',{name:'Synthetic historical incident workflow',exact:true}).waitFor();
await page.getByLabel('Reason for submit, review or publish').fill('Synthetic independently reviewed historical fixture');await page.getByRole('button',{name:'Submit for review',exact:true}).click();
await page.getByText('A separate current platform administrator must review and publish this revision.').waitFor();await page.getByRole('button',{name:'Use synthetic reviewer',exact:true}).click();
await page.getByRole('button',{name:'Approve reviewed content',exact:true}).click();await page.getByRole('button',{name:'Publish reviewed revision',exact:true}).click();
await page.getByRole('button',{name:'Append correction',exact:true}).waitFor();await page.getByRole('button',{name:'View preserved audit',exact:true}).click();await page.getByRole('heading',{name:'Preserved incident audit',exact:true}).waitFor();
await page.getByText('Review exact revision content and prior versions',{exact:true}).click();await page.screenshot({path:path.join(dir,'desktop-synthetic-admin-published-audit.png'),fullPage:true});
if(errors.length)throw new Error('Prototype runtime error: '+errors.join(';'));fs.writeFileSync(path.join(dir,'admin-capture-receipt.json'),JSON.stringify({at:new Date().toISOString(),result:'PASS',flow:['draft','submit','independent fixture review','fixture publish','preserved audit'],tier:'synthetic local source-component prototype',hosted:false,real_mfa:false,email_sends:0},null,2));console.log(JSON.stringify({result:'PASS',capture:'desktop-synthetic-admin-published-audit.png'}));
}finally{await browser.close();}
