#!/usr/bin/env bash
# scripts/beautify-mermaid.sh
#
# FVI · Mermaid beautifier.
# Walks the repo, finds every ```` ```mermaid ```` block in .md / .mdx / .mmd / .html
# files, and:
#   1. Inserts the canonical FVI `%%{init: ...}%%` directive on the first line
#      of the block if one is missing.
#   2. Re-indents nodes inside the block to a consistent 4-space grid (idempotent).
#   3. Optionally validates the syntax via @mermaid-js/mermaid-cli
#      (set --validate; requires `npx --yes @mermaid-js/mermaid-cli`).
#
# Usage:
#   bash scripts/beautify-mermaid.sh                 # default: dry-run
#   bash scripts/beautify-mermaid.sh --apply         # modify files in place
#   bash scripts/beautify-mermaid.sh --apply --validate
#   bash scripts/beautify-mermaid.sh --dir docs-site --apply
#
# Safe by default: reports what it WOULD do, doesn't touch the tree.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

DRY_RUN=1
VALIDATE=0
TARGET_DIR="${ROOT_DIR}"
GLOB_PATTERNS=(--include='*.md' --include='*.mdx' --include='*.mmd' --include='*.html')
# Skip vendor / build / output dirs to keep the scan focused on FVI sources.
EXCLUDES=(
  --glob '!**/node_modules/**'
  --glob '!**/.git/**'
  --glob '!**/dist/**'
  --glob '!**/.tanstack/**'
  --glob '!**/.wrangler/**'
  --glob '!**/graphify-out/**'
  --glob '!**/test-results/**'
  --glob '!**/docs/diagrams/rendered/**'
  --glob '!**/.claude/**'
  --glob '!**/playwright-report/**'
)

usage() {
  sed -n '2,15p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)    DRY_RUN=0; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --validate) VALIDATE=1; shift ;;
    --dir)      TARGET_DIR="$(cd "$2" && pwd)"; shift 2 ;;
    -h|--help)  usage ;;
    *) echo "Unknown flag: $1" >&2; usage ;;
  esac
done

# Canonical FVI directive — pulled from /mermaid-fvi-theme.json (themeVariables).
# Compact JSON: Mermaid parses single-line %%{init}%% directives; newlines break it.
read -r -d '' DIRECTIVE <<'EOF' || true
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#1e3a5f','primaryTextColor':'#ffffff','primaryBorderColor':'#142845','secondaryColor':'#00d4ff','secondaryTextColor':'#0a0e1a','tertiaryColor':'#f6f8fb','tertiaryTextColor':'#0a0e1a','tertiaryBorderColor':'#e5e7eb','lineColor':'#3b5f87','textColor':'#0a0e1a','mainBkg':'#1e3a5f','secondBkg':'#00d4ff','border1':'#142845','border2':'#3b5f87','fontFamily':'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif','fontSize':'14px','labelBackground':'#ffffff','labelTextColor':'#0a0e1a','nodeBorder':'#142845','clusterBkg':'#f6f8fb','clusterBorder':'#e5e7eb','defaultLinkColor':'#3b5f87','titleColor':'#0a0e1a','edgeLabelBackground':'#ffffff','noteBkgColor':'#f6f8fb','noteTextColor':'#0a0e1a','noteBorderColor':'#e5e7eb','errorBkgColor':'#ef4444','errorTextColor':'#ffffff'}}}%%
EOF

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "[beautify-mermaid] DRY RUN — no files will be modified."
fi
echo "[beautify-mermaid] target: ${TARGET_DIR}"
echo "[beautify-mermaid] mode: $([[ ${DRY_RUN} -eq 1 ]] && echo 'dry-run' || echo 'apply')"
echo "[beautify-mermaid] validate: $([[ ${VALIDATE} -eq 1 ]] && echo 'on' || echo 'off')"
echo ""

# Build the list of candidate files. We consider two file classes:
#   (a) `.md`/`.mdx`/`.html` containing fenced ```mermaid blocks
#   (b) `.mmd` standalone sources (every one is treated as a single block)
# Vendor/build dirs are excluded.
FILES=()
if command -v rg >/dev/null 2>&1; then
  # Fenced mermaid in markdown-style files
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    FILES+=("$f")
  done < <(rg --files-with-matches \
      -g '*.md' -g '*.mdx' -g '*.html' \
      "${EXCLUDES[@]}" \
      '```mermaid' "${TARGET_DIR}" 2>/dev/null || true)
  # Standalone .mmd files (every one is a mermaid source)
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    FILES+=("$f")
  done < <(rg --files \
      -g '*.mmd' \
      "${EXCLUDES[@]}" \
      "${TARGET_DIR}" 2>/dev/null || true)
else
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    FILES+=("$f")
  done < <(grep -rln "${GLOB_PATTERNS[@]/#/}" '```mermaid' "${TARGET_DIR}" 2>/dev/null \
           | grep -v -E '/(node_modules|\.git|dist|\.tanstack|\.wrangler|graphify-out|test-results|playwright-report)/' \
           | grep -v -E '/\.claude/' \
           | grep -v -E '/docs/diagrams/rendered/' \
           || true)
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    FILES+=("$f")
  done < <(find "${TARGET_DIR}" \
           \( -path '*/node_modules' -o -path '*/.git' -o -path '*/dist' \
              -o -path '*/.tanstack' -o -path '*/.wrangler' -o -path '*/graphify-out' \
              -o -path '*/test-results' -o -path '*/playwright-report' \
              -o -path '*/.claude' -o -path '*/rendered' \) -prune \
           -o -type f -name '*.mmd' -print 2>/dev/null || true)
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "[beautify-mermaid] no mermaid blocks found."
  exit 0
fi

total_blocks=0
total_added=0
total_aligned=0
total_failed=0

for f in "${FILES[@]}"; do
  # Read file once, count blocks, check directives.
  # We use awk for the in-place rewrite to keep the script POSIX-portable.
  tmp="$(mktemp)"
  awk -v directive="${DIRECTIVE}" -v filename="$f" '
    BEGIN {
      in_block = 0
      has_directive = 0
      block_indent = ""
      depth = 0
      added = 0
      aligned = 0
      # Detect .mmd standalone sources — whole file is one block.
      is_mmd = (filename ~ /\.mmd$/)
      if (is_mmd) {
        in_block = 1
        has_directive = 0
      }
    }
    /^```mermaid[[:space:]]*$/ {
      # Entering a new mermaid block
      print
      in_block = 1
      has_directive = 0
      next
    }
    /^```[[:space:]]*$/ {
      if (in_block && !is_mmd) {
        # Leaving a block; if it had no directive, insert one before closing.
        if (!has_directive) {
          print directive
          added++
        }
        in_block = 0
        has_directive = 0
        print
        next
      }
      print
      next
    }
    {
      if (in_block) {
        # Detect an existing directive on the first content line.
        # For .mmd, the directive counts as having it, so no prepend.
        if (!has_directive && $0 ~ /^%%\{init:/) {
          has_directive = 1
        }
        if (is_mmd && !has_directive && NR == 1) {
          # First content line of an .mmd without directive: prepend it.
          print directive
          added++
          has_directive = 1
          # Also print the original line (already 4-space indented)
          if ($0 ~ /^[[:space:]]*$/) {
            print
          } else {
            sub(/^[[:space:]]+/, "")
            print "    " $0
            aligned++
          }
          next
        }
        # Re-indent: strip leading whitespace, re-emit with 4 spaces unless line
        # is a directive, comment, or blank. Idempotent on already-indented text.
        if ($0 ~ /^%%/) {
          print
        } else if ($0 ~ /^[[:space:]]*$/) {
          print
        } else {
          sub(/^[[:space:]]+/, "")
          print "    " $0
          aligned++
        }
      } else {
        print
      }
    }
    END {
      # For .mmd, blocks == 1.
      if (is_mmd) {
        print "BEAUTIFY_BLOCKS=1" > "/dev/stderr"
      } else {
        # Stash a sentinel; resolved in shell after awk exits.
        print "BEAUTIFY_BLOCKS=__BCOUNT__" > "/dev/stderr"
      }
      if (added > 0) print "BEAUTIFY_ADDED=" added > "/dev/stderr"
      if (aligned > 0) print "BEAUTIFY_ALIGNED=" aligned > "/dev/stderr"
    }
  ' "$f" > "$tmp" 2>/tmp/awk-stderr

  awk_rc=$?
  added=$(grep -o 'BEAUTIFY_ADDED=[0-9]*' /tmp/awk-stderr 2>/dev/null | head -1 | cut -d= -f2 || echo 0)
  aligned=$(grep -o 'BEAUTIFY_ALIGNED=[0-9]*' /tmp/awk-stderr 2>/dev/null | head -1 | cut -d= -f2 || echo 0)
  block_count_raw=$(grep -E 'BEAUTIFY_BLOCKS=' /tmp/awk-stderr 2>/dev/null | head -1 | cut -d= -f2 || echo 0)
  added=${added:-0}; aligned=${aligned:-0}; block_count_raw=${block_count_raw:-0}

  if [[ "$block_count_raw" == "__BCOUNT__" ]]; then
    block_count=$(grep -c '```mermaid' "$f" || true)
    block_count=${block_count:-0}
  else
    block_count="$block_count_raw"
  fi
  total_blocks=$(( total_blocks + block_count ))
  total_added=$(( total_added + added ))
  total_aligned=$(( total_aligned + aligned ))

  if [[ "${DRY_RUN}" -eq 0 ]]; then
    if ! cmp -s "$f" "$tmp"; then
      mv "$tmp" "$f"
      echo "  [modified] $f  (+${added} directive, ${aligned} re-indented lines)"
    else
      rm -f "$tmp"
      echo "  [unchanged] $f"
    fi
  else
    rm -f "$tmp"
    if [[ "$added" -gt 0 || "$aligned" -gt 0 ]]; then
      echo "  [would-modify] $f  (+${added} directive, ${aligned} re-indented lines)"
    else
      echo "  [unchanged] $f"
    fi
  fi
done

rm -f /tmp/awk-stderr

echo ""
echo "[beautify-mermaid] files scanned: ${#FILES[@]}"
echo "[beautify-mermaid] mermaid blocks: ${total_blocks}"
echo "[beautify-mermaid] directives added: ${total_added}"
echo "[beautify-mermaid] lines re-indented: ${total_aligned}"

# --- Optional validation -----------------------------------------------------
# Only kicks in if --validate is set AND a .mmd files was found (or npx is
# available). Validation is slow (Puppeteer + Chromium per file) — opt in only
# when you actually want it.
if [[ "${VALIDATE}" -eq 1 ]]; then
  if ! command -v npx >/dev/null 2>&1; then
    echo "[beautify-mermaid] --validate requested but npx not found; skipping." >&2
    exit 1
  fi
  echo ""
  echo "[beautify-mermaid] validating .mmd files via mermaid-cli..."
  fail=0
  while IFS= read -r mmd; do
    [[ -z "$mmd" ]] && continue
    out_dir="$(dirname "$mmd")/rendered"
    mkdir -p "$out_dir"
    if npx --yes @mermaid-js/mermaid-cli \
        -C "${ROOT_DIR}/mermaid-fvi-theme.json" \
        -i "$mmd" \
        -o "${out_dir}/$(basename "${mmd}" .mmd).svg" \
        -b transparent >/dev/null 2>&1; then
      echo "  [ok]      $mmd"
    else
      echo "  [FAIL]    $mmd"
      fail=$(( fail + 1 ))
    fi
  done < <(find "${TARGET_DIR}/docs/diagrams" -maxdepth 1 -name '*.mmd' 2>/dev/null || true)
  echo "[beautify-mermaid] validation failures: ${fail}"
  [[ "${fail}" -gt 0 ]] && exit 1
fi

exit 0
