param([int]$Port = 55446)
$ErrorActionPreference = 'Stop'
$container = "fvi-personal-audit-$PID"
$image = 'supabase/postgres:15.8.1.060'
$applied = 0
$createdContainerId = $null
function Invoke-SqlFile([string]$Path) {
  Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
    docker exec -i $container psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "SQL failed: $Path" }
}
try {
  if (Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Disposable replay port is already in use: $Port"
  }
  $createdContainerId = (docker run --name $container -e POSTGRES_PASSWORD=postgres -p "${Port}:5432" -d $image).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable Postgres' }
  $consecutive = 0
  for ($attempt = 0; $attempt -lt 120 -and $consecutive -lt 10; $attempt++) {
    docker exec $container pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $consecutive++ } else { $consecutive = 0 }
    Start-Sleep -Seconds 1
  }
  if ($consecutive -lt 10) { throw 'Postgres did not remain ready for ten consecutive checks' }
  Invoke-SqlFile 'scripts/ci-supabase-bootstrap.sql'
  Invoke-SqlFile 'tests/sql/tenant-email-domain-auth-compat.sql'
  $migrations = Get-ChildItem -LiteralPath 'supabase/migrations' -File -Filter '*.sql' | Sort-Object Name
  foreach ($migration in $migrations) {
    if ($migration.Name -eq '20260925092000_require_tenant_email_domain_cutover.sql') {
      Invoke-SqlFile 'tests/sql/tenant-email-domain-precutover-compat.sql'
    }
    Invoke-SqlFile $migration.FullName
    $applied++
  }
  Invoke-SqlFile 'tests/sql/workspace-personal-audit-rls-regression.sql'
  Write-Output "workspace_personal_audit_replay_PASS migrations=$applied"
} finally {
  if ($createdContainerId) {
    $actualName = docker inspect --format '{{.Name}}' $createdContainerId 2>$null
    $actualImage = docker inspect --format '{{.Config.Image}}' $createdContainerId 2>$null
    if ($actualName -eq "/$container" -and $actualImage -eq $image) {
      docker rm -f $createdContainerId *> $null
    } else {
      throw 'Disposable replay container identity changed; refusing cleanup by name'
    }
  }
}
