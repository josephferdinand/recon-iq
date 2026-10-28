param(
  [switch]$IncludeOwnerBrowser
)

$ErrorActionPreference = "Stop"
$secretRoot = "C:\Users\Alice Yesudasan\.fvi-secrets"
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = (Get-Content -LiteralPath "$secretRoot\SUPABASE_DEV_ANON_KEY" -Raw).Trim()
$env:SUPABASE_SERVICE_ROLE_KEY = (Get-Content -LiteralPath "$secretRoot\SUPABASE_DEV_SERVICE_ROLE_KEY" -Raw).Trim()
$env:FVI_LIVE_TEST_TARGET = "DEV"
$env:FVI_ALLOW_LIVE_MUTATIONS = "YES"
$env:FVI_TEST_RUN_STARTED_AT = (Get-Date).ToUniversalTime().ToString("o")

bun run test:live:dev
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node scripts/verify-dev-test-teardown.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($IncludeOwnerBrowser) {
  $env:FVI_E2E_BASE_URL = "https://dev.app.reconiq.example"
  bun run test:owner
  exit $LASTEXITCODE
}
