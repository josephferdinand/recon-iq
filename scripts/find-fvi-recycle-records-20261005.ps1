param([switch]$IncludeTempContainer)
$ErrorActionPreference='Stop'
$fviTargets=@(
 './LOCAL_USER\AppData\Local\Temp\fvi-batch4-candidate-20260928',
 './LOCAL_USER\AppData\Local\Temp\fvi-codex-docs-release-20260930',
 './LOCAL_USER\AppData\Local\Temp\fvi-codex-audit-20260930-4746723'
)
$fviSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$fviBin=[IO.Path]::Combine('C:\$Recycle.Bin',$fviSid)
if(-not(Test-Path -LiteralPath $fviBin)){throw 'Current-user C: Recycle Bin unavailable'}
$fviFound=@()
$fviScanned=0
foreach($fviInfo in Get-ChildItem -LiteralPath $fviBin -Force -File -Filter '$I*'){
 $fviScanned++
 if($fviInfo.Length -lt 28 -or $fviInfo.Length -gt 65536){continue}
 $fviBytes=[IO.File]::ReadAllBytes($fviInfo.FullName)
 $fviVersion=[BitConverter]::ToInt64($fviBytes,0)
 if($fviVersion -eq 2){
  $fviChars=[BitConverter]::ToInt32($fviBytes,24)
  if($fviChars -lt 1 -or 28+2*$fviChars -gt $fviBytes.Length){continue}
  $fviOriginal=[Text.Encoding]::Unicode.GetString($fviBytes,28,2*$fviChars).TrimEnd([char]0)
 }elseif($fviVersion -eq 1){
  $fviOriginal=[Text.Encoding]::Unicode.GetString($fviBytes,24,$fviBytes.Length-24).TrimEnd([char]0)
 }else{continue}
 try{$fviOriginal=[IO.Path]::GetFullPath($fviOriginal)}catch{continue}
 if($IncludeTempContainer -and $fviOriginal -eq './LOCAL_USER\AppData\Local\Temp'){
  $fviContainer=Join-Path $fviBin ('$R'+$fviInfo.Name.Substring(2))
  foreach($fviContainerTarget in $fviTargets){
   $fviContainerChild=Join-Path $fviContainer ([IO.Path]::GetFileName($fviContainerTarget))
   if(Test-Path -LiteralPath $fviContainerChild){$fviFound += [pscustomobject]@{Target=$fviContainerTarget;OriginalPath=$fviContainerTarget;DataPath=$fviContainerChild;MetadataPath=$fviInfo.FullName;DeletedAtUtc=[DateTime]::FromFileTimeUtc([BitConverter]::ToInt64($fviBytes,16)).ToString('o');DataPresent=$true;RestoreMode='Specific FVI child inside deleted Temp container'}}
  }
  continue
 }
 $fviTarget=$fviTargets | Where-Object { $fviOriginal -eq $_ -or $fviOriginal.StartsWith($_+'\',[StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
 if($null -eq $fviTarget){continue}
 $fviData=Join-Path $fviBin ('$R'+$fviInfo.Name.Substring(2))
 $fviFound += [pscustomobject]@{
  Target=$fviTarget;OriginalPath=$fviOriginal;DataPath=$fviData;MetadataPath=$fviInfo.FullName
  DeletedAtUtc=[DateTime]::FromFileTimeUtc([BitConverter]::ToInt64($fviBytes,16)).ToString('o')
  DataPresent=Test-Path -LiteralPath $fviData
 }
}
$fviReceipt=[pscustomobject]@{AtUtc=[DateTime]::UtcNow.ToString('o');MetadataRecordsScanned=$fviScanned;Matched=$fviFound.Count;Records=$fviFound;FileContentsRead=$false;OtherProjectContentsRead=$false;Restored=$false}
$fviSuffix=if($IncludeTempContainer){'_TEMP_CONTAINER'}else{''}
$fviOutput=Join-Path (Get-Location).Path ('docs\evidence\FVI_RECYCLE_RECOVERY_INVENTORY_2026-10-05'+$fviSuffix+'.json')
if(Test-Path -LiteralPath $fviOutput){throw 'Existing recycle inventory must be preserved'}
$fviReceipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $fviOutput -Encoding utf8
[pscustomobject]@{MetadataScanned=$fviScanned;Matched=$fviFound.Count;Present=@($fviFound|Where-Object DataPresent).Count;Receipt=$fviOutput} | ConvertTo-Json
