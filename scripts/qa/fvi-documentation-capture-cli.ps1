param(
  [Parameter(Mandatory=$true)][string]$PlanPath,
  [Parameter(Mandatory=$true)][string]$PrivateOutput,
  [Parameter(Mandatory=$true)][string]$ActorLabel,
  [string]$BrowserStatePath,
  [string]$SessionName='leibniz-docs-current',
  [switch]$Anonymous,
  [switch]$ReuseBrowser
)
$ErrorActionPreference='Stop'
if($SessionName -notmatch '^leibniz-docs-[a-z0-9-]+$'){throw 'Use a dedicated documentation browser session.'}
if(-not$Anonymous -and $ActorLabel -notmatch '(?i)docs|documentation|leibniz'){throw 'An explicitly assigned Docs actor label is required.'}
if(-not$Anonymous -and (-not$BrowserStatePath -or -not(Test-Path -LiteralPath $BrowserStatePath))){throw 'Assigned private Docs browser state is required.'}
$plan=@(Get-Content -LiteralPath $PlanPath -Raw|ConvertFrom-Json)
if(-not$plan.Count){throw 'Capture plan is empty.'}
foreach($item in $plan){
  $uri=[uri]$item.url
  if($uri.Scheme -ne 'https' -or $uri.Host -notin @('app.reconiq.example','dev.app.reconiq.example')){throw 'Capture target must be a canonical FVI PROD/DEV HTTPS host.'}
  if($item.id -notmatch '^[a-z0-9-]+$'){throw 'Capture identifier must be a safe filename.'}
  if($Anonymous -and $uri.AbsolutePath -notin @('/auth','/support','/reset-password','/developers','/developers/guides','/developers/api-reference','/developers/changelog')){throw 'An authenticated page requires its assigned Docs state.'}
}
New-Item -ItemType Directory -Path $PrivateOutput -Force|Out-Null
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl','ContainerInherit,ObjectInherit','None','Allow')))
Set-Acl -LiteralPath $PrivateOutput -AclObject $acl
$cli=(Get-Command npx.cmd -ErrorAction Stop).Source
$open=Join-Path $PrivateOutput 'browser-open.log'
if(-not$ReuseBrowser){
& $cli --yes --package '@playwright/cli' playwright-cli "-s=$SessionName" --raw open $plan[0].url --headed *> $open
if($LASTEXITCODE -ne 0){throw 'Documentation browser could not open; private log retained.'}
if(-not$Anonymous){
  & $cli --yes --package '@playwright/cli' playwright-cli "-s=$SessionName" --raw state-load $BrowserStatePath *> (Join-Path $PrivateOutput 'state-load.log')
  if($LASTEXITCODE -ne 0){throw 'Assigned Docs state could not load; private log retained.'}
}
}
$template=@'
async(page)=>{
 const item=__ITEM__;const atUTC=new Date().toISOString();
 await page.setViewportSize({width:1660,height:1050});
 const response=await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForTimeout(1200);
 for(let attempt=0;attempt<30;attempt++){const ready=await page.evaluate(()=>{const t=(document.querySelector("main")||document.body).innerText.trim();return t.length>80&&!/^(Skip to main content\s*)?(Resolving access|Checking access|Loading)[\s.…]*$/i.test(t)});if(ready)break;await page.waitForTimeout(1000);}
 await page.waitForTimeout(1800);
 const tourClose=page.locator('.driver-popover-close-btn');
 if(await tourClose.isVisible()){await tourClose.click();await page.waitForTimeout(800);}
 for(let attempt=0;attempt<15;attempt++){const pending=await page.evaluate(()=>[...document.querySelectorAll('[role=status],[role=alert]')].some(e=>/^Loading\b/i.test(e.textContent.trim())));if(!pending)break;await page.waitForTimeout(1000);}
 if(item.extraWaitMS){await page.waitForTimeout(Math.min(15000,Math.max(0,item.extraWaitMS)));}
 let openedControl=null;
 if(item.viewRowText){const view=page.getByRole('button',{name:'View '+item.viewRowText,exact:true}).first();if(await view.isVisible()){await view.click();openedControl='View / '+item.viewRowText;await page.waitForTimeout(1200);}}
 if(item.openButton){
  const trigger=page.getByRole('button',{name:item.openButton,exact:true}).first();
  if(await trigger.isVisible()&&await trigger.isEnabled()){await trigger.click();openedControl=item.openButton;await page.waitForTimeout(1000);}
 }
 if(item.tab){
  const tab=page.getByRole('tab',{name:item.tab,exact:true}).first();
  if(await tab.isVisible()&&await tab.isEnabled()){await tab.click();openedControl=item.tab;await page.waitForTimeout(1000);}
 }
 if(Number.isInteger(item.modeIndex)&&openedControl==='New reconciliation'){
  const choices=page.getByRole('dialog').last().getByRole('button',{name:/^Select/});
  if(await choices.count()===3&&item.modeIndex>=0&&item.modeIndex<3){await choices.nth(item.modeIndex).click();openedControl+=' / '+['Single Side','Two-Sided','Tri-Party'][item.modeIndex];await page.waitForTimeout(1200);}
 }
 if(item.secondaryButton&&openedControl){const secondary=page.getByRole('dialog').last().getByRole('button',{name:item.secondaryButton,exact:true}).first();if(await secondary.isVisible()&&await secondary.isEnabled()){await secondary.click();openedControl+=' / '+item.secondaryButton;await page.waitForTimeout(600);}}
 const safeURL=u=>{const x=new URL(u);const p=new URLSearchParams();if(x.searchParams.has('page'))p.set('page',x.searchParams.get('page'));return x.origin+x.pathname+(p.size?'?'+p.toString():'');};
 const meta=await page.evaluate(()=>{
  const clean=t=>(t||'').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email omitted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token omitted]').replace(/https?:\/\/[^\s<>]*\?[^\s<>]*(?:token|signature|code|key|secret)=[^\s<>]*/gi,'[private URL omitted]').replace(/\s+/g,' ').trim();
  const root=document.querySelector('main')||document.body;const labels=el=>{const id=el.id;const l=id?document.querySelector('label[for="'+CSS.escape(id)+'"]'):null;return clean(el.getAttribute('aria-label')||l?.textContent||el.getAttribute('name')||el.getAttribute('placeholder')||el.tagName);};
  const dialogs=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(e=>e.getBoundingClientRect().width>0);
  const scope=dialogs.length?dialogs[dialogs.length-1]:root; const skeletons=[...root.querySelectorAll(".animate-pulse")].filter(e=>{const b=e.getBoundingClientRect();return b.width>80&&b.height>20}).length;
  return {title:clean(document.title),privatePageText:clean(scope.innerText).slice(0,18000),dialogOpen:dialogs.length>0,skeletonCount:skeletons,headings:[...scope.querySelectorAll('h1,h2,h3')].map(e=>clean(e.textContent)),fields:[...scope.querySelectorAll('input,select,textarea,[role=combobox]')].map(e=>({label:labels(e),kind:e.getAttribute('type')||e.getAttribute('role')||e.tagName.toLowerCase(),required:e.required||e.getAttribute('aria-required')==='true',disabled:e.disabled||e.getAttribute('aria-disabled')==='true',min:e.getAttribute('min'),max:e.getAttribute('max'),maxLength:e.getAttribute('maxlength')})),actions:[...scope.querySelectorAll('button')].map(e=>({label:clean(e.getAttribute('aria-label')||e.textContent),disabled:e.disabled||e.getAttribute('aria-disabled')==='true'})),alerts:[...document.querySelectorAll('[role=alert],[role=status]')].map(e=>clean(e.textContent)).filter(Boolean),assetPaths:[...document.querySelectorAll('script[src],link[rel=stylesheet]')].map(e=>new URL(e.src||e.href).pathname),authGate:!!document.querySelector('input[type=password]')&&/Sign In|Welcome back/i.test(document.body.textContent),loading:skeletons>0||root.innerText.trim().length<80||/^(Skip to main content\s*)?(Resolving access|Checking access|Loading)[\s.…]*$/i.test(root.innerText.trim())||/^Loading\b/im.test(root.innerText)};
 });
 const raw=__RAW__;const derivative=__DERIVATIVE__;
 await page.screenshot({path:raw,fullPage:item.fullPage===true,scale:'css'});
 const defaults=['input[type=password]','input[autocomplete=one-time-code]','input[name*=token i]','input[name*=secret i]','input[name*=apikey i]','input[name*=api_key i]','img[alt*=QR i]','canvas[aria-label*=QR i]','pre:has-text("Bearer ey")','code:has-text("Bearer ey")'];
 const masks=[...defaults,...(item.maskSelectors||[])].map(s=>page.locator(s));
 if(item.maskNonQARows){const rows=page.getByRole('row');const count=await rows.count();for(let i=1;i<count;i++){const row=rows.nth(i);if(!/(?:Docs QA|Documentation QA|Assurance Lab|FVI QA|synthetic)/i.test(await row.innerText()))masks.push(row);}}
 if(meta.dialogOpen){await page.getByRole('dialog').last().screenshot({path:derivative,scale:'css',mask:masks,maskColor:'#d7e0e6'});}
 else{await page.screenshot({path:derivative,fullPage:item.fullPage===true,scale:'css',mask:masks,maskColor:'#d7e0e6'});}
 return {id:item.id,atUTC,environment:item.environment,releaseBasis:item.releaseBasis,actorLabel:__ACTOR__,roleBasis:item.roleBasis||'assigned state / runtime authority requires separate verification',url:safeURL(page.url()),requestedURL:safeURL(item.url),httpStatus:response?.status(),openedControl,observedState:meta.authGate?'AUTH_GATE':meta.loading?'LOADING_OBSERVED':meta.alerts.length?'RENDER_WITH_STATUS_OR_ALERT':'RENDER_OBSERVED',raw,derivative,metadata:meta,review:'REVIEW_REQUIRED; derivative remains private until image/content review',workflowProof:'Navigation/render and optional read-only form/tab opening; no business submissions'};
}
'@
$results=@()
foreach($item in $plan){
  $raw=Join-Path $PrivateOutput ($item.id+'-raw.png');$derivative=Join-Path $PrivateOutput ($item.id+'-review.png')
  $code=$template.Replace('__ITEM__',($item|ConvertTo-Json -Depth 8 -Compress)).Replace('__RAW__',($raw|ConvertTo-Json -Compress)).Replace('__DERIVATIVE__',($derivative|ConvertTo-Json -Compress)).Replace('__ACTOR__',($ActorLabel|ConvertTo-Json -Compress))
  $script=Join-Path $PrivateOutput ($item.id+'-capture.js');Set-Content -LiteralPath $script -Value $code -Encoding utf8
  $receipt=Join-Path $PrivateOutput ($item.id+'-receipt.json')
  & $cli --yes --package '@playwright/cli' playwright-cli "-s=$SessionName" --raw run-code --filename $script > $receipt 2> (Join-Path $PrivateOutput ($item.id+'-cli.log'))
  if($LASTEXITCODE -ne 0){Write-Output ('Capture failed: '+$item.id+'; private evidence retained.');continue}
  $result=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
  $result|Add-Member -NotePropertyName rawSHA256 -NotePropertyValue (Get-FileHash -LiteralPath $raw).Hash
  $result|Add-Member -NotePropertyName derivativeSHA256 -NotePropertyValue (Get-FileHash -LiteralPath $derivative).Hash
  $result|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $receipt -Encoding utf8
  $results+=$result
  Write-Output ('Captured '+$item.id+': '+$result.observedState+'; public release pending review.')
}
$results|ConvertTo-Json -Depth 14|Set-Content -LiteralPath (Join-Path $PrivateOutput 'capture-ledger.json') -Encoding utf8
Write-Output ('Retained '+$results.Count+' capture receipts in private documentation custody.')





