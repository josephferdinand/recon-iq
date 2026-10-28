param([int]$Port = 55441)
$ErrorActionPreference = "Stop"
$container = "fvi-recon-orchestrator-$PID"
$image = "supabase/postgres:15.8.1.060"
$applied = 0
function Invoke-SqlFile([string]$Path) {
  Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | docker exec -i $container psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "SQL failed: $Path" }
}
try {
  docker run --name $container -e POSTGRES_PASSWORD=postgres -p "${Port}:5432" -d $image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not start disposable Postgres" }
  $consecutive = 0
  for ($attempt=0; $attempt -lt 120 -and $consecutive -lt 10; $attempt++) {
    docker exec $container pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $consecutive++ } else { $consecutive=0 }
    Start-Sleep -Seconds 1
  }
  if ($consecutive -lt 10) { throw "Postgres did not remain ready for ten consecutive checks" }
  Invoke-SqlFile "scripts/ci-supabase-bootstrap.sql"
  $migrations = Get-ChildItem -LiteralPath "supabase/migrations" -File -Filter "*.sql" | Sort-Object Name
  foreach ($migration in $migrations) { Invoke-SqlFile $migration.FullName; $applied++ }
  Invoke-SqlFile "tests/sql/reconciliation-orchestrator-regression.sql"
  Write-Output "reconciliation_orchestrator_replay_PASS migrations=$applied readiness=10"
} finally {
  docker rm -f $container *> $null
}
