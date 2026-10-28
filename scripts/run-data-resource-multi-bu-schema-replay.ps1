$ErrorActionPreference = "Stop"
$containerName = "fvi-data-resource-multi-bu-$PID"
$image = "supabase/postgres:15.8.1.060"
$containerId = $null
$applied = 0

function Invoke-SqlFile([string]$Path) {
  Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
    docker exec -i $containerId psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "SQL failed: $Path" }
}

try {
  # Disposable FVI-only database: no published port and no hosted connection.
  $containerId = (docker run --name $containerName -e POSTGRES_PASSWORD=postgres -d $image).Trim()
  if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[0-9a-f]{64}$') {
    throw "Could not start disposable FVI Postgres"
  }
  $consecutive = 0
  for ($attempt = 0; $attempt -lt 120 -and $consecutive -lt 10; $attempt++) {
    docker exec $containerId pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $consecutive++ } else { $consecutive = 0 }
    Start-Sleep -Seconds 1
  }
  if ($consecutive -lt 10) { throw "Disposable FVI Postgres did not remain ready" }

  Invoke-SqlFile "scripts/ci-supabase-bootstrap.sql"
  Invoke-SqlFile "tests/sql/tenant-email-domain-auth-compat.sql"
  $migrations = Get-ChildItem -LiteralPath "supabase/migrations" -File -Filter "*.sql" | Sort-Object Name
  foreach ($migration in $migrations) {
    if ($migration.Name -eq "20260925092000_require_tenant_email_domain_cutover.sql") {
      Invoke-SqlFile "tests/sql/tenant-email-domain-precutover-compat.sql"
    }
    Invoke-SqlFile $migration.FullName
    $applied++
  }
  Invoke-SqlFile "tests/sql/data-resource-multi-bu-schema-regression.sql"
  Invoke-SqlFile "tests/sql/data-resource-typed-registry-regression.sql"
  Write-Output "data_resource_multi_bu_schema_replay_PASS migrations=$applied readiness=10"
} finally {
  if ($containerId -match '^[0-9a-f]{64}$') {
    $actual = docker inspect --format '{{.Id}}' $containerId 2>$null
    if ($LASTEXITCODE -eq 0 -and $actual -eq $containerId) {
      docker rm -f $containerId *> $null
    }
  }
}
