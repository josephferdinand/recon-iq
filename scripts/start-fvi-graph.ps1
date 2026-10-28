param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8765
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$graphRoot = Join-Path $projectRoot "graphify-out"
$graphFile = Join-Path $graphRoot "graph.html"

if (-not (Test-Path -LiteralPath $graphFile -PathType Leaf)) {
  throw "Graphify output is missing: $graphFile"
}

$existing = Get-NetTCPConnection `
  -LocalAddress 127.0.0.1 `
  -LocalPort $Port `
  -State Listen `
  -ErrorAction SilentlyContinue

if (-not $existing) {
  $python = (Get-Command python -ErrorAction Stop).Source
  Start-Process `
    -FilePath $python `
    -ArgumentList @("-m", "http.server", "$Port", "--bind", "127.0.0.1") `
    -WorkingDirectory $graphRoot `
    -WindowStyle Hidden | Out-Null

  Start-Sleep -Seconds 2
}

$url = "http://127.0.0.1:$Port/graph.html"
$response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
if ($response.StatusCode -ne 200) {
  throw "Graph server did not return HTTP 200: $url"
}

Write-Output $url
