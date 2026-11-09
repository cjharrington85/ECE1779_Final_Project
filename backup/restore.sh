#!/usr/bin/env bash
# Restore a backup from Spaces. Usage: restore.sh [backup-key]   (default: latest)
# Same env/secrets as backup.sh. DESTRUCTIVE: drops and recreates existing objects.
set -euo pipefail

export PGPASSWORD="$(cat "${PGPASSWORD_FILE:?}")"
export AWS_ACCESS_KEY_ID="$(cat "${SPACES_KEY_FILE:?}")"
export AWS_SECRET_ACCESS_KEY="$(cat "${SPACES_SECRET_FILE:?}")"
export AWS_DEFAULT_REGION=us-east-1
: "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}" "${SPACES_BUCKET:?}" "${SPACES_ENDPOINT:?}"

key="${1:-}"
if [[ -z "$key" ]]; then
    key="$(aws s3 ls "s3://${SPACES_BUCKET}/backups/" --endpoint-url "$SPACES_ENDPOINT" | awk '{print $4}' | sort | tail -1)"
fi
[[ -n "$key" ]] || { echo "no backups found" >&2; exit 1; }

file="/tmp/$(basename "$key")"
trap 'rm -f "$file"' EXIT
aws s3 cp "s3://${SPACES_BUCKET}/backups/$(basename "$key")" "$file" --endpoint-url "$SPACES_ENDPOINT"

echo "restoring $key into $PGDATABASE"
pg_restore --clean --if-exists --no-owner --single-transaction -d "$PGDATABASE" "$file"
echo "done"
