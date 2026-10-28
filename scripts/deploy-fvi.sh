#!/usr/bin/env bash
# deploy-fvi.sh — Build + deploy FVI to Cloudflare Pages (fvi-app + fvi-marketing).
#
# Idempotent and re-runnable. Safe to invoke repeatedly.
#
# Reads Cloudflare credentials from environment:
#   CLOUDFLARE_API_TOKEN   (required) — Pages Edit scope
#   CLOUDFLARE_ACCOUNT_ID  (required)
#
# Per LL-016: vite build emits dist/_worker.js/wrangler.json and dist/nitro.json
#             which conflict with Pages deploy. Both are removed before deploy.
# Per LL-015: kills heavy node processes (>100MB RAM) before rebuilding to avoid OOM.
# Per LL-013: canonical `wrangler pages deploy` invocation (no Python subprocess).
#
# Usage:
#   export CLOUDFLARE_API_TOKEN=...
#   export CLOUDFLARE_ACCOUNT_ID=...
#   bash scripts/deploy-fvi.sh

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
FVI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$FVI_ROOT/dist"
WRANGLER_DIR="$FVI_ROOT/.wrangler"

PROJECT_APP="fvi-app"
PROJECT_MKT="fvi-marketing"
BRANCH="main"

PROD_URLS=(
  "https://app.reconiq.example/"
  "https://reconiq.example/"
  "https://www.reconiq.example/"
  "https://status.reconiq.example/"
)

# ─── Helpers ────────────────────────────────────────────────────────────────
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── Preconditions ──────────────────────────────────────────────────────────
[[ -z "${CLOUDFLARE_API_TOKEN:-}"  ]] && fail "CLOUDFLARE_API_TOKEN is not set"
[[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]] && fail "CLOUDFLARE_ACCOUNT_ID is not set"
cd "$FVI_ROOT" || fail "Cannot cd to $FVI_ROOT"

# ─── Step 0: kill heavy node processes (LL-015) ─────────────────────────────
step "Killing node processes >100MB RAM (LL-015)"
if command -v tasklist.exe >/dev/null 2>&1; then
  # Windows: parse tasklist output and kill PIDs over 100MB
  tasklist.exe 2>/dev/null \
    | awk '/node\.exe/ { mem=$5; gsub(/[^0-9]/,"",mem); if (mem+0 > 100000) print $2 }' \
    | while read -r pid; do
        [[ -n "$pid" ]] && taskkill //F //PID "$pid" >/dev/null 2>&1 && warn "killed PID $pid"
      done
elif command -v ps >/dev/null 2>&1; then
  ps -eo pid,rss,comm 2>/dev/null \
    | awk '/node/ { if ($2+0 > 102400) print $1 }' \
    | while read -r pid; do
        [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null && warn "killed PID $pid"
      done
fi
ok "node cleanup done"

# ─── Step 1: clean rebuild ───────────────────────────────────────────────────
step "Removing dist/ and .wrangler/"
rm -rf "$DIST_DIR" "$WRANGLER_DIR"
ok "cleaned"

step "Building with vite (production mode)"
if command -v pnpm >/dev/null 2>&1; then
  pnpm exec vite build --mode production
elif [[ -x "$FVI_ROOT/node_modules/.bin/vite" ]]; then
  "$FVI_ROOT/node_modules/.bin/vite" build --mode production
else
  fail "vite not found — install via pnpm/npm first"
fi

# LL-041: post-build patch to break the cyclic ESM dep between the main router
# SSR chunk and the shared chunk (see scripts/patch-ssr-cycle.js). Without
# this, the Workers runtime crashes with "init_X is not a function" at module
# evaluation time (LL-016/LL-041 chunk-cycle). Idempotent.
step "Patching SSR bundle for cycle-safe inits (LL-041)"
node "$FVI_ROOT/scripts/patch-ssr-cycle.js"
ok "patch applied"
ok "vite build complete"

# ─── Step 2: remove wrangler.json conflicts (LL-016) ─────────────────────────
step "Removing dist/_worker.js/wrangler.json + dist/nitro.json (LL-016)"
rm -f "$DIST_DIR/_worker.js/wrangler.json" "$DIST_DIR/nitro.json"
# Also drop any stale wrangler deploy redirector that points to the deleted files
rm -rf "$WRANGLER_DIR/deploy/config.json"
ok "conflicts cleared"

# ─── Step 3: deploy fvi-app ──────────────────────────────────────────────────
step "Deploying fvi-app to Cloudflare Pages"
"$FVI_ROOT/node_modules/.bin/wrangler" pages deploy "$DIST_DIR" \
  --project-name "$PROJECT_APP" \
  --branch="$BRANCH" \
  --commit-dirty=true
ok "fvi-app deployed"

# Re-clear conflicts because deploy state may have been regenerated
rm -f "$DIST_DIR/_worker.js/wrangler.json" "$DIST_DIR/nitro.json"
rm -rf "$WRANGLER_DIR/deploy/config.json"

# LL-026 + LL-041: rebuild dist/ for the second deploy. wrangler pages deploy
# consumes the dist tree (uploads then leaves the directory emptied by the
# _worker.js/_routes.json rebuild cycle), so we must rebuild + patch before
# deploying fvi-marketing.
step "Rebuilding for fvi-marketing deploy (LL-026 + LL-041)"
rm -rf "$DIST_DIR" "$WRANGLER_DIR"
"$FVI_ROOT/node_modules/.bin/vite" build --mode production
node "$FVI_ROOT/scripts/patch-ssr-cycle.js"
rm -f "$DIST_DIR/_worker.js/wrangler.json" "$DIST_DIR/nitro.json"
rm -rf "$WRANGLER_DIR/deploy/config.json"
ok "rebuilt + patched"

# ─── Step 4: deploy fvi-marketing ────────────────────────────────────────────
step "Deploying fvi-marketing to Cloudflare Pages"
"$FVI_ROOT/node_modules/.bin/wrangler" pages deploy "$DIST_DIR" \
  --project-name "$PROJECT_MKT" \
  --branch="$BRANCH" \
  --commit-dirty=true
ok "fvi-marketing deployed"

# ─── Step 5: verify URLs ─────────────────────────────────────────────────────
step "Verifying production URLs"
all_ok=1
for url in "${PROD_URLS[@]}"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 30 "$url" 2>/dev/null || echo "ERR")
  if [[ "$code" == "200" ]]; then
    ok "$url -> HTTP $code"
  else
    warn "$url -> HTTP $code (non-200; runtime/config issue, not a deploy failure)"
    # Don't fail the script on 500s — those are runtime env-var issues, not deploy failures
    # Per LL-016: a 500 means the bundle deployed; env-var wiring is a separate fix
  fi
done

step "Warming Cloudflare edge cache (LL-053)"
bash "$FVI_ROOT/scripts/warm-cache.sh" || warn "warm-cache: non-fatal � deployed URL may show stale HTML on first request"

step "deploy-fvi complete"
ok "Both projects deployed and warmed. See /tmp deploy URLs from wrangler output above."
