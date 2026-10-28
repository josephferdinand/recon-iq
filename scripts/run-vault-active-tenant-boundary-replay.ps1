param([int]$Port = 55457)
$ErrorActionPreference = 'Stop'
$container = "fvi-vault-boundary-$PID"
$image = 'supabase/postgres:15.8.1.060'
$createdContainerId = $null
$applied = 0
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
  $predecessors = Get-ChildItem -LiteralPath 'supabase/migrations' -File -Filter '*.sql' |
    Where-Object { $_.Name -le '20260923090200_marketing_lead_pii_read_boundary_early.sql' } |
    Sort-Object Name
  foreach ($migration in $predecessors) {
    Invoke-SqlFile $migration.FullName
    $applied++
  }
  Invoke-SqlFile 'supabase/migrations/20260923090300_vault_active_tenant_boundary.sql'
  $catalogueMd5 = docker exec $container psql -At -U postgres -d postgres -c "select md5(coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'cmd',cmd,'roles',roles,'permissive',permissive,'qual',qual,'check',with_check) order by tablename,policyname),'[]'::jsonb)::text) from pg_policies where schemaname='public' and tablename in ('app_vault_secrets','app_vault_kms_bindings','app_vault_rotation_log','app_vault_secret_versions');"
  if ($LASTEXITCODE -ne 0 -or $catalogueMd5 -notmatch '^[0-9a-f]{32}$') { throw 'Vault policy catalogue fingerprint query failed' }
  Invoke-SqlFile 'tests/sql/vault-active-tenant-boundary-regression.sql'
  Write-Output "vault_active_tenant_boundary_replay_PASS predecessors=$applied policy_catalogue_md5=$catalogueMd5"
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
