param([switch]$DecisionOnly)

$ErrorActionPreference = "Stop"
$containerName = "fvi-recon-multi-bu-shadow-$PID"
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
    if (-not $DecisionOnly -and $migration.Name -eq "20260925092000_require_tenant_email_domain_cutover.sql") {
      Invoke-SqlFile "tests/sql/tenant-email-domain-precutover-compat.sql"
    }
    if ($migration.Name -eq "20260924235400_recon_definition_maker_checker.sql") {
      # Validate the additive shadow model at its intended pre-enforcement schema point.
      if (-not $DecisionOnly) {
        Invoke-SqlFile "tests/sql/reconciliation-multi-bu-shadow-authorization-regression.sql"
        Invoke-SqlFile "tests/sql/reconciliation-multi-bu-admin-rpc-regression.sql"
      }
      Invoke-SqlFile "tests/sql/reconciliation-authoritative-access-decision-fixture.sql"
      if (-not $DecisionOnly) {
        Invoke-SqlFile "tests/sql/recon-legacy-mapping-cutover-fixture.sql"
      }
    }
    Invoke-SqlFile $migration.FullName
    $applied++
    if (-not $DecisionOnly -and $migration.Name -eq "20260923132900_environment_change_cutover_pause.sql") {
      Invoke-SqlFile "tests/sql/environment-change-cutover-pause-regression.sql"
    }
    if ($migration.Name -eq "20260925101000_recon_authoritative_access_decision.sql") {
      Invoke-SqlFile "tests/sql/reconciliation-authoritative-access-decision-regression.sql"
    }
    if (-not $DecisionOnly -and $migration.Name -eq "20260925120000_recon_effective_access_rls.sql") {
      Invoke-SqlFile "tests/sql/reconciliation-effective-access-rls-regression.sql"
    }
    if (-not $DecisionOnly -and $migration.Name -eq "20260925130000_atomic_recon_definition_owner_binding.sql") {
      Invoke-SqlFile "tests/sql/reconciliation-atomic-owner-binding-regression.sql"
    }
    if (-not $DecisionOnly -and $migration.Name -eq "20260925140000_recon_governed_write_rls.sql") {
      Invoke-SqlFile "tests/sql/reconciliation-governed-write-rls-regression.sql"
    }
    if (-not $DecisionOnly -and $migration.Name -eq "20260925150000_owner_bound_reconciliation_template_creators.sql") {
      Invoke-SqlFile "tests/sql/reconciliation-template-owner-binding-regression.sql"
    }
    if (-not $DecisionOnly -and $migration.Name -eq "20260925160000_atomic_owner_bound_reconciliation_import.sql") {
      Invoke-SqlFile "tests/sql/reconciliation-atomic-import-regression.sql"
    }
    if (-not $DecisionOnly -and $migration.Name -eq "20260925170000_governed_legacy_reconciliation_mapping_cutover.sql") {
      Invoke-SqlFile "tests/sql/recon-legacy-mapping-cutover-regression.sql"
    }
    if (-not $DecisionOnly -and $migration.Name -eq "20260925180000_recon_definition_governed_write_rls.sql") {
      Invoke-SqlFile "tests/sql/reconciliation-definition-governed-write-rls-regression.sql"
    }
    if ($migration.Name -eq "20260925191000_recon_authoritative_access_decision_as.sql") {
      Invoke-SqlFile "tests/sql/reconciliation-authoritative-access-decision-as-regression.sql"
      if ($DecisionOnly) { break }
    }
  }
  if ($DecisionOnly) {
    Write-Output "recon_actor_decision_replay_PASS migrations=$applied"
  } else {
    Write-Output "recon_multi_bu_admin_replay_PASS migrations=$applied readiness=10"
  }
} finally {
  if ($containerId -match '^[0-9a-f]{64}$') {
    $actual = docker inspect --format '{{.Id}}' $containerId 2>$null
    if ($LASTEXITCODE -eq 0 -and $actual -eq $containerId) {
      docker rm -f $containerId *> $null
    }
  }
}
