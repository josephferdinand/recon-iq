$ErrorActionPreference = "Stop"
$containerName = "fvi-uppercase-run-uid-$PID"
$image = "supabase/postgres:15.8.1.060"
$containerId = $null

function Invoke-SqlText([string]$Sql) {
  $Sql | docker exec -i $containerId psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Disposable Run ID SQL failed" }
}

function Invoke-SqlFile([string]$Path) {
  Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
    docker exec -i $containerId psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Disposable Run ID SQL failed: $Path" }
}

try {
  # Disposable FVI-only database; no port is published and no hosted connection is used.
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

  Invoke-SqlText "CREATE TABLE public.recon_runs(id uuid PRIMARY KEY, run_uid text); INSERT INTO public.recon_runs(id,run_uid) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','legacy-123');"
  Invoke-SqlFile "supabase/migrations/20260923090000_uppercase_recon_run_uid.sql"
  Invoke-SqlText "CREATE TRIGGER recon_runs_set_uid BEFORE INSERT ON public.recon_runs FOR EACH ROW EXECUTE FUNCTION public.tg_recon_run_uid();"
  Invoke-SqlFile "tests/sql/uppercase-recon-run-uid-regression.sql"
  Write-Output "uppercase_run_uid_replay_PASS legacy_retained=1 generated_and_supplied_checked=1 malformed_rejected=6"
} finally {
  if ($containerId -match '^[0-9a-f]{64}$') {
    $actual = docker inspect --format '{{.Id}}' $containerId 2>$null
    if ($LASTEXITCODE -eq 0 -and $actual -eq $containerId) {
      docker rm -f $containerId *> $null
    }
  }
}
