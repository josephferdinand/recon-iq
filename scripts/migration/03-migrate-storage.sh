#!/usr/bin/env bash
# FVI — migrate storage objects from managed Supabase Storage to the
# self-hosted stack (or directly to Cloudflare R2).
#
# Buckets (all private):
#   aidp, kb-screenshots, ticket-attachments, soc2-evidence, mkt-media, brand-assets
#
# Usage:
#   SOURCE_S3_ENDPOINT=... SOURCE_S3_KEY=... SOURCE_S3_SECRET=... \
#   TARGET_S3_ENDPOINT=... TARGET_S3_KEY=... TARGET_S3_SECRET=... \
#     bash scripts/migration/03-migrate-storage.sh
#
# Requires: rclone >= 1.65

set -euo pipefail

BUCKETS=(aidp kb-screenshots ticket-attachments soc2-evidence mkt-media brand-assets)

: "${SOURCE_S3_ENDPOINT:?}" "${SOURCE_S3_KEY:?}" "${SOURCE_S3_SECRET:?}"
: "${TARGET_S3_ENDPOINT:?}" "${TARGET_S3_KEY:?}" "${TARGET_S3_SECRET:?}"

CFG="$(mktemp)"
trap 'rm -f "$CFG"' EXIT
cat > "$CFG" <<EOF
[src]
type = s3
provider = Other
env_auth = false
access_key_id = ${SOURCE_S3_KEY}
secret_access_key = ${SOURCE_S3_SECRET}
endpoint = ${SOURCE_S3_ENDPOINT}
force_path_style = true
region = ${SOURCE_S3_REGION:-us-east-1}

[dst]
type = s3
provider = Cloudflare
env_auth = false
access_key_id = ${TARGET_S3_KEY}
secret_access_key = ${TARGET_S3_SECRET}
endpoint = ${TARGET_S3_ENDPOINT}
force_path_style = true
region = auto
EOF

for b in "${BUCKETS[@]}"; do
  echo "==> Syncing bucket: $b"
  rclone --config "$CFG" sync "src:$b" "dst:$b" \
    --transfers 16 --checkers 32 --s3-chunk-size 16M \
    --progress --stats 10s --retries 5
done

echo
echo "==> Verification (object counts must match)"
for b in "${BUCKETS[@]}"; do
  s=$(rclone --config "$CFG" size "src:$b" --json)
  d=$(rclone --config "$CFG" size "dst:$b" --json)
  echo "$b  SOURCE=$s"
  echo "$b  TARGET=$d"
done

echo
echo "REMINDER: storage.objects metadata rows travel with the database dump."
echo "Bucket ACLs and RLS policies on storage.objects must be re-verified."
