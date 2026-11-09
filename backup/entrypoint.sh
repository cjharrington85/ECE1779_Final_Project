#!/usr/bin/env bash
# Installs a cron job for backup.sh and runs cron in the foreground.
# Pass "now" as the first argument to run a single backup and exit.
set -euo pipefail

if [[ "${1:-}" == "now" ]]; then
    exec backup.sh
fi

schedule="${BACKUP_CRON:-0 3 * * *}"
env_file=/etc/backup.env
printenv | grep -E '^(PG|SPACES_|BACKUP_)' | sed 's/^/export /; s/=/="/; s/$/"/' > "$env_file"
echo "${schedule} root . ${env_file}; /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/cron.d/backup
chmod 0644 /etc/cron.d/backup
exec cron -f
