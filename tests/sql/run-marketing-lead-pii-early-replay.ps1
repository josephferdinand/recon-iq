param([switch]$IncludeLaterPiiMigration)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$container = "fvi-mkt-pii-early-$PID"
$image = 'supabase/postgres:15.8.1.060'
$containerId = $null
try {
  # No published port, credentials, hosted endpoint or shared database volume.
  $containerId = (docker run --name $container -e POSTGRES_PASSWORD=postgres -d $image).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable PostgreSQL' }
  $consecutive = 0
  for ($attempt=0; $attempt -lt 120 -and $consecutive -lt 10; $attempt++) {
    docker exec $container pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $consecutive++ } else { $consecutive=0 }
    Start-Sleep -Seconds 1
  }
  if ($consecutive -lt 10) { throw 'Disposable PostgreSQL did not stabilize' }
  $migrations = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'supabase/migrations') -Filter '*.sql' |
    Where-Object { $_.Name -le '20260923090100_scope_workspace_audit_reads_early.sql' } |
    Sort-Object Name)
  if ($migrations[-1].Name -ne '20260923090100_scope_workspace_audit_reads_early.sql') {
    throw 'Expected predecessor ledger is absent'
  }
  $sql = [System.Collections.Generic.List[string]]::new()
  $sql.Add('\set ON_ERROR_STOP on')
  $sql.Add('SET client_min_messages = warning;')
  $sql.Add((Get-Content -LiteralPath (Join-Path $repoRoot 'scripts/ci-supabase-bootstrap.sql') -Raw))
  foreach ($migration in $migrations) {
    $sql.Add("\echo migration=$($migration.Name)")
    $sql.Add((Get-Content -LiteralPath $migration.FullName -Raw))
  }
  $regression = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'marketing-lead-pii-early-regression.sql') -Raw
  $sql.Add('\set hardened 0')
  $sql.Add($regression)
  $sql.Add((Get-Content -LiteralPath (Join-Path $repoRoot 'supabase/migrations/20260923090200_marketing_lead_pii_read_boundary_early.sql') -Raw))
  $sql.Add('\set hardened 1')
  $sql.Add($regression)
  if ($IncludeLaterPiiMigration) {
    $later = git -C $repoRoot show 'fvi/marketing-pii-app-integration-20260927:supabase/migrations/20260927160000_mkt_lead_pii_role_boundary.sql'
    if ($LASTEXITCODE -ne 0) { throw 'Later PII migration source unavailable' }
    $sql.Add(($later -join "`n"))
    $sql.Add($regression)
  }
  $sql.Add((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'marketing-lead-pii-early-containment.sql') -Raw))
  $sql.Add('\set hardened 2')
  $sql.Add($regression)
  $output = ($sql -join "`n") | docker exec -i $container psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
  $sqlExit = $LASTEXITCODE
  if ($sqlExit -ne 0) {
    $output | Select-Object -Last 40 | Write-Output
    throw 'Marketing PII early replay failed; see SQL diagnostics above'
  }
  $output | Where-Object { "$_" -match 'regression_PASS' } | Write-Output
  Write-Output "marketing_lead_pii_early_replay_PASS predecessors=$($migrations.Count) laterPii=$IncludeLaterPiiMigration"
} finally {
  if ($containerId) {
    $actualName = docker inspect --format '{{.Name}}' $containerId 2>$null
    $actualImage = docker inspect --format '{{.Config.Image}}' $containerId 2>$null
    if ($actualName -eq "/$container" -and $actualImage -eq $image) {
      docker rm -f $containerId *> $null
    } else {
      throw 'Disposable container identity changed; refusing cleanup'
    }
  }
}
