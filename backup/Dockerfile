FROM postgres:16
RUN apt-get update \
 && apt-get install -y --no-install-recommends awscli cron \
 && rm -rf /var/lib/apt/lists/*
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
# Scheduler: run backup.sh daily at 03:00 UTC (override with BACKUP_CRON).
# cron does not inherit env, so entrypoint writes the crontab with variables baked in.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]
