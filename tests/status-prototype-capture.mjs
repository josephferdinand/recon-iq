import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const dir=path.resolve('docs/design/status-prototype-20261004/captures'); fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true});
const issues=[]; const records=[];
try {
  for(const [name,width,height] of [['desktop',1366,900],['mobile',390,844]]) {
    const page=await browser.newPage({viewport:{width,height},colorScheme:'light',reducedMotion:'reduce'});
    page.on('pageerror',error=>issues.push({capture:name,error:error.message}));
    await page.goto('http://127.0.0.1:4307/',{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'System status',exact:true}).waitFor();
    if(!await page.getByRole('heading',{name:'Unknown service health',exact:true}).isVisible()) throw new Error('Unknown health state missing.');
    await page.getByLabel('Environment',{exact:true}).selectOption('development');
    if(await page.locator('tbody tr').count()!==8) throw new Error('Environment filter did not bound the service list.');
    await page.getByLabel('Environment',{exact:true}).selectOption('all');
    await page.screenshot({path:path.join(dir,`${name}-source-unknown.png`),fullPage:true});
    const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    records.push({name,width,height,overflow,url:page.url(),tier:'local source prototype; no live registry/probes/MFA'});
    if(overflow.document>overflow.viewport) throw new Error(`Document overflow in ${name}`);
    await page.close();
  }
  const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:4307/?scenario=synthetic',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Incident history',exact:true}).click();
  await page.getByText('Synthetic example: delayed source processing',{exact:true}).click();
  if(await page.locator('.timeline li').count()!==3) throw new Error('Preserved three-version synthetic timeline missing.');
  await page.screenshot({path:path.join(dir,'desktop-synthetic-historical-correction.png'),fullPage:true});
  records.push({name:'synthetic historical correction',url:page.url(),versions:3,tier:'synthetic fixture; no factual incident claim'});
  await page.close();
  if(issues.length) throw new Error('Prototype page errors.');
  fs.writeFileSync(path.join(dir,'capture-receipt.json'),JSON.stringify({at:new Date().toISOString(),result:'PASS',records,issues,hosted:false,real_mfa:false,email_sends:0},null,2));
  console.log(JSON.stringify({result:'PASS',captures:records.length,dir}));
} finally {await browser.close();}
