$ErrorActionPreference = "Stop"
$containerName = "fvi-access-summary-$PID"
$image = "supabase/postgres:15.8.1.060"
$containerId = $null
$applied = 0
function Invoke-SqlFile([string]$Path) {
  Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | docker exec -i $containerId psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "SQL failed: $Path" }
}
try {
  $containerId = (docker run --name $containerName -e POSTGRES_PASSWORD=postgres -d $image).Trim()
  if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[0-9a-f]{64}$') { throw "Could not start disposable FVI Postgres" }
  $ready = 0
  for ($attempt=0; $attempt -lt 120 -and $ready -lt 10; $attempt++) {
    docker exec $containerId pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready++ } else { $ready=0 }
    Start-Sleep -Seconds 1
  }
  if ($ready -lt 10) { throw "Disposable FVI Postgres did not remain ready" }
  Invoke-SqlFile "scripts/ci-supabase-bootstrap.sql"
  foreach ($migration in (Get-ChildItem -LiteralPath "supabase/migrations" -File -Filter "*.sql" | Sort-Object Name)) {
    Invoke-SqlFile $migration.FullName
    $applied++
  }
  Invoke-SqlFile "tests/sql/data-resource-typed-registry-regression.sql"
  Invoke-SqlFile "tests/sql/reconciliation-multi-bu-shadow-authorization-regression.sql"
  Invoke-SqlFile "tests/sql/data-resource-access-summary-regression.sql"
  Write-Output "data_resource_access_summary_replay_PASS migrations=$applied direct_call_privileges=PASS batch_caps=PASS schedule_root=PASS"
} finally {
  if ($containerId -match '^[0-9a-f]{64}$') {
    $actual = docker inspect --format '{{.Id}}' $containerId 2>$null
    if ($LASTEXITCODE -eq 0 -and $actual -eq $containerId) { docker rm -f $containerId *> $null }
  }
}
