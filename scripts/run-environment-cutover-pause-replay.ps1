$ErrorActionPreference = "Stop"
$containerName = "fvi-environment-cutover-pause-$PID"
$containerId = $null
$version = "20260923132900_environment_change_cutover_pause.sql"
$applied = 0

function Invoke-SqlFile([string]$Path) {
  $result = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
    docker exec -i $containerId psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
  if ($LASTEXITCODE -ne 0) {
    $result | Select-String -Pattern 'ERROR:|CONTEXT:' | Select-Object -Last 8 | ForEach-Object { Write-Output $_.Line }
    throw "SQL failed: $Path"
  }
}

try {
  # Disposable FVI-only database; no published port or hosted credentials.
  $containerId = (docker run --name $containerName -e POSTGRES_PASSWORD=postgres -d supabase/postgres:15.8.1.060).Trim()
  if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[0-9a-f]{64}$') { throw "Disposable Postgres did not start" }
  $ready = 0
  for ($attempt = 0; $attempt -lt 120 -and $ready -lt 10; $attempt++) {
    docker exec $containerId pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready++ } else { $ready = 0 }
    Start-Sleep -Seconds 1
  }
  if ($ready -lt 10) { throw "Disposable Postgres did not remain ready" }
  Invoke-SqlFile "scripts/ci-supabase-bootstrap.sql"
  Invoke-SqlFile "tests/sql/tenant-email-domain-auth-compat.sql"
  $found = $false
  foreach ($migration in (Get-ChildItem -LiteralPath "supabase/migrations" -File -Filter "*.sql" | Sort-Object Name)) {
    Invoke-SqlFile $migration.FullName
    $applied++
    if ($migration.Name -eq $version) {
      $found = $true
      Invoke-SqlFile "tests/sql/environment-change-cutover-pause-regression.sql"
      break
    }
  }
  if (-not $found) { throw "Exact pause migration was not present in the ordered source chain" }
  Write-Output "environment_cutover_pause_replay_PASS migrations=$applied"
} finally {
  if ($containerId -match '^[0-9a-f]{64}$') {
    $actual = docker inspect --format '{{.Id}}' $containerId 2>$null
    if ($LASTEXITCODE -eq 0 -and $actual -eq $containerId) { docker rm -f $containerId *> $null }
  }
}
