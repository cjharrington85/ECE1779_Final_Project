#!/usr/bin/env bash
# Dump the database (custom format) and upload it to DigitalOcean Spaces.
# Required env: PGHOST PGUSER PGDATABASE SPACES_BUCKET SPACES_ENDPOINT
#   (e.g. https://tor1.digitaloceanspaces.com)
# Secrets (files): PGPASSWORD_FILE, SPACES_KEY_FILE, SPACES_SECRET_FILE
# Optional: BACKUP_RETENTION_DAYS (default 14)
set -euo pipefail

export PGPASSWORD="$(cat "${PGPASSWORD_FILE:?}")"
export AWS_ACCESS_KEY_ID="$(cat "${SPACES_KEY_FILE:?}")"
export AWS_SECRET_ACCESS_KEY="$(cat "${SPACES_SECRET_FILE:?}")"
export AWS_DEFAULT_REGION=us-east-1   # Spaces ignores region but the CLI wants one

: "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}" "${SPACES_BUCKET:?}" "${SPACES_ENDPOINT:?}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="/tmp/${PGDATABASE}_${stamp}.dump"
trap 'rm -f "$file"' EXIT

pg_dump -Fc --no-owner -f "$file" "$PGDATABASE"
pg_restore --list "$file" >/dev/null   # sanity check: archive is readable

aws s3 cp "$file" "s3://${SPACES_BUCKET}/backups/$(basename "$file")" --endpoint-url "$SPACES_ENDPOINT"
echo "uploaded $(basename "$file")"

# Prune backups older than the retention window
cutoff="$(date -u -d "-${RETENTION} days" +%Y%m%d)"
aws s3 ls "s3://${SPACES_BUCKET}/backups/" --endpoint-url "$SPACES_ENDPOINT" | awk '{print $4}' | while read -r key; do
    d="$(sed -n "s/.*_\([0-9]\{8\}\)T.*/\1/p" <<<"$key")"
    if [[ -n "$d" && "$d" < "$cutoff" ]]; then
        aws s3 rm "s3://${SPACES_BUCKET}/backups/${key}" --endpoint-url "$SPACES_ENDPOINT"
    fi
done
