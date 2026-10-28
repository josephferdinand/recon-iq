#!/usr/bin/env bash
# deploy-with-sourcemaps.sh — Build, upload source-maps to Sentry, then deploy
# to Cloudflare Pages for both fvi-app and fvi-marketing.
#
# Per LL-013 / LL-014 / LL-015: bash PATH-based wrangler invocation, never
# Python subprocess. Per LL-011: credentials never pass through chat. The
# script reads SENTRY_AUTH_TOKEN from the env at call time; if absent the
# Sentry steps are skipped (degrades to a plain build + deploy).
#
# Required env (optional, all are no-op if absent):
#   SENTRY_AUTH_TOKEN       - Sentry personal/org token with project:releases
#   SENTRY_ORG              - Sentry org slug (defaults to "reconiq")
#   SENTRY_PROJECT_APP      - Sentry project slug for fvi-app (defaults to "fvi-app")
#   SENTRY_PROJECT_MKT      - Sentry project slug for fvi-marketing (defaults to "fvi-marketing")
#   RELEASE_VERSION         - explicit release string (defaults to git short SHA + UTC date)
#
# Usage:
#   SENTRY_AUTH_TOKEN=... RELEASE_VERSION=v1.2.3 bash scripts/deploy-with-sourcemaps.sh

set -euo pipefail

# ─── Config ─────────────────────────────────────────────────────────────────
SENTRY_ORG="${SENTRY_ORG:-reconiq}"
SENTRY_PROJECT_APP="${SENTRY_PROJECT_APP:-fvi-app}"
SENTRY_PROJECT_MKT="${SENTRY_PROJECT_MKT:-fvi-marketing}"
RELEASE_VERSION="${RELEASE_VERSION:-$(git rev-parse --short HEAD 2>/dev/null || echo "dev")-$(date -u +%Y%m%dT%H%M%SZ)}"

# ─── Helpers ────────────────────────────────────────────────────────────────
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }

upload_sourcemaps() {
  local project="$1"
  local dist_dir="$2"
  if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
    warn "SENTRY_AUTH_TOKEN unset; skipping source-map upload for $project"
    return 0
  fi
  if [[ ! -d "$dist_dir" ]]; then
    warn "dist directory $dist_dir missing; skipping source-map upload for $project"
    return 0
  fi
  step "Sentry: creating release $RELEASE_VERSION for $project"
  npx --yes @sentry/cli@latest releases new "$RELEASE_VERSION" \
    --org "$SENTRY_ORG" --project "$project" || warn "release new returned non-zero (likely already exists)"

  step "Sentry: uploading source maps for $project from $dist_dir"
  npx --yes @sentry/cli@latest releases files "$RELEASE_VERSION" upload-sourcemaps "$dist_dir" \
    --org "$SENTRY_ORG" --project "$project" \
    --url-prefix "~/"

  step "Sentry: finalising release $RELEASE_VERSION for $project"
  npx --yes @sentry/cli@latest releases finalize "$RELEASE_VERSION" \
    --org "$SENTRY_ORG" --project "$project" || true

  ok "Sentry source-maps uploaded for $project"
}

deploy_pages() {
  local project="$1"
  local dist_dir="$2"
  if [[ ! -d "$dist_dir" ]]; then
    warn "$dist_dir missing; skipping deploy for $project"
    return 0
  fi
  step "Deploying $project to Cloudflare Pages (dist=$dist_dir)"
  wrangler pages deploy "$dist_dir" --project-name "$project" --commit-dirty=true
  ok "Deployed $project"
}

# ─── fvi-app ────────────────────────────────────────────────────────────────
step "Building fvi-app (vite build)"
pnpm run build

upload_sourcemaps "$SENTRY_PROJECT_APP" "./dist"
deploy_pages     "fvi-app"            "./dist"

# ─── fvi-marketing ──────────────────────────────────────────────────────────
step "Building fvi-marketing (vite build - apps/marketing)"
if [[ -d "apps/marketing" ]]; then
  (cd apps/marketing && pnpm run build)
  upload_sourcemaps "$SENTRY_PROJECT_MKT" "../dist"
  deploy_pages     "fvi-marketing"      "../dist"
else
  warn "apps/marketing not present (monorepo split pending); skipping marketing deploy"
fi

ok "deploy-with-sourcemaps complete (release=$RELEASE_VERSION)"
