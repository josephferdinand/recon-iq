#!/usr/bin/env bash
# check-brand-assets.sh
#
# Brand-asset consistency guard. Ensures that the monogram and favicon SVGs are
# byte-identical across every FVI surface that ships them, AND that every
# customer-facing CSS theme file mirrors the canonical brand tokens defined in
# BRAND.md. The marketing site at public/ is the single source of truth;
# everything else MUST be a copy (assets) or a token-equivalent mirror (CSS).
#
# Usage:    bash scripts/check-brand-assets.sh
# Exit 0:   every copy matches the canonical source
# Exit 1:   at least one copy is out of sync
#
# Add to deploy pipeline:
#     - name: Brand asset check
#       run: bash scripts/check-brand-assets.sh
#
set -euo pipefail

# Resolve repo root from the script location regardless of cwd
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL="$ROOT/public"

# Canonical sources (source of truth)
SOURCES=(
  "rq-seal.svg"
  "favicon.svg"
)

# Copies that MUST be byte-identical. Add a row here when a new surface ships.
COPIES=(
  "support-docs-site/assets/img/rq-seal.svg"
  "support-docs-site/favicon.svg"
  "support-docs-site/dist/favicon.svg"
  "client-portal-site/assets/img/rq-seal.svg"
  "client-portal-site/favicon.svg"
  "client-portal-site/dist/favicon.svg"
)

# Brand-CSS mirrors that MUST share the same canonical token set as the
# marketing site. Token names match BRAND.md §3.
# Each mirror file is checked for the presence of every required token name
# (case-insensitive substring match on the var declaration).
BRAND_TOKENS=(
  "fvi-primary"
  "fvi-accent"
  "fvi-success"
  "fvi-warning"
  "fvi-error"
  "fvi-bg-dark"
  "fvi-bg-light"
)

# Each entry: "<css-path>|<display-name>"
BRAND_CSS_MIRRORS=(
  "support-docs-site/assets/css/fvi-theme.css|support-docs"
  "support-docs-site/dist/assets/css/fvi-theme.css|support-docs (dist)"
  "client-portal-site/assets/css/fvi-theme.css|client-portal"
  "client-portal-site/dist/assets/css/fvi-theme.css|client-portal (dist)"
  "docs-site/custom.css|mintlify docs"
)

FAIL=0
md5() { md5sum "$1" | awk '{print $1}'; }

echo "==> Brand asset consistency check"
echo "    Canonical source: $CANONICAL"
echo ""

# ---- Asset byte-identity ----------------------------------------------------
for asset in "${SOURCES[@]}"; do
  src="$CANONICAL/$asset"
  if [ ! -f "$src" ]; then
    echo "ERROR: canonical file missing: $src"
    FAIL=1
    continue
  fi
  src_md5="$(md5 "$src")"
  echo "    $asset  ($src)  md5=$src_md5"
  for copy_rel in "${COPIES[@]}"; do
    # Only check copies that match this asset's basename
    base="$(basename "$copy_rel")"
    [ "$base" != "$asset" ] && continue

    copy="$ROOT/$copy_rel"
    if [ ! -f "$copy" ]; then
      echo "    MISSING: $copy_rel"
      FAIL=1
      continue
    fi
    copy_md5="$(md5 "$copy")"
    if [ "$src_md5" != "$copy_md5" ]; then
      echo "    MISMATCH: $copy_rel  md5=$copy_md5 (expected $src_md5)"
      FAIL=1
    else
      echo "    OK: $copy_rel"
    fi
  done
  echo ""
done

# ---- CSS theme mirror token check ------------------------------------------
echo "==> Brand CSS theme mirror check"
echo "    Required tokens (BRAND.md §3): ${BRAND_TOKENS[*]}"
echo ""

# Mirror identity: support-docs and client-portal fvi-theme.css files MUST be
# byte-identical to each other (they share the same brand chrome from the
# marketing site's Tailwind token set).
MIRROR_REF="support-docs-site/assets/css/fvi-theme.css"
ref_md5="$(md5 "$ROOT/$MIRROR_REF")"
echo "    Mirror reference: $MIRROR_REF  md5=$ref_md5"
for mirror_path in \
  "client-portal-site/assets/css/fvi-theme.css" \
  "support-docs-site/dist/assets/css/fvi-theme.css" \
  "client-portal-site/dist/assets/css/fvi-theme.css"
do
  full="$ROOT/$mirror_path"
  if [ ! -f "$full" ]; then
    echo "    MISSING: $mirror_path"
    FAIL=1
    continue
  fi
  m_md5="$(md5 "$full")"
  if [ "$ref_md5" != "$m_md5" ]; then
    echo "    MISMATCH: $mirror_path  md5=$m_md5 (expected $ref_md5)"
    FAIL=1
  else
    echo "    OK: $mirror_path"
  fi
done
echo ""

# Token presence check on every mirror
for entry in "${BRAND_CSS_MIRRORS[@]}"; do
  path="${entry%%|*}"
  label="${entry##*|}"
  full="$ROOT/$path"
  if [ ! -f "$full" ]; then
    echo "    MISSING CSS: $path ($label)"
    FAIL=1
    continue
  fi
  missing=()
  for tok in "${BRAND_TOKENS[@]}"; do
    # Require the token be declared as a CSS custom property
    if ! grep -qiE -- "--${tok}[[:space:]]*:" "$full"; then
      missing+=("$tok")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "    TOKEN DRIFT ($label): missing ${missing[*]}"
    FAIL=1
  else
    echo "    OK: $label — all ${#BRAND_TOKENS[@]} brand tokens present"
  fi
done
echo ""

# ---- Forbidden brand forms --------------------------------------------------
echo "==> Forbidden brand form check (HTML / CSS / MD / MDX in customer surfaces)"
echo "    Patterns: ReconIQ, FVI Platform, falconveritas.ai, FVI Inc"
echo "    (excluding the published NuGet package id 'ReconIQ.Intelligence')"
echo ""
FORBIDDEN_PATTERNS='ReconIQ[^.]|FVI Platform|falconveritas\.ai|FVI Inc'
EXCLUDE_PATTERN='ReconIQ\.Intelligence'   # NuGet package id (BRAND.md §3 exception)
HITS=0
for surface in \
  "support-docs-site" \
  "client-portal-site" \
  "docs-site"
do
  if [ -d "$ROOT/$surface" ]; then
    # Find matches in HTML/CSS/MD/MDX, excluding the published artifact name
    out="$(grep -rEn --include='*.html' --include='*.css' --include='*.md' --include='*.mdx' "$FORBIDDEN_PATTERNS" "$ROOT/$surface" 2>/dev/null | grep -vE "$EXCLUDE_PATTERN" || true)"
    if [ -n "$out" ]; then
      count="$(printf '%s\n' "$out" | wc -l)"
      echo "    DRIFT ($surface): $count forbidden occurrence(s)"
      printf '%s\n' "$out" | sed 's/^/      /'
      HITS=$((HITS + count))
      FAIL=1
    else
      echo "    OK: $surface — 0 forbidden brand forms"
    fi
  fi
done
echo ""

if [ "$FAIL" -eq 1 ]; then
  echo "Brand asset check FAILED."
  echo ""
  echo "To fix asset drift: copy the canonical file from public/ to the listed copy."
  echo "    cp public/<asset>.svg <copy-path>"
  echo ""
  echo "To fix CSS drift: copy the canonical CSS from the marketing brand chrome"
  echo "(see BRAND.md §3 + §5) into the mirror files, then re-run"
  echo "./support-docs-site/build.sh to refresh dist/."
  echo ""
  echo "If the canonical source itself needs to change, edit public/<asset>.svg"
  echo "FIRST, then re-run this script to confirm all copies are updated."
  exit 1
fi

echo "Brand asset check passed: assets, CSS mirrors, and forbidden-form grep all clean."
exit 0
