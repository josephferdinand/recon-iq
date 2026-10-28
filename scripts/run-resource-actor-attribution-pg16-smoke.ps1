param([switch]$CleanupStoppedPriorClusters)

$ErrorActionPreference = "Stop"
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$initdbExe = Join-Path $pgBin "initdb.exe"
$pgCtlExe = Join-Path $pgBin "pg_ctl.exe"
$psqlExe = Join-Path $pgBin "psql.exe"
$postgresExe = Join-Path $pgBin "postgres.exe"
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$clusterName = "fvi-pg16-actor-smoke-$([guid]::NewGuid().ToString('N'))"
$clusterPath = Join-Path $tempRoot $clusterName
$clusterCreated = $false
$serverStarted = $false
$serverLaunchIssued = $false
$serverProcess = $null
$port = $null

if ($CleanupStoppedPriorClusters) {
  foreach ($candidate in Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'fvi-pg16-actor-smoke-*') {
    $target = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $candidate.FullName).ProviderPath)
    $parent = [System.IO.Path]::GetDirectoryName($target).TrimEnd('\')
    $leaf = [System.IO.Path]::GetFileName($target)
    if ($parent -ine $tempRoot -or $leaf -notmatch '^fvi-pg16-actor-smoke-[a-f0-9]{32}$') { continue }
    if (-not (Test-Path -LiteralPath (Join-Path $target 'PG_VERSION')) -or
        (Get-Content -LiteralPath (Join-Path $target 'PG_VERSION') -Raw).Trim() -ne '16') { continue }

    $pgStatus = & $pgCtlExe -D $target status 2>&1
    $pgStatusExit = $LASTEXITCODE
    if ($pgStatusExit -eq 0 -or ($pgStatus -join ' ') -notmatch 'no server running') { continue }

    $pidPath = Join-Path $target 'postmaster.pid'
    $port = $null
    if (Test-Path -LiteralPath $pidPath) {
      $pidLines = Get-Content -LiteralPath $pidPath
      if ($pidLines.Count -lt 4 -or [System.IO.Path]::GetFullPath($pidLines[1]).Replace('/','\') -ine $target) { continue }
      $candidatePid = 0
      $candidatePort = 0
      if (-not [int]::TryParse($pidLines[0],[ref]$candidatePid) -or -not [int]::TryParse($pidLines[3],[ref]$candidatePort)) { continue }
      if (Get-Process -Id $candidatePid -ErrorAction SilentlyContinue) { continue }
      $port = $candidatePort
    } else {
      $optsPath = Join-Path $target 'postmaster.opts'
      if (-not (Test-Path -LiteralPath $optsPath)) { continue }
      $opts = Get-Content -LiteralPath $optsPath -Raw
      if ($opts -notmatch '"-p"\s+"(\d+)"') { continue }
      $port = [int]$Matches[1]
      if ($opts -notmatch '127\.0\.0\.1') { continue }
    }
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { continue }
    if (-not (Test-Path -LiteralPath (Join-Path $target 'postgresql.conf'))) { continue }

    # Remove only a resolved, direct TEMP child with its PG16 server confirmed stopped.
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-Output "removed_verified_stopped_smoke_cluster=$target"
  }
  exit 0
}

foreach ($exe in @($initdbExe,$pgCtlExe,$psqlExe,$postgresExe)) {
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Required PostgreSQL 16 binary is unavailable: $exe" }
}
$version = (& $postgresExe --version).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^postgres \(PostgreSQL\) 16\.') {
  throw "Installed PostgreSQL binary is not version 16: $version"
}

function Invoke-Pg16SqlFile([string]$Path) {
  & $psqlExe -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -f $Path | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "PG16 isolated smoke SQL failed: $Path" }
}

function Test-Pg16PortStopped([int]$TestPort) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect([System.Net.IPAddress]::Loopback,$TestPort)
    return $false
  } catch [System.Net.Sockets.SocketException] {
    return $true
  } finally {
    $client.Dispose()
  }
}

function Test-OwnedPg16Server {
  $pidPath = Join-Path $clusterPath "postmaster.pid"
  if (-not (Test-Path -LiteralPath $pidPath)) { return $false }
  $pidLines = Get-Content -LiteralPath $pidPath
  if ($pidLines.Count -lt 4) { return $false }
  $resolvedCluster = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $clusterPath).ProviderPath).Replace('\','/')
  $recordedCluster = [System.IO.Path]::GetFullPath($pidLines[1]).Replace('\','/')
  if ($recordedCluster -ine $resolvedCluster -or $pidLines[3].Trim() -ne [string]$port) { return $false }
  $optionsPath = Join-Path $clusterPath "postmaster.opts"
  if (-not (Test-Path -LiteralPath $optionsPath)) { return $false }
  $commandLine = (Get-Content -LiteralPath $optionsPath -Raw).Replace('\','/')
  $statusOutput = & $pgCtlExe -D $clusterPath status 2>&1
  $statusExit = $LASTEXITCODE
  $statusText = ($statusOutput -join "`n").Replace('\','/')
  $listeners = Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue
  $ownsListener = @($listeners | Where-Object OwningProcess -eq ([int]$pidLines[0])).Count -gt 0
  return $statusExit -eq 0 -and $statusOutput -match "PID:\s*$($pidLines[0])" -and
    $commandLine.Contains($resolvedCluster) -and $commandLine.Contains(('"-p" "' + [string]$port + '"')) -and
    $commandLine.Contains('127.0.0.1') -and $statusText.Contains($resolvedCluster) -and $ownsListener
}

try {
  # The OS chooses an ephemeral, currently unbound loopback TCP port.
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()

  New-Item -ItemType Directory -Path $clusterPath | Out-Null
  $clusterCreated = $true
  & $initdbExe -D $clusterPath -U postgres --encoding=UTF8 --no-locale --auth-local=trust --auth-host=trust --no-instructions
  if ($LASTEXITCODE -ne 0) { throw "initdb failed for the isolated PostgreSQL 16 smoke cluster" }

  $logPath = Join-Path $clusterPath "postgres.log"
  $serverErrorPath = Join-Path $clusterPath "postgres.stderr.log"
  $runnerTracePath = Join-Path $clusterPath "runner_trace.log"
  $serverArgs = @('-D',('"' + $clusterPath + '"'),'-h','127.0.0.1','-p',[string]$port,
    '-c','listen_addresses=127.0.0.1','-c','max_connections=20')
  $serverProcess = Start-Process -FilePath $postgresExe -ArgumentList $serverArgs -WindowStyle Hidden `
    -RedirectStandardOutput $logPath -RedirectStandardError $serverErrorPath -PassThru
  $serverLaunchIssued = $true
  for ($attempt = 0; $attempt -lt 10 -and -not $serverStarted; $attempt++) {
    $serverStarted = Test-OwnedPg16Server
    Add-Content -LiteralPath $runnerTracePath -Value "ownership_check attempt=$attempt verified=$serverStarted"
    if (-not $serverStarted -and -not $serverProcess.HasExited) { Start-Sleep -Seconds 1 }
  }
  if (-not $serverStarted) {
    $startOutput = if (Test-Path -LiteralPath $serverErrorPath) { Get-Content -LiteralPath $serverErrorPath -Raw } else { '' }
    throw "PostgreSQL 16 smoke server did not start in the requested isolated cluster: $startOutput"
  }

  Invoke-Pg16SqlFile "tests/sql/resource-actor-attribution-pg16-bootstrap.sql"
  Invoke-Pg16SqlFile "supabase/migrations/20260924234000_resource_actor_attribution.sql"
  Invoke-Pg16SqlFile "supabase/migrations/20260924235000_resource_actor_summary.sql"
  Invoke-Pg16SqlFile "tests/sql/resource-actor-attribution-pg16-smoke.sql"
  Write-Output "resource_actor_attribution_pg16_minimal_smoke_PASS postgres=16 port=$port scope=minimal_fixture_not_full_replay"
} finally {
  $safeToRemove = $false
  if ($clusterCreated) {
    if ($serverLaunchIssued) {
      if (Test-OwnedPg16Server) {
        & $pgCtlExe -D $clusterPath -m fast -w stop
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not confirm PostgreSQL 16 smoke server stop; retaining the cluster directory." }
        else { $serverStarted = $false; $serverLaunchIssued = $false }
      } elseif (-not $serverProcess -or -not $serverProcess.HasExited) {
        Write-Warning "Postmaster PID, data directory, port, or command line no longer match this smoke cluster; retaining it without touching any process."
      }
    }

    if (-not $serverStarted) {
      $statusOutput = & $pgCtlExe -D $clusterPath status 2>&1
      $statusExit = $LASTEXITCODE
      if ($statusExit -ne 0 -and -not (Test-Path -LiteralPath (Join-Path $clusterPath "postmaster.pid"))) {
        if ($port -and -not (Test-Pg16PortStopped $port)) {
          Write-Warning "The smoke port still accepts connections; retaining the verified cluster directory."
        } else {
          $resolvedTarget = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $clusterPath).ProviderPath)
          $resolvedParent = [System.IO.Path]::GetDirectoryName($resolvedTarget).TrimEnd('\')
          $expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
          $resolvedLeaf = [System.IO.Path]::GetFileName($resolvedTarget)
          if ($resolvedParent -ieq $expectedTempRoot -and $resolvedLeaf -ceq $clusterName -and
              $clusterName -match '^fvi-pg16-actor-smoke-[a-f0-9]{32}$' -and $statusOutput -match 'no server running') {
            $safeToRemove = $true
          } else {
            Write-Warning "Resolved smoke cluster path or stopped-server verification did not match; retaining: $resolvedTarget"
          }
        }
      } else {
        Write-Warning "PostgreSQL 16 status/postmaster PID indicates a possibly running server; retaining the cluster directory."
      }
    }
  }

  if ($safeToRemove) {
    # Recursive cleanup is limited to the exact, resolved GUID child under TEMP.
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}
