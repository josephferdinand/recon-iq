# check-brand-assets.ps1
#
# Brand-asset consistency guard (Windows PowerShell). Ensures the monogram and
# favicon SVGs are byte-identical across every FVI surface that ships them.
# Public/ is the single source of truth; everything else MUST be a copy.
#
# Usage:    powershell -ExecutionPolicy Bypass -File scripts\check-brand-assets.ps1
# Exit 0:   every copy matches the canonical source
# Exit 1:   at least one copy is out of sync
#
$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root       = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$Canonical  = Join-Path $Root "public"

# Canonical sources (source of truth)
$sources = @("fv-monogram.svg", "favicon.svg")

# Copies that MUST be byte-identical. Add a row when a new surface ships.
$copies = @(
  "support-docs-site/assets/img/fv-monogram.svg",
  "support-docs-site/favicon.svg",
  "support-docs-site/dist/favicon.svg"
)

$fail = $false

function Get-Md5([string]$path) {
  (Get-FileHash -Algorithm MD5 -Path $path).Hash.ToLower()
}

Write-Host "==> Brand asset consistency check"
Write-Host "    Canonical source: $Canonical"
Write-Host ""

foreach ($asset in $sources) {
  $src = Join-Path $Canonical $asset
  if (-not (Test-Path $src)) {
    Write-Host "ERROR: canonical file missing: $src"
    $fail = $true
    continue
  }
  $srcMd5 = Get-Md5 $src
  Write-Host "    $asset  ($src)  md5=$srcMd5"
  foreach ($copyRel in $copies) {
    $base = Split-Path -Leaf $copyRel
    if ($base -ne $asset) { continue }

    $copy = Join-Path $Root $copyRel
    if (-not (Test-Path $copy)) {
      Write-Host "    MISSING: $copyRel"
      $fail = $true
      continue
    }
    $copyMd5 = Get-Md5 $copy
    if ($srcMd5 -ne $copyMd5) {
      Write-Host "    MISMATCH: $copyRel  md5=$copyMd5 (expected $srcMd5)"
      $fail = $true
    } else {
      Write-Host "    OK: $copyRel"
    }
  }
  Write-Host ""
}

if ($fail) {
  Write-Host "Brand asset check FAILED."
  Write-Host ""
  Write-Host "To fix: copy the canonical file from public/ to the listed copy."
  Write-Host "    Copy-Item public\<asset>.svg <copy-path>"
  Write-Host ""
  Write-Host "If the canonical source itself needs to change, edit public\<asset>.svg"
  Write-Host "FIRST, then re-run this script to confirm all copies are updated."
  exit 1
}

Write-Host "Brand asset check passed: all copies byte-identical to canonical."
exit 0
